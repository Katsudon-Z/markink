import { describe, it, expect, beforeEach } from 'vitest';
import { EditorView } from 'prosemirror-view';
import { createEditorState } from '../../src/lib/prosemirror/editor';
import { getOutline, searchDocument } from '../../src/lib/mcp/document';
import { clearAiCursor, getAiCursor } from '../../src/lib/mcp/presence';
import {
  getToolHandler,
  registeredToolNames,
  TOOL_MANIFEST
} from '../../src/lib/mcp/tools';
import type { ToolContext, ToolHandler } from '../../src/lib/mcp/types';

/** 同期throw・非同期reject のどちらもエラーとして受け取る */
async function expectToolError(
  handler: ToolHandler,
  args: Record<string, unknown>,
  ctx: ToolContext,
  contains?: string
) {
  try {
    await handler(args, ctx);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (contains !== undefined) expect(message).toContain(contains);
    return;
  }
  throw new Error('ツールがエラーを返しませんでした');
}

function createView(markdown?: string) {
  const el = document.createElement('div');
  document.body.appendChild(el);
  return new EditorView(el, { state: createEditorState(markdown) });
}

function makeCtx(view: EditorView, overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    getView: () => view,
    getTitle: () => 'テスト文書',
    getPath: () => 'C:\\docs\\test.md',
    isDirty: () => true,
    saveDocument: async () => ({ path: 'C:\\docs\\test.md' }),
    confirmFullReplace: async () => true,
    aiAutoSaveEnabled: async () => true,
    notifyHuman: () => {},
    ...overrides
  };
}

beforeEach(() => {
  clearAiCursor();
});

describe('MCP ツール定義の整合性', () => {
  it('登録済みツールはすべてマニフェストに存在する', () => {
    const names = new Set(TOOL_MANIFEST.map((t) => t.name));
    for (const name of registeredToolNames()) {
      expect(names.has(name), `${name} が shared/mcp-tools.json にありません`).toBe(true);
    }
  });

  it('M2 の読み取り・カーソル系ツールが登録されている', () => {
    for (const name of ['get_document', 'search', 'get_outline', 'get_cursor', 'set_cursor']) {
      expect(getToolHandler(name), `${name} が未登録`).toBeDefined();
    }
  });

  it('未知のツールは undefined', () => {
    expect(getToolHandler('no_such_tool')).toBeUndefined();
  });
});

describe('get_document', () => {
  it('Markdown・タイトル・パス・dirty を返す', async () => {
    const view = createView('# 見出し\n\n本文です\n');
    const handler = getToolHandler('get_document')!;
    const result = (await handler({}, makeCtx(view))) as {
      title: string;
      path: string;
      dirty: boolean;
      markdown: string;
      truncated: boolean;
    };
    expect(result.title).toBe('テスト文書');
    expect(result.path).toBe('C:\\docs\\test.md');
    expect(result.dirty).toBe(true);
    expect(result.truncated).toBe(false);
    expect(result.markdown).toContain('# 見出し');
    expect(result.markdown).toContain('本文です');
    view.destroy();
  });

  it('エディタ未準備ではエラー', async () => {
    const handler = getToolHandler('get_document')!;
    await expectToolError(
      handler,
      {},
      makeCtx(null as unknown as EditorView, { getView: () => null }),
      'エディタが準備できていません'
    );
  });
});

