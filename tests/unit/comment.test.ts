import { describe, it, expect } from 'vitest';
import { createEditorState, markdownSerializer } from '../../src/lib/prosemirror/editor';
import { documentToHtml } from '../../src/lib/markdown/htmlExport';

function commentTexts(md: string): string[] {
  const state = createEditorState(md);
  const texts: string[] = [];
  state.doc.descendants((node) => {
    if (node.type.name === 'html_comment') texts.push(node.attrs.text as string);
  });
  return texts;
}

describe('HTMLコメント', () => {
  it('単独行のコメントは専用ノードとして保持される', () => {
    expect(commentTexts('<!-- メモ -->\n')).toEqual(['<!-- メモ -->']);
  });

  it('本文テキストにはコメントの内容が混ざらない', () => {
    const state = createEditorState('前 <!-- メモ --> 後\n');
    const text = state.doc.textBetween(0, state.doc.content.size);
    expect(text).toContain('前');
    expect(text).toContain('後');
    expect(text).not.toContain('メモ');
  });

  it('文中のインラインコメントも保存時に書き戻される', () => {
    const state = createEditorState('前 <!-- メモ --> 後\n');
    expect(markdownSerializer.serialize(state.doc)).toContain('<!-- メモ -->');
  });

  it('単独行のコメントも保存時に保持される', () => {
    const state = createEditorState('<!-- a -->\n');
    expect(markdownSerializer.serialize(state.doc).trim()).toBe('<!-- a -->');
  });

  it('コメント以外の HTML は従来どおりテキストとして扱う', () => {
    expect(commentTexts('<div>hello</div>\n')).toEqual([]);
    const state = createEditorState('<div>hello</div>\n');
    expect(state.doc.textBetween(0, state.doc.content.size)).toContain('<div>hello</div>');
  });

  it('HTML 書き出しでは実際の HTML コメントになる', () => {
    const state = createEditorState('本文\n\n<!-- メモ -->\n');
    const html = documentToHtml(state.doc, 'テスト');
    expect(html).toContain('<!-- メモ -->');
    expect(html).not.toContain('mdn-html-comment');
  });
});
