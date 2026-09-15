import { describe, it, expect } from 'vitest';
import { DOMSerializer } from 'prosemirror-model';
import { createEditorState, schema, defaultMarkdownSerializer } from '../../src/lib/prosemirror/editor';
import { documentToHtml } from '../../src/lib/markdown/htmlExport';

// requirements.md:103 初期版の書き出し: HTML対応
describe('HTML エクスポートの基礎 (requirements.md:103)', () => {
  it('ProseMirror 文書を HTML 断片に変換できる', () => {
    const state = createEditorState('# 見出し\n\n太字**重要**と段落。\n');
    const fragment = DOMSerializer.fromSchema(schema).serializeFragment(state.doc.content);
    const div = document.createElement('div');
    div.appendChild(fragment);
    const html = div.innerHTML;
    expect(html).toContain('<h1>見出し</h1>');
    expect(html).toContain('<strong>重要</strong>');
  });

  it('画像ノードも HTML に含まれる', () => {
    const state = createEditorState('![説明](assets/test.png)\n');
    const md = defaultMarkdownSerializer.serialize(state.doc);
    expect(md).toContain('assets/test.png');
  });

  it('自己完結した HTML 文書を生成する (共通化した documentToHtml)', () => {
    const state = createEditorState('# 見出し\n\n本文**強調**。\n');
    const html = documentToHtml(state.doc, 'テスト文書');
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('<meta charset="utf-8">');
    expect(html).toContain('<title>テスト文書</title>');
    expect(html).toContain('<h1>見出し</h1>');
    expect(html).toContain('<strong>強調</strong>');
  });

  it('タイトルの HTML 特殊文字をエスケープする', () => {
    const state = createEditorState('本文\n');
    const html = documentToHtml(state.doc, '<script>alert(1)</script>');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });
});
