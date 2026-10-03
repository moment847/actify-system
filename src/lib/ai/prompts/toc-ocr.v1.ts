// 目次の写真から、教材名と範囲の一覧を読み取るプロンプト
export const TOC_OCR_PROMPT_VERSION = 'toc-ocr.v1';

export const TOC_OCR_INSTRUCTION = `これは参考書・問題集の目次のページの写真です。教材として登録するために、次を読み取ってください。

- name：表紙や見出しから分かる教材名。分からなければ空の文字列。
- subject：english / math / japanese / science / social / other のどれか。
- kind：覚える教材（単語帳・一問一答など）なら input、解く教材（問題集・長文など）なら practice。
- lines：1回の学習で進める単位（章・節・Unit・番号の範囲）を、目次の順に1行ずつ。ページ番号は入れない。
  番号の範囲は「001–100」のように「–」でつなぐ。目次に無い行は作らない。読めない行は飛ばす。`;
