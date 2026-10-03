import { describe, expect, it } from 'vitest';
import { parsePastedBooks } from './materials';

describe('Excel から貼り付け', () => {
  it('教材名ごとにまとめ、空の行と1列だけの行は飛ばす', () => {
    expect(parsePastedBooks('システム英単語\t1–100\nシステム英単語\t101–200\n\n見出しだけ\n青チャート\t第1章\r\n')).toEqual([
      { name: 'システム英単語', lines: ['1–100', '101–200'] },
      { name: '青チャート', lines: ['第1章'] },
    ]);
  });
});
