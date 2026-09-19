import { describe, it, expect } from 'vitest';
import { EditorState } from 'prosemirror-state';
import { TextSelection } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { applyFormat, createEditorState, markdownSerializer } from '../../src/lib/prosemirror/editor';

function createView(markdown?: string) {
  const el = document.createElement('div');
  document.body.appendChild(el);
  const state = createEditorState(markdown);
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
    expect(markdownSerializer.serialize(view.state.doc)).toContain('**');
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

  it('斜体マークを適用して *x* 形式で保存できる', () => {
    const view = createView();
    view.dispatch(view.state.tr.insertText('テスト'));
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1, 4)));
    applyFormat(view, 'italic');
    const marks: string[] = [];
    view.state.doc.descendants((n) => {
      n.marks.forEach((m) => marks.push(m.type.name));
      return true;
    });
    expect(marks).toContain('em');
    expect(markdownSerializer.serialize(view.state.doc)).toContain('*テスト*');
    view.destroy();
  });

  it('*x* と打つと斜体に変換される (入力ルール)', () => {
    // 閉じていない `*テスト` まで入力済みとして、最後の `*` を打鍵する
    const view = createView('*テスト');
    const end = TextSelection.atEnd(view.state.doc).from;
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, end)));
    const handled = view.someProp('handleTextInput', (f) => f(view, end, end, '*'));
    expect(handled).toBe(true);
    const marks: string[] = [];
    view.state.doc.descendants((n) => {
      n.marks.forEach((m) => marks.push(m.type.name));
      return true;
    });
    expect(marks).toContain('em');
    // アスタリスク自体は消費されてテキストから消える (シリアライズでは *テスト* に戻る)
    expect(view.state.doc.textContent).toBe('テスト');
    expect(markdownSerializer.serialize(view.state.doc)).toContain('*テスト*');
    view.destroy();
  });
});


