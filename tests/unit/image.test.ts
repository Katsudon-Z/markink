import { describe, it, expect, vi, beforeEach } from 'vitest';
import { resolveImageAbsolute, fileUriToPath } from '../../src/lib/prosemirror/image';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: async (cmd: string) => {
    if (cmd === 'read_file_bytes') return [0x89, 0x50, 0x4e, 0x47];
    throw new Error(`unexpected invoke: ${cmd}`);
  }
}));

describe('画像パスの解決 (プレビュー表示用)', () => {
  it('リモート・data は解決対象外 (null)', () => {
    expect(resolveImageAbsolute('https://example.com/a.png', 'C:\\docs')).toBeNull();
    expect(resolveImageAbsolute('data:image/png;base64,AAA', 'C:\\docs')).toBeNull();
  });

  it('file URI をパスに戻す', () => {
    expect(resolveImageAbsolute('file:///C:/docs/a.png', null)).toBe('C:\\docs\\a.png');
    expect(resolveImageAbsolute('file:///C:/docs/a%20b.png', null)).toBe('C:\\docs\\a b.png');
  });

  it('相対パスを文書フォルダ基準で解決する', () => {
    expect(resolveImageAbsolute('assets/a.png', 'C:\\docs')).toBe('C:\\docs\\assets\\a.png');
    expect(resolveImageAbsolute('../pics/a.png', 'C:\\docs\\sub')).toBe('C:\\docs\\sub\\..\\pics\\a.png');
  });

  it('未保存文書の相対参照は解決できない', () => {
    expect(resolveImageAbsolute('assets/a.png', null)).toBeNull();
    expect(resolveImageAbsolute('', 'C:\\docs')).toBeNull();
  });

  it('file URI をパスに戻す', () => {
    expect(fileUriToPath('file:///C:/docs/a.png')).toBe('C:\\docs\\a.png');
    expect(fileUriToPath('file:///C:/docs/a%20b.png')).toBe('C:\\docs\\a b.png');
    expect(fileUriToPath('file://NAS01/tmp/a.jpg')).toBe('\\\\NAS01\\tmp\\a.jpg');
    expect(fileUriToPath('file:////NAS01/tmp/a.jpg')).toBe('\\\\NAS01\\tmp\\a.jpg');
    expect(fileUriToPath('file://')).toBeNull();
  });

  it('file URI の画像が読込時に画像ノードになる', async () => {
    const { markdownParser } = await import('../../src/lib/prosemirror/editor');
    for (const src of [
      'file:////NAS01/tmp/a.jpg',
      'file:///C:/docs/a.png',
      'assets/a.png',
      'https://example.com/a.png'
    ]) {
      const doc = markdownParser.parse(`![a](${src})`);
      let found: string | null = null;
      doc.descendants((n) => {
        if (n.type.name === 'image') found = String(n.attrs.src ?? '');
        return found == null;
      });
      expect(found).toBe(src);
    }
    // 危険なスキームは画像化しない
    const evil = markdownParser.parse('![a](javascript:alert(1))');
    let evilFound = false;
    evil.descendants((n) => {
      if (n.type.name === 'image') evilFound = true;
      return true;
    });
    expect(evilFound).toBe(false);
  });

  it('文書読込時に画像がバイト解決されて表示される', async () => {
    const { createEditorState, createEditorView } = await import(
      '../../src/lib/prosemirror/editor'
    );
    // jsdom に無い場合は blob URL をスタブする (解決ロジックの検証が目的)
    const origCreate = URL.createObjectURL;
    const origRevoke = URL.revokeObjectURL;
    let created = 0;
    URL.createObjectURL = (() => {
      created += 1;
      return `blob:mock-${created}`;
    }) as typeof URL.createObjectURL;
    URL.revokeObjectURL = (() => {}) as typeof URL.revokeObjectURL;
    try {
      const el = document.createElement('div');
      document.body.appendChild(el);
      // loadMarkdown と同じ順序: フォルダ確定 → updateState (nodeView は最新の dir を読む)
      let dir: string | null = null;
      const view = createEditorView(el, createEditorState(''), undefined, () => dir);
      dir = 'C:\\docs';
      view.updateState(createEditorState('![a](assets/a.png)'));
      await new Promise((r) => setTimeout(r, 50));
      const img = el.querySelector('img');
      expect(img).not.toBeNull();
      expect(created).toBeGreaterThan(0);
      expect(img!.src.startsWith('blob:')).toBe(true);
      view.destroy();
    } finally {
      if (origCreate) {
        URL.createObjectURL = origCreate;
      } else {
        delete (URL as Record<string, unknown>).createObjectURL;
      }
      if (origRevoke) {
        URL.revokeObjectURL = origRevoke;
      } else {
        delete (URL as Record<string, unknown>).revokeObjectURL;
      }
    }
  });
});
