import { describe, it, expect } from 'vitest';
import { baseName, dirName, stem } from '../../src/lib/path';

describe('パスユーティリティ (共通化)', () => {
  it('Windows/UNIX 両対応でファイル名を取得する', () => {
    expect(baseName('C:\\docs\\a.md')).toBe('a.md');
    expect(baseName('/home/user/a.md')).toBe('a.md');
    expect(baseName('a.md')).toBe('a.md');
  });

  it('親フォルダを取得する', () => {
    expect(dirName('C:\\docs\\a.md')).toBe('C:\\docs');
    expect(dirName('/home/user/a.md')).toBe('/home/user');
    expect(dirName(null)).toBeNull();
  });

  it('拡張子を除いた文書名を取得する (ルーム名の一致に必須)', () => {
    expect(stem('C:\\docs\\議事録.md')).toBe('議事録');
    expect(stem('/share/notes.markdown')).toBe('notes');
    expect(stem('拡張子なし')).toBe('拡張子なし');
  });
});
