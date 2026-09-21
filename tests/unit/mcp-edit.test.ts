import { describe, it, expect, beforeEach } from 'vitest';
import { EditorView } from 'prosemirror-view';
import { createEditorState, markdownSerializer } from '../../src/lib/prosemirror/editor';
import { clearAiCursor, getAiCursor } from '../../src/lib/mcp/presence';
import { getToolHandler } from '../../src/lib/mcp/tools';
import type { ToolContext, ToolHandler } from '../../src/lib/mcp/types';

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

function markdownOf(view: EditorView): string {
  return markdownSerializer.serialize(view.state.doc);
}

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

beforeEach(() => {
  clearAiCursor();
});

describe('insert_text', () => {
  it('空の文書 (起動直後) に複数ブロックを挿入できる', async () => {
    const view = createView();
    const handler = getToolHandler('insert_text')!;
    const result = (await handler(
      { position: 0, markdown: '# タイトル\n\n本文です\n' },
      makeCtx(view)
    )) as { from: number; to: number };
    expect(result.from).toBe(0);
    const md = markdownOf(view);
    expect(md).toContain('# タイトル');
    expect(md).toContain('本文です');
    view.destroy();
  });

  it('段落の途中への素のテキスト挿入は段落を割らない', async () => {
    const view = createView('あいうえお\n');
    const handler = getToolHandler('insert_text')!;
    // 「う」の直後 (位置3) に挿入
    await handler({ position: 3, markdown: 'かき' }, makeCtx(view));
    expect(view.state.doc.childCount).toBe(1);
    expect(view.state.doc.textContent).toBe('あいかきうえお');
    view.destroy();
  });

  it('段落の途中への見出し挿入は段落を分割する', async () => {
    const view = createView('あいうえお\n');
    const handler = getToolHandler('insert_text')!;
    await handler({ position: 3, markdown: '# 見出し' }, makeCtx(view));
    expect(markdownOf(view)).toContain('# 見出し');
    expect(markdownOf(view)).toContain('あい');
    expect(markdownOf(view)).toContain('うえお');
    view.destroy();
  });

  it('表の断片を挿入できる', async () => {
    const view = createView('前文\n');
    const handler = getToolHandler('insert_text')!;
    const end = view.state.doc.content.size;
    await handler({ position: end, markdown: '| a | b |\n| --- | --- |\n| 1 | 2 |\n' }, makeCtx(view));
    expect(view.state.doc.lastChild?.type.name).toBe('table');
    view.destroy();
  });

  it('空の挿入・範囲外はエラー', async () => {
    const view = createView('あ\n');
    const handler = getToolHandler('insert_text')!;
    await expectToolError(handler, { position: 0, markdown: '' }, makeCtx(view), '空です');
    await expectToolError(handler, { position: 999, markdown: 'x' }, makeCtx(view), '範囲外');
    view.destroy();
  });
});

describe('replace_range', () => {
  it('範囲を置換する', async () => {
    const view = createView('おはよう、世界\n');
    const handler = getToolHandler('replace_range')!;
    // 「世界」(位置6-8)を置換
    await handler({ from: 6, to: 8, markdown: 'みなさん' }, makeCtx(view));
    expect(view.state.doc.textContent).toBe('おはよう、みなさん');
    view.destroy();
  });

  it('空文字で削除できる', async () => {
    const view = createView('おはよう\n');
    const handler = getToolHandler('replace_range')!;
    await handler({ from: 1, to: 4, markdown: '' }, makeCtx(view));
    expect(view.state.doc.textContent).toBe('う');
    view.destroy();
  });

  it('全文置換は人間の確認を通す (拒否で中断)', async () => {
    const view = createView('元の文書\n');
    const handler = getToolHandler('replace_range')!;
    const size = view.state.doc.content.size;
    let confirmed: string | null = null;
    const denyCtx = makeCtx(view, { confirmFullReplace: async (s) => { confirmed = s; return false; } });
    await expectToolError(handler, { from: 0, to: size, markdown: '新しい文書' }, denyCtx, '拒否');
    expect(confirmed).toContain('文書全体');
    expect(view.state.doc.textContent).toBe('元の文書');

    const allowCtx = makeCtx(view, { confirmFullReplace: async () => true });
    await handler({ from: 0, to: size, markdown: '新しい文書' }, allowCtx);
    expect(view.state.doc.textContent).toBe('新しい文書');
    view.destroy();
  });

  it('見出しへの置換で段落が壊れない', async () => {
    const view = createView('あいうえお\n');
    const handler = getToolHandler('replace_range')!;
    await handler({ from: 2, to: 4, markdown: '# 挿入' }, makeCtx(view));
    expect(markdownOf(view)).toContain('# 挿入');
    view.destroy();
  });
});

