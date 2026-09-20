import { describe, it, expect } from 'vitest';
import { EditorView } from 'prosemirror-view';
import { createEditorState, markdownSerializer } from '../../src/lib/prosemirror/editor';
import { FORMATS, getFormat, applyFormat, warekiText } from '../../src/lib/prosemirror/commands';

function createView() {
  const el = document.createElement('div');
  document.body.appendChild(el);
  const view = new EditorView(el, { state: createEditorState() });
  return view;
}

describe('書式コマンドレジストリ (拡張性)', () => {
  it('ID が一意で、ツールチップ(日本語の用途説明)を持つ', () => {
    const ids = FORMATS.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const format of FORMATS) {
      expect(format.label.length).toBeGreaterThan(0);
      expect(format.title.length).toBeGreaterThan(0);
      expect(typeof format.run).toBe('function');
    }
  });

  it('ツールバーが必要とする主要コマンドが登録されている', () => {
    for (const id of [
      'h1',
      'h2',
      'paragraph',
      'bold',
      'italic',
      'list',
      'orderedList',
      'quote',
      'code',
      'link',
      'undo',
      'redo'
    ]) {
      expect(getFormat(id), `${id} が未登録`).toBeDefined();
    }
  });

  it('未知の ID でも例外を出さない', () => {
    const view = createView();
    expect(() => applyFormat(view, 'unknown-format')).not.toThrow();
    view.destroy();
  });

  it('レジストリ経由で見出しと太字を適用できる', () => {
    const view = createView();
    applyFormat(view, 'h1');
    expect(view.state.doc.firstChild?.type.name).toBe('heading');

    const tr = view.state.tr;
    tr.insertText('テスト');
    view.dispatch(tr);
    applyFormat(view, 'bold');
    applyFormat(view, 'paragraph');
    expect(view.state.doc.firstChild?.type.name).toBe('paragraph');
    view.destroy();
  });

  it('link は payload の href をマークに適用する', () => {
    const view = createView();
    const tr = view.state.tr;
    tr.insertText('リンク');
    view.dispatch(tr);
    const sel = view.state.tr.setSelection(
      // 全文を選択してマークを適用
      (view.state.selection.constructor as typeof import('prosemirror-state').TextSelection).create(
        view.state.doc,
        1,
        4
      )
    );
    view.dispatch(sel);
    applyFormat(view, 'link', { href: 'https://example.com' });
    expect(markdownSerializer.serialize(view.state.doc)).toContain('https://example.com');
    view.destroy();
  });
});
