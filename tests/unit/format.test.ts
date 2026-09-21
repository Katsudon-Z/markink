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

  it('太字のあと斜体を重ねられる', () => {
    const view = createView('hello');
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1, 6)));
    applyFormat(view, 'bold');
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1, 6)));
    applyFormat(view, 'italic');
    const marks: string[] = [];
    view.state.doc.descendants((n) => {
      n.marks.forEach((m) => marks.push(m.type.name));
      return true;
    });
    expect(marks).toContain('strong');
    expect(marks).toContain('em');
    view.destroy();
  });

  it('見出しレベルを切り替えられる', () => {
    const view = createView('title');
    applyFormat(view, 'h1');
    expect(view.state.doc.firstChild?.type.name).toBe('heading');
    applyFormat(view, 'h2');
    expect((view.state.doc.firstChild as { attrs: { level: number } }).attrs.level).toBe(2);
    applyFormat(view, 'paragraph');
    expect(view.state.doc.firstChild?.type.name).toBe('paragraph');
    view.destroy();
  });

  it('箇条書きの項目に見出しを適用できる (リストから持ち上がる)', () => {
    const view = createView('- あああああ\n');
    const end = TextSelection.atEnd(view.state.doc).from;
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, end)));
    applyFormat(view, 'h1');
    expect(view.state.doc.firstChild?.type.name).toBe('heading');
    expect(view.state.doc.firstChild?.textContent).toContain('あああああ');
    expect(view.state.doc.textContent).not.toContain('•');
    view.destroy();
  });

  it('箇条書き→本文でリストから出られる', () => {
    const view = createView('- 項目\n');
    const end = TextSelection.atEnd(view.state.doc).from;
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, end)));
    applyFormat(view, 'paragraph');
    expect(view.state.doc.firstChild?.type.name).toBe('paragraph');
    expect(view.state.doc.textContent).toContain('項目');
    view.destroy();
  });

  it('H1→箇条書きでリスト化できる', () => {
    const view = createView('# 見出し\n');
    const end = TextSelection.atEnd(view.state.doc).from;
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, end)));
    applyFormat(view, 'list');
    expect(view.state.doc.firstChild?.type.name).toBe('bullet_list');
    expect(view.state.doc.textContent).toContain('見出し');
    view.destroy();
  });

  it('箇条書き→番号付きリストに変換できる', () => {
    const view = createView('- 項目\n');
    const end = TextSelection.atEnd(view.state.doc).from;
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, end)));
    applyFormat(view, 'orderedList');
    expect(view.state.doc.firstChild?.type.name).toBe('ordered_list');
    expect(view.state.doc.textContent).toContain('項目');
    view.destroy();
  });

  it('同じリストの再適用で解除される', () => {
    const view = createView('- 項目\n');
    const end = TextSelection.atEnd(view.state.doc).from;
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, end)));
    applyFormat(view, 'list');
    expect(view.state.doc.firstChild?.type.name).toBe('paragraph');
    view.destroy();
  });

  it('番号付きリストの2階層目をH1にすると最上位の見出しになる', () => {
    const view = createView('1. a\n   1. nested\n');
    // 入れ子の項目内にカーソルを置く
    let nestedPos = -1;
    view.state.doc.descendants((node, pos) => {
      if (node.isTextblock && node.textContent.includes('nested')) {
        nestedPos = pos + 1;
        return false;
      }
      return true;
    });
    expect(nestedPos).toBeGreaterThan(0);
    view.dispatch(
      view.state.tr.setSelection(TextSelection.create(view.state.doc, nestedPos))
    );
    applyFormat(view, 'h1');
    const headings: string[] = [];
    view.state.doc.descendants((node) => {
      if (node.type.name === 'heading') headings.push(node.textContent);
      return true;
    });
    expect(headings.some((t) => t.includes('nested'))).toBe(true);
    // 入れ子が残っていないこと (深さ2以上のリストが無い)
    const depths: number[] = [];
    const rec = (node: unknown, depth: number): void => {
      const n = node as { type: { name: string }; forEach?: (f: (c: unknown) => void) => void };
      if (n.type.name === 'bullet_list' || n.type.name === 'ordered_list') depths.push(depth);
      n.forEach?.((c) => rec(c, depth + 1));
    };
    rec(view.state.doc, 0);
    expect(Math.max(...depths, 0)).toBeLessThanOrEqual(1);
    view.destroy();
  });
});


