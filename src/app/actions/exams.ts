'use server';
// 模試・過去問の成績。生徒本人と、担当の講師・運営が入れられる（DB の can_edit_exam）
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { mockTrend, pastByTarget, type ExamResult, type Judgement } from '@/lib/domain/exams';
import { changed, dbError, fail, ok, withActor, zDate, zId, type Result } from '@/server/result';

const done = () => revalidatePath('/', 'layout');
const Num = z.number().finite().min(0).max(99999);
const Dev = z.number().finite().min(0).max(100);
const Subject = z.object({ subject: z.string().trim().min(1, '科目を入れてください').max(20), score: Num.nullish(), max: z.number().finite().positive().max(99999).nullish(), deviation: Dev.nullish() });
const Exam = z.object({
  id: zId.optional(),
  studentId: zId.optional(),
  kind: z.enum(['mock', 'past']),
  title: z.string().trim().min(1, '模試の名前（過去問は大学・学部）を入れてください').max(80),
  provider: z.string().trim().max(40).default(''),
  takenOn: zDate,
  year: z.number().int().min(1990).max(2100).nullish(),
  score: Num.nullish(), max: z.number().finite().positive().max(99999).nullish(), passing: Num.nullish(),
  deviation: Dev.nullish(), target: z.string().trim().max(80).default(''), judgement: z.enum(['A', 'B', 'C', 'D', 'E']).nullish(),
  note: z.string().trim().max(200).default(''),
  subjects: z.array(Subject).max(12).default([]),
}).superRefine((v, c) => {
  if (v.kind === 'past' && !v.year) c.addIssue({ code: 'custom', message: '過去問は何年度の問題かを入れてください' });
  if (v.score != null && v.max != null && v.score > v.max) c.addIssue({ code: 'custom', message: '点数が満点を超えています' });
  if (v.passing != null && v.max != null && v.passing > v.max) c.addIssue({ code: 'custom', message: '合格最低点が満点を超えています' });
  if (new Set(v.subjects.map(s => s.subject)).size !== v.subjects.length) c.addIssue({ code: 'custom', message: '同じ科目が2回あります' });
  v.subjects.forEach(s => { if (s.score != null && s.max != null && s.score > s.max) c.addIssue({ code: 'custom', message: `${s.subject}の点数が満点を超えています` }); });
});

const toNum = (x: unknown) => (x == null ? null : Number(x));

/** 生徒の成績（模試の推移・過去問を大学ごと） */
export async function examsOf(studentId?: string): Promise<Result<{ results: ExamResult[]; trend: ReturnType<typeof mockTrend>; past: ReturnType<typeof pastByTarget> }>> {
  return withActor(['student', 'coach', 'admin'], async ({ sb, actor }) => {
    const sid = actor.role === 'student' ? actor.id : zId.parse(studentId);
    const { data, error } = await sb.from('exam_results')
      .select('id, kind, title, provider, taken_on, exam_year, total_score, total_max, passing_score, deviation, target, judgement, note, exam_subject_scores(subject, score, max_score, deviation, seq)')
      .eq('student_id', sid).order('taken_on');
    if (error) return fail(dbError(error));
    const results: ExamResult[] = (data ?? []).map(r => ({
      id: r.id, kind: r.kind, title: r.title, provider: r.provider, takenOn: r.taken_on, year: r.exam_year,
      score: toNum(r.total_score), max: toNum(r.total_max), passing: toNum(r.passing_score), deviation: toNum(r.deviation),
      target: r.target, judgement: r.judgement as Judgement | null, note: r.note,
      subjects: [...(r.exam_subject_scores ?? [])].sort((a, b) => a.seq - b.seq).map(s => ({ subject: s.subject, score: toNum(s.score), max: toNum(s.max_score), deviation: toNum(s.deviation) })),
    }));
    return ok(undefined, { results, trend: mockTrend(results), past: pastByTarget(results) });
  });
}

/** 成績を入れる・直す。科目の点は全部入れ替える */
export async function saveExam(input: z.input<typeof Exam>): Promise<Result<{ id: string }>> {
  return withActor(['student', 'coach', 'admin'], async ({ sb, actor }) => {
    const v = Exam.parse(input);
    if (new Set(v.subjects.map(s => s.subject)).size !== v.subjects.length) return fail('同じ科目が2回入っています');
    const sid = actor.role === 'student' ? actor.id : v.studentId;
    if (!sid) return fail('生徒を選んでください');
    const mock = v.kind === 'mock';
    const row = {
      kind: v.kind, title: v.title, provider: mock ? v.provider : '', taken_on: v.takenOn, exam_year: mock ? null : v.year ?? null,
      total_score: v.score ?? null, total_max: v.max ?? null, passing_score: mock ? null : v.passing ?? null,
      deviation: mock ? v.deviation ?? null : null, target: mock ? v.target : '', judgement: mock ? v.judgement ?? null : null, note: v.note,
    };
    let id = v.id;
    if (id) {
      const bad = changed(await sb.from('exam_results').update(row, { count: 'exact' }).eq('id', id).eq('student_id', sid), '成績が見つかりません');
      if (bad) return fail(bad);
      // 科目は「入れ直してから、無くなった科目を消す」。以前は先に全部消してから入れていて、入れるのに失敗すると科目の点が全部消えた
      if (v.subjects.length) {
        const { error } = await sb.from('exam_subject_scores').upsert(v.subjects.map((s, i) => ({ result_id: id, subject: s.subject, score: s.score ?? null, max_score: s.max ?? null, deviation: mock ? s.deviation ?? null : null, seq: i })), { onConflict: 'result_id,subject' });
        if (error) return fail(dbError(error));
      }
      const keep = v.subjects.map(s => s.subject);
      let del = sb.from('exam_subject_scores').delete().eq('result_id', id);
      // PostgREST の in の値は "…" で囲み、中の \ と " は \ で逃がす
      if (keep.length) del = del.not('subject', 'in', `(${keep.map(k => `"${k.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`).join(',')})`);
      const { error } = await del;
      if (error) return fail(dbError(error));
      done();
      return ok('保存しました', { id: id! });
    } else {
      const { data, error } = await sb.from('exam_results').insert({ ...row, student_id: sid }).select('id').single();
      if (error) return fail(dbError(error));
      id = data.id;
    }
    if (v.subjects.length) {
      const { error } = await sb.from('exam_subject_scores').insert(v.subjects.map((s, i) => ({ result_id: id, subject: s.subject, score: s.score ?? null, max_score: s.max ?? null, deviation: mock ? s.deviation ?? null : null, seq: i })));
      if (error) {
        if (!v.id) await sb.from('exam_results').delete().eq('id', id!);
        return fail(dbError(error));
      }
    }
    done();
    return ok(v.id ? '保存しました' : mock ? '模試の結果を入れました' : '過去問の結果を入れました', { id: id! });
  });
}

export async function deleteExam(id: string): Promise<Result> {
  return withActor(['student', 'coach', 'admin'], async ({ sb }) => {
    const bad = changed(await sb.from('exam_results').delete({ count: 'exact' }).eq('id', zId.parse(id)), '成績が見つかりません');
    if (bad) return fail(bad);
    done();
    return ok('削除しました');
  });
}
