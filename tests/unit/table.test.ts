import { describe, it, expect } from 'vitest';
import { EditorView } from 'prosemirror-view';
import { applyFormat, createEditorState, markdownSerializer } from '../../src/lib/prosemirror/editor';

function createView(markdown?: string) {
  const el = document.createElement('div');
  document.body.appendChild(el);
  return new EditorView(el, { state: createEditorState(markdown) });
}

describe('表の追加・修正', () => {
  it('空の文書 (起動直後) でも表を挿入できる', () => {
    const view = createView();
    applyFormat(view, 'table');

    const table = view.state.doc.firstChild;
    expect(table?.type.name).toBe('table');
    expect(table?.childCount).toBe(3);
    const firstRow = table?.firstChild;
    expect(firstRow?.childCount).toBe(3);
    firstRow?.forEach((cell) => expect(cell.type.name).toBe('table_header'));
    // 表の後ろに書き足せるよう空の段落が用意される
    expect(view.state.doc.lastChild?.type.name).toBe('paragraph');
    view.destroy();
  });

  it('文字のある段落は残したまま、その直後に表を挿入する', () => {
    const view = createView('本文\n');
    applyFormat(view, 'table');
    expect(view.state.doc.firstChild?.type.name).toBe('paragraph');
    expect(view.state.doc.child(1).type.name).toBe('table');
    view.destroy();
  });

  it('挿入後は先頭セルにカーソルがあり、行や列を増減できる', () => {
    const view = createView();
    applyFormat(view, 'table');

    applyFormat(view, 'rowAdd');
    expect(view.state.doc.firstChild?.childCount).toBe(4);
    applyFormat(view, 'columnAdd');
    expect(view.state.doc.firstChild?.firstChild?.childCount).toBe(4);
    applyFormat(view, 'rowDelete');
    expect(view.state.doc.firstChild?.childCount).toBe(3);
    applyFormat(view, 'columnDelete');
    expect(view.state.doc.firstChild?.firstChild?.childCount).toBe(3);

    applyFormat(view, 'tableDelete');
    expect(view.state.doc.firstChild?.type.name).toBe('paragraph');
    view.destroy();
  });

  it('表の外では行・列の操作は何も起きない', () => {
    const view = createView('ただの段落\n');
    const before = view.state.doc.toJSON();
    applyFormat(view, 'rowAdd');
    applyFormat(view, 'columnAdd');
    expect(view.state.doc.toJSON()).toEqual(before);
    view.destroy();
  });
});

describe('表の Markdown 入出力', () => {
  it('GFM の表を解析できる', () => {
    const state = createEditorState('| 名前 | 値 |\n| --- | --- |\n| あ | 1 |\n');
    const table = state.doc.firstChild;
    expect(table?.type.name).toBe('table');
    expect(table?.childCount).toBe(2);
    expect(table?.textContent).toContain('名前');
    expect(table?.textContent).toContain('あ');
  });

  it('解析した表をそのまま書き戻せる', () => {
    const md = '| 名前 | 値 |\n| --- | --- |\n| あ | 1 |\n';
    const out = markdownSerializer.serialize(createEditorState(md).doc);
    expect(out).toContain('| 名前 | 値 |');
    expect(out).toContain('| --- | --- |');
    expect(out).toContain('| あ | 1 |');
  });

  it('挿入した空の表も Markdown に書き出せる', () => {
    const view = createView('本文\n');
    applyFormat(view, 'table');
    const out = markdownSerializer.serialize(view.state.doc);
    expect(out).toContain('| --- | --- | --- |');
    expect(out.split('\n').filter((line) => line.startsWith('|')).length).toBe(4);
    view.destroy();
  });
});