describe('search', () => {
  it('一致位置と抜粋を返す', async () => {
    const view = createView('りんごとみかん、りんごジュース\n');
    const handler = getToolHandler('search')!;
    const result = (await handler({ query: 'りんご' }, makeCtx(view))) as {
      matches: { from: number; to: number; excerpt: string }[];
    };
    expect(result.matches.length).toBe(2);
    for (const m of result.matches) {
      // 返された位置のテキストが実際に一致する
      const text = view.state.doc.textBetween(m.from, m.to);
      expect(text).toBe('りんご');
      expect(m.excerpt).toContain('りんご');
    }
    view.destroy();
  });

  it('大文字小文字を区別しない・正規表現・空クエリの扱い', async () => {
    const view = createView('Apple apple\n');
    const handler = getToolHandler('search')!;
    const insensitive = (await handler({ query: 'apple' }, makeCtx(view))) as { matches: unknown[] };
    expect(insensitive.matches.length).toBe(2);
    const sensitive = (await handler(
      { query: 'apple', caseSensitive: true },
      makeCtx(view)
    )) as { matches: unknown[] };
    expect(sensitive.matches.length).toBe(1);
    const regex = (await handler({ query: 'A.+e', regex: true }, makeCtx(view))) as {
      matches: unknown[];
    };
    expect(regex.matches.length).toBe(1);
    await expectToolError(handler, { query: '' }, makeCtx(view), '検索文字列が空');
    await expectToolError(handler, { query: '([', regex: true }, makeCtx(view), '正規表現');
    view.destroy();
  });
});

describe('get_outline', () => {
  it('見出しのレベル・テキスト・利用可能な位置を返す', async () => {
    const view = createView('# 大見出し\n\n本文\n\n## 中見出し\n');
    const handler = getToolHandler('get_outline')!;
    const result = (await handler({}, makeCtx(view))) as {
      headings: { level: number; text: string; pos: number }[];
    };
    expect(result.headings.length).toBe(2);
    expect(result.headings[0]).toMatchObject({ level: 1, text: '大見出し' });
    expect(result.headings[1]).toMatchObject({ level: 2, text: '中見出し' });
    // 返された位置は見出しブロック内で解決できる (set_heading 等に直接使える)
    for (const h of result.headings) {
      const $pos = view.state.doc.resolve(h.pos);
      expect($pos.parent.type.name).toBe('heading');
    }
    view.destroy();
  });
});

describe('set_cursor / get_cursor', () => {
  it('AIカーソルを設定・取得できる', async () => {
    const view = createView('あいうえお\n');
    const setHandler = getToolHandler('set_cursor')!;
    const getHandler = getToolHandler('get_cursor')!;
    const set = (await setHandler({ from: 2 }, makeCtx(view))) as { from: number; to: number };
    expect(set).toEqual({ from: 2, to: 2 });
    expect(getAiCursor()).toEqual({ from: 2, to: 2 });
    const got = (await getHandler({}, makeCtx(view))) as { from: number; to: number; ai: boolean };
    expect(got).toEqual({ from: 2, to: 2, ai: true });
    // 人間の selection は動いていない
    expect(view.state.selection.from).not.toBe(2);
    view.destroy();
  });

  it('未設定時は人間のキャレット位置を ai:false で返す', async () => {
    const view = createView('あいうえお\n');
    const getHandler = getToolHandler('get_cursor')!;
    const got = (await getHandler({}, makeCtx(view))) as { from: number; to: number; ai: boolean };
    expect(got.ai).toBe(false);
    expect(got.from).toBe(view.state.selection.from);
    view.destroy();
  });

  it('範囲外の位置はエラー', async () => {
    const view = createView('あ\n');
    const setHandler = getToolHandler('set_cursor')!;
    await expectToolError(setHandler, { from: -1 }, makeCtx(view), '範囲外');
    await expectToolError(setHandler, { from: 9999 }, makeCtx(view), '範囲外');
    await expectToolError(setHandler, { from: 1.5 }, makeCtx(view), '整数');
    view.destroy();
  });
});

describe('searchDocument の境界', () => {
  it('表のセル内も検索できる', () => {
    const state = createEditorState('| 名前 | 値 |\n| --- | --- |\n| あ | 1 |\n');
    const matches = searchDocument(state.doc, 'あ');
    expect(matches.length).toBe(1);
    expect(state.doc.textBetween(matches[0].from, matches[0].to)).toBe('あ');
  });
});
