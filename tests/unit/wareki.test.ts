import { describe, it, expect } from 'vitest';
import { EditorView } from 'prosemirror-view';
import { createEditorState } from '../../src/lib/prosemirror/editor';
import { applyFormat, warekiText } from '../../src/lib/prosemirror/commands';

function createView() {
  const el = document.createElement('div');
  document.body.appendChild(el);
  return new EditorView(el, { state: createEditorState() });
}

describe('和暦変換', () => {
  it('元号の境界で正しく変換する', () => {
    expect(warekiText(new Date(2026, 8, 19))).toBe('令和8年9月19日');
    expect(warekiText(new Date(2019, 4, 1))).toBe('令和元年5月1日');
    expect(warekiText(new Date(2019, 3, 30))).toBe('平成31年4月30日');
    expect(warekiText(new Date(1989, 0, 8))).toBe('平成元年1月8日');
    expect(warekiText(new Date(1989, 0, 7))).toBe('昭和64年1月7日');
  });

  it('日付コマンドが挿入できる', () => {
    const view = createView();
    applyFormat(view, 'date');
    expect(view.state.doc.textContent).toMatch(/\d{4}\/\d{2}\/\d{2}/);
    applyFormat(view, 'dateWareki');
    expect(view.state.doc.textContent).toMatch(/令和|平成|昭和|大正|明治/);
    view.destroy();
  });
});
