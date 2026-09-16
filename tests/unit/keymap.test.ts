import { describe, it, expect } from 'vitest';
import { EditorView } from 'prosemirror-view';
import { TextSelection, type Command } from 'prosemirror-state';
import { createEditorState, markdownSerializer } from '../../src/lib/prosemirror/editor';
import { splitListItemOnEnter, insertHardBreak } from '../../src/lib/prosemirror/plugins';

function createView(markdown?: string) {
  const el = document.createElement('div');
  document.body.appendChild(el);
  return new EditorView(el, { state: createEditorState(markdown) });
}

function runCommand(view: EditorView, command: Command): boolean {
  return command(
    view.state,
    (tr) => {
      view.dispatch(tr);
      return true;
    },
    view
  );
}

function placeCursorAtEnd(view: EditorView) {
  view.dispatch(view.state.tr.setSelection(TextSelection.atEnd(view.state.doc)));
}

function countNodeType(view: EditorView, name: string): number {
  let count = 0;
  view.state.doc.descendants((node) => {
    if (node.type.name === name) count += 1;
    return true;
  });
  return count;
}

describe('Enter / Shift+Enter の挙動 (箇条書き)', () => {
  it('箇条書きで Enter を押すと次の項目が増える', () => {
    const view = createView('- 項目1\n- 項目2\n');
    placeCursorAtEnd(view);
    expect(runCommand(view, splitListItemOnEnter)).toBe(true);

    const list = view.state.doc.firstChild;
    expect(list?.type.name).toBe('bullet_list');
    expect(list?.childCount).toBe(3);
    view.destroy();
  });

  it('番号付きリストでも Enter で次の項目が増える', () => {
    const view = createView('1. 手順1\n');
    placeCursorAtEnd(view);
    expect(runCommand(view, splitListItemOnEnter)).toBe(true);

    const list = view.state.doc.firstChild;
    expect(list?.type.name).toBe('ordered_list');
    expect(list?.childCount).toBe(2);
    view.destroy();
  });

  it('リスト外では Enter コマンドを適用しない (fallback に委ねる)', () => {
    const view = createView('ただの段落\n');
    placeCursorAtEnd(view);
    expect(runCommand(view, splitListItemOnEnter)).toBe(false);
    view.destroy();
  });

  it('Shift+Enter は項目を増やさず、同じ項目内に改行を入れる', () => {
    const view = createView('- 項目1\n');
    placeCursorAtEnd(view);
    expect(runCommand(view, insertHardBreak)).toBe(true);
    view.dispatch(view.state.tr.insertText('続き'));

    // リスト項目は増えない
    expect(view.state.doc.firstChild?.childCount).toBe(1);
    // 改行ノードが1つだけ入る
    expect(countNodeType(view, 'hard_break')).toBe(1);
    // Markdown にも改行が反映される
    expect(markdownSerializer.serialize(view.state.doc)).toContain('\n');
    view.destroy();
  });
});
