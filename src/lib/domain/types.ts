// 計算に使うデータの形。DB の行（snake_case）からは src/lib/data/load.ts で組み立てる。
// 画面にも DB にも依存しない（テストではモックのデータから組み立てる）。

export type DateStr = string; // 'YYYY-MM-DD'（生徒の暦の上の日付）
export type TimeStr = string; // 'HH:MM'

export type Subject = 'english' | 'math' | 'japanese' | 'science' | 'social' | 'other';
export type MaterialKind = 'input' | 'practice';
export type VagueKind = 'buffer' | 'mock' | 'school' | 'weak' | 'free';
export type FeedbackTag = 'easy' | 'just_right' | 'hard' | 'not_enough_time';

export interface Unit {
  id: string;
  label: string;
}

export interface Material {
  id: string;
  name: string;
  short: string;
  subject: Subject;
  kind: MaterialKind;
  /** 再テストの間隔（日）。インプットだけ */
  intervals: number[];
  /** PDFのファイル名・自由入力で教材を見分ける言葉 */
  keywords: string[];
  units: Unit[];
  archived?: boolean;
}

export interface QuizVersion {
  id: string;
  unitId: string;
  version: number;
  max: number;
}

export interface Feedback {
  tag: FeedbackTag | null;
  body: string;
  date?: DateStr;
}

export interface Task {
  id: string;
  studentId: string;
  date: DateStr;
  time: TimeStr;
  duration: number;
  /** 教材の予定なら教材と範囲。時間だけ取る予定なら null で vague と title を持つ */
  materialId: string | null;
  unitId: string | null;
  vague: VagueKind | null;
  title: string | null;
  status: 'todo' | 'done';
  quizVersionId: string | null;
  max: number | null;
  noQuiz: boolean;
  retest: boolean;
  score: number | null;
  actual: number | null;
  startedAt?: string | null;
  pausedAt?: string | null;
  pausedMs?: number;
  feedback?: Feedback | null;
  reply?: { body: string; date?: DateStr } | null;
}

/** 勉強できる時間。date（この週だけ）か weekday（毎週、0=月）のどちらか */
export interface StudySlot {
  id: string;
  studentId: string;
  date: DateStr | null;
  weekday: number | null;
  start: TimeStr;
  end: TimeStr;
  label: string;
}

export interface Book {
  studentId: string;
  materialId: string;
  start: DateStr;
  target: DateStr;
}

export interface Meeting {
  id: string;
  studentId: string;
  coachId?: string;
  date: DateStr;
  time: TimeStr;
  len: number;
}

export interface CoachOpenSlot {
  id: string;
  date: DateStr | null;
  weekday: number | null;
  start: TimeStr;
  end: TimeStr;
}

/** 計算に必要なものを1つにまとめたもの（1人の講師・1つの塾の範囲で読み込む） */
export interface World {
  today: DateStr;
  materials: Material[];
  quizVersions: QuizVersion[];
  tasks: Task[];
  slots: StudySlot[];
  /** 毎週の枠を休む日：`${slotId}:${date}` */
  slotSkips: Set<string>;
  books: Book[];
  meetings: Meeting[];
  coachOpen: CoachOpenSlot[];
  /** 面談の1回の長さ（分） */
  meetingLength: number;
  /** coachOpen（面談できる時間）の講師。ほかの講師の面談は、この講師の埋まっている時間に数えない */
  meetingCoachId?: string | null;
  /** 講師が見送った再テスト：`rv:${studentId}:${unitId}:${回数}` */
  reviewSkips: Set<string>;
}

export const SUBJECT_LABEL: Record<Subject, string> = {
  english: '英語', math: '数学', japanese: '国語', science: '理科', social: '社会', other: 'その他',
};
export const KIND_LABEL: Record<MaterialKind, string> = { input: 'インプット', practice: '演習' };
export const TAG_LABEL: Record<FeedbackTag, string> = {
  easy: 'かんたん', just_right: 'ちょうどいい', hard: 'むずかしい', not_enough_time: '時間が足りない',
};
export const TAGS: FeedbackTag[] = ['easy', 'just_right', 'hard', 'not_enough_time'];

/** 時間だけ取る予定（教材なし）。長さは既定値 */
export const VAGUE: { k: VagueKind; label: string; dur: number; note?: string }[] = [
  { k: 'buffer', label: '予備時間', dur: 30, note: 'やり残しが出たらここで' },
  { k: 'mock', label: '模試の復習', dur: 90 },
  { k: 'school', label: '学校の課題', dur: 60 },
  { k: 'weak', label: '苦手の復習', dur: 45 },
];