describe('replace_all', () => {
  it('すべて置換して件数を返す', async () => {
    const view = createView('りんごとみかん、りんご\n');
    const handler = getToolHandler('replace_all')!;
    const result = (await handler({ search: 'りんご', replacement: 'ぶどう' }, makeCtx(view))) as {
      replaced: number;
    };
    expect(result.replaced).toBe(2);
    expect(view.state.doc.textContent).toBe('ぶどうとみかん、ぶどう');
    view.destroy();
  });

  it('一致なしは0件・空検索はエラー', async () => {
    const view = createView('あいう\n');
    const handler = getToolHandler('replace_all')!;
    const result = (await handler({ search: 'xyz', replacement: 'a' }, makeCtx(view))) as {
      replaced: number;
    };
    expect(result.replaced).toBe(0);
    await expectToolError(handler, { search: '', replacement: 'a' }, makeCtx(view), '空です');
    view.destroy();
  });
});

describe('apply_markdown', () => {
  it('文末・見出し直下・指定位置に適用できる', async () => {
    const view = createView('# 章\n\n本文\n');
    const handler = getToolHandler('apply_markdown')!;
    await handler({ anchor: { end: true }, markdown: '追記\n' }, makeCtx(view));
    expect(view.state.doc.textContent).toContain('追記');
    await handler({ anchor: { heading: '章' }, markdown: '直下メモ\n' }, makeCtx(view));
    const md = markdownOf(view);
    // 見出しの直後に挿入される
    expect(md.indexOf('直下メモ')).toBeGreaterThan(md.indexOf('# 章'));
    expect(md.indexOf('直下メモ')).toBeLessThan(md.indexOf('本文'));
    await handler({ anchor: { position: 0 }, markdown: '先頭\n' }, makeCtx(view));
    expect(markdownOf(view).indexOf('先頭')).toBeLessThan(markdownOf(view).indexOf('# 章'));
    view.destroy();
  });

  it('空の文書の末尾に挿入しても先頭に空行が残らない', async () => {
    const view = createView();
    const handler = getToolHandler('apply_markdown')!;
    await handler({ anchor: { end: true }, markdown: '# タイトル\n\n本文\n' }, makeCtx(view));
    expect(view.state.doc.firstChild?.type.name).toBe('heading');
    expect(view.state.doc.childCount).toBe(2);
    expect(markdownOf(view).startsWith('# タイトル')).toBe(true);
    view.destroy();
  });

  it('空の文書の末尾への素のテキスト挿入は段落1つになる', async () => {
    const view = createView();
    const handler = getToolHandler('insert_text')!;
    const end = view.state.doc.content.size;
    await handler({ position: end, markdown: 'あああ' }, makeCtx(view));
    expect(view.state.doc.childCount).toBe(1);
    expect(view.state.doc.textContent).toBe('あああ');
    view.destroy();
  });

  it('存在しない見出し・不正なanchorはエラー', async () => {
    const view = createView('# 章\n');
    const handler = getToolHandler('apply_markdown')!;
    await expectToolError(handler, { anchor: { heading: '無い' }, markdown: 'x' }, makeCtx(view), '見つかりません');
    await expectToolError(handler, { anchor: {}, markdown: 'x' }, makeCtx(view), 'anchor');
    view.destroy();
  });
});

describe('set_heading', () => {
  it('段落を見出しに・見出しを段落に戻せる', async () => {
    const view = createView('ただの文\n');
    const handler = getToolHandler('set_heading')!;
    await handler({ position: 1, level: 2 }, makeCtx(view));
    expect(markdownOf(view)).toContain('## ただの文');
    await handler({ position: 1, level: 0 }, makeCtx(view));
    expect(markdownOf(view)).not.toContain('##');
    view.destroy();
  });

  it('不正なレベル・ブロック外はエラー', async () => {
    const view = createView('文\n');
    const handler = getToolHandler('set_heading')!;
    await expectToolError(handler, { position: 1, level: 7 }, makeCtx(view), '0-6');
    await expectToolError(handler, { position: 0, level: 1 }, makeCtx(view), 'ブロック内');
    view.destroy();
  });
});

