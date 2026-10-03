// ファイルのパスが、決まったフォルダ（塾のID/ や 塾のID/生徒のID/）の中にあるか。
// DB の private.path_in と同じ決まり（「.」「..」の段と「\」を含まない）。サーバが期限つきURLを作る前にも確かめる
export function pathIn(path: string | null | undefined, prefix: string): path is string {
  if (!path || !prefix.endsWith('/')) return false;
  if (!path.startsWith(prefix) || path.length <= prefix.length) return false;
  if (path.includes('\\')) return false;
  return !path.split('/').some(seg => seg === '.' || seg === '..');
}

/** ログイン後などの転送先。同じオリジンのパスだけを返し、それ以外は fallback（外部サイトへ飛ばさない） */
export function safeNext(next: string | null | undefined, origin: string, fallback = '/'): string {
  if (!next) return fallback;
  try {
    const base = new URL(origin);
    const u = new URL(next, base);
    if (u.origin !== base.origin) return fallback;
    return u.pathname + u.search + u.hash;
  } catch {
    return fallback;
  }
}
