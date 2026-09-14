import { describe, it, expect } from 'vitest';
import { EditorState } from 'prosemirror-state';
import { TextSelection } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { applyFormat, createEditorState, defaultMarkdownSerializer } from '../../src/lib/prosemirror/editor';

function createView() {
  const el = document.createElement('div');
  document.body.appendChild(el);
  const state = createEditorState();
  const view = new EditorView(el, { state });
  return view;
}

describe('applyFormat', () => {
  it('太字マークを適用できる', () => {
    const view = createView();
    const tr = view.state.tr;
    tr.insertText('テスト');
    view.dispatch(tr);
    const sel = TextSelection.create(view.state.doc, 1, 4);
    view.dispatch(view.state.tr.setSelection(sel).addMark(1, 4, view.state.schema.marks.strong.create()));
    expect(defaultMarkdownSerializer.serialize(view.state.doc)).toContain('**');
    view.destroy();
  });

  it('見出しに変換できる', () => {
    const view = createView();
    applyFormat(view, 'h1');
    expect(view.state.doc.firstChild?.type.name).toBe('heading');
    expect((view.state.doc.firstChild as { attrs: { level: number } }).attrs.level).toBe(1);
    view.destroy();
  });

  it('段落に戻せる', () => {
    const view = createView();
    applyFormat(view, 'h2');
    applyFormat(view, 'paragraph');
    expect(view.state.doc.firstChild?.type.name).toBe('paragraph');
    view.destroy();
  });

  it('種別が未知の場合は安全に終了する', () => {
    const view = createView();
    const before = view.state.doc.eq(view.state.doc);
    expect(() => applyFormat(view, 'unknown')).not.toThrow();
    expect(before).toBe(true);
    view.destroy();
  });
});


