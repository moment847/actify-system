// 時間の枠（勉強できる時間・面談できる時間）を足すとき、同じ日の重なる枠・くっつく枠は1つにまとめる（モックの addAvail / addCoachOpen）
import type { TimeStr } from './types';

export interface SimpleSlot { id: string; start: TimeStr; end: TimeStr; label?: string }

export function mergeSlot(sameDay: SimpleSlot[], start: TimeStr, end: TimeStr) {
  const touching = sameDay.filter(a => a.start <= end && a.end >= start);
  let s = start, e = end, label = '';
  touching.forEach(a => { if (a.start < s) s = a.start; if (a.end > e) e = a.end; label ||= a.label || ''; });
  return { start: s, end: e, label, removeIds: touching.map(a => a.id) };
}
