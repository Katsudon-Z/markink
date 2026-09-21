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

/**
 * fromDir から toPath への相対パスを求める (Markdown の画像参照用)。
 * 区切りは `/` に統一する。別ドライブなど相対化できない場合は null。
 */
export function relativePath(fromDir: string, toPath: string): string | null {
  const from = fromDir.replace(/\\/g, '/').replace(/\/+$/, '').split('/');
  const to = toPath.replace(/\\/g, '/').split('/');
  if (from.length === 0 || to.length === 0) return null;
  const drive = (s: string) => (/^[A-Za-z]:$/.test(s) ? s.toLowerCase() : null);
  const fromDrive = drive(from[0]);
  const toDrive = drive(to[0]);
  if (fromDrive || toDrive) {
    if (fromDrive !== toDrive) return null;
  }
  let i = 0;
  while (
    i < from.length &&
    i < to.length &&
    from[i].toLowerCase() === to[i].toLowerCase()
  ) {
    i += 1;
  }
  const up = from.length - i;
  const parts = [...Array<string>(up).fill('..'), ...to.slice(i)];
  const rel = parts.join('/');
  return rel === '' ? null : rel;
}

/** ローカルパスを file:/// URI に変換する (絶対参照用) */
export function toFileUri(path: string): string {
  const forward = path.replace(/\\/g, '/').replace(/^\//, '');
  return 'file:///' + encodeURI(forward);
}
