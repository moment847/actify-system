import { describe, expect, it } from 'vitest';
import { mergeSlot } from './slots';

describe('枠をまとめる', () => {
  it('重なる枠・くっつく枠は1つにまとめ、ラベルは残す', () => {
    const r = mergeSlot([{ id: 'a', start: '19:00', end: '20:00', label: '塾のあと' }, { id: 'b', start: '21:00', end: '22:00' }, { id: 'c', start: '06:00', end: '06:30' }], '20:00', '21:00');
    expect(r).toEqual({ start: '19:00', end: '22:00', label: '塾のあと', removeIds: ['a', 'b'] });
  });
  it('離れた枠はそのまま', () => {
    expect(mergeSlot([{ id: 'a', start: '06:00', end: '06:30' }], '19:00', '20:00')).toEqual({ start: '19:00', end: '20:00', label: '', removeIds: [] });
  });
});
