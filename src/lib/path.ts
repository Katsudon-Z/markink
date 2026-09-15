// パス文字列ユーティリティ (Windows/UNIX 両対応・共通化)

export function baseName(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}

export function dirName(path: string | null): string | null {
  if (!path) return null;
  return path.replace(/[\\/][^\\/]*$/, '');
}

export function stem(path: string): string {
  const base = baseName(path);
  const withoutExt = base.replace(/\.(md|markdown)$/i, '');
  return withoutExt === '' ? base : withoutExt;
}