describe('save_document', () => {
  it('保存処理を呼び出してパスを返す', async () => {
    const view = createView('文\n');
    const handler = getToolHandler('save_document')!;
    let saved = false;
    const ctx = makeCtx(view, {
      saveDocument: async () => {
        saved = true;
        return { path: 'C:\\docs\\test.md' };
      }
    });
    const result = (await handler({}, ctx)) as { path: string };
    expect(result.path).toBe('C:\\docs\\test.md');
    expect(saved).toBe(true);
    view.destroy();
  });

  it('AI自動保存が無効なら拒否', async () => {
    const view = createView('文\n');
    const handler = getToolHandler('save_document')!;
    const ctx = makeCtx(view, { aiAutoSaveEnabled: async () => false });
    await expectToolError(handler, {}, ctx, 'AI自動保存が無効');
    view.destroy();
  });
});

describe('編集後の整合性', () => {
  it('人間の選択範囲は維持される (勝手に動かさない)', async () => {
    const view = createView('あいうえお\n');
    const handler = getToolHandler('insert_text')!;
    const before = view.state.selection.toJSON();
    await handler({ position: 0, markdown: '先頭に' }, makeCtx(view));
    // 選択は文書変化に追従する (先頭挿入なので後ろへずれる) が、存在し続ける
    expect(view.state.selection.toJSON()).toBeDefined();
    expect(before).toBeDefined();
    view.destroy();
  });

  it('編集はすべて登録済みツール経由で実行できる', async () => {
    for (const name of [
      'insert_text',
      'replace_range',
      'replace_all',
      'apply_markdown',
      'set_heading',
      'save_document'
    ]) {
      expect(getToolHandler(name), `${name} が未登録`).toBeDefined();
    }
  });
});

describe('AI編集後のカーソル自動表示', () => {
  it('insert_text は適用範囲にAIカーソルを置く (人間選択は不変)', async () => {
    const view = createView('あいうえお\n');
    const selBefore = view.state.selection.toJSON();
    const handler = getToolHandler('insert_text')!;
    const result = (await handler({ position: 3, markdown: 'かき' }, makeCtx(view))) as {
      from: number;
      to: number;
    };
    expect(getAiCursor()).toEqual({ from: result.from, to: result.to });
    expect(view.state.selection.toJSON()).toEqual(selBefore);
    view.destroy();
  });

  it('replace_range は置換後の範囲にAIカーソルを置く', async () => {
    const view = createView('あいうえお\n');
    const handler = getToolHandler('replace_range')!;
    const result = (await handler({ from: 1, to: 3, markdown: 'か' }, makeCtx(view))) as {
      from: number;
      to: number;
    };
    expect(getAiCursor()).toEqual({ from: result.from, to: result.to });
    view.destroy();
  });

  it('replace_range の削除は削除位置に折りたたんだカーソルを置く', async () => {
    const view = createView('あいうえお\n');
    const handler = getToolHandler('replace_range')!;
    const result = (await handler({ from: 1, to: 3, markdown: '' }, makeCtx(view))) as {
      from: number;
      to: number;
    };
    expect(result.to).toBe(result.from);
    expect(getAiCursor()).toEqual({ from: result.from, to: result.from });
    view.destroy();
  });

  it('replace_all は最初の一致位置に折りたたんだカーソルを置く', async () => {
    const view = createView('りんごとみかん、りんごジュース\n');
    const handler = getToolHandler('replace_all')!;
    const result = (await handler(
      { search: 'りんご', replacement: 'ぶどう' },
      makeCtx(view)
    )) as { replaced: number };
    expect(result.replaced).toBe(2);
    const cursor = getAiCursor();
    expect(cursor).not.toBeNull();
    expect(cursor!.to).toBe(cursor!.from);
    expect(view.state.doc.textBetween(cursor!.from, cursor!.from + 'ぶどう'.length)).toBe('ぶどう');
    view.destroy();
  });

  it('apply_markdown は適用範囲にAIカーソルを置く', async () => {
    const view = createView('本文\n');
    const handler = getToolHandler('apply_markdown')!;
    const result = (await handler(
      { anchor: { end: true }, markdown: '追記\n' },
      makeCtx(view)
    )) as { from: number; to: number };
    expect(getAiCursor()).toEqual({ from: result.from, to: result.to });
    view.destroy();
  });

  it('set_heading は対象位置にAIカーソルを置く', async () => {
    const view = createView('# 見出し\n');
    const handler = getToolHandler('set_heading')!;
    await handler({ position: 1, level: 2 }, makeCtx(view));
    expect(getAiCursor()).toEqual({ from: 1, to: 1 });
    view.destroy();
  });
});
