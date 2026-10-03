// Excel から貼り付けた「教材名」「範囲」の2列（タブ区切り）を、教材ごとの範囲の一覧にする（モックの pasteBooks）
export function parsePastedBooks(text: string): { name: string; lines: string[] }[] {
  const by = new Map<string, string[]>();
  text.split(/\r?\n/).map(l => l.split('\t')).filter(c => c[0]?.trim() && c[1]?.trim()).forEach(([n, r]) => {
    const name = n.trim();
    if (!by.has(name)) by.set(name, []);
    by.get(name)!.push(r.trim());
  });
  return [...by.entries()].map(([name, lines]) => ({ name, lines }));
}
