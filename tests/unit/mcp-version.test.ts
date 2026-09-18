import { describe, it, expect, beforeEach } from 'vitest';
import { EditorView } from 'prosemirror-view';
import { createEditorState, createEditorView } from '../../src/lib/prosemirror/editor';
import {
  AI_TR_META,
  bumpDocVersion,
  getDocVersion,
  getLastCursor,
  getLastOrigin,
  resetDocVersion,
  subscribeDocVersion
} from '../../src/lib/mcp/docVersion';
import { clearAiCursor } from '../../src/lib/mcp/presence';
import { getToolHandler } from '../../src/lib/mcp/tools';
import type { ToolContext } from '../../src/lib/mcp/types';

function createView(markdown?: string) {
  const el = document.createElement('div');
  document.body.appendChild(el);
  // createEditorState は docVersionPlugin を含む (両モード共通)
  return new EditorView(el, { state: createEditorState(markdown) });
}

function makeCtx(view: EditorView): ToolContext {
  return {
    getView: () => view,
    getTitle: () => 'テスト文書',
    getPath: () => null,
    isDirty: () => false,
    saveDocument: async () => ({ path: 'x' }),
    confirmFullReplace: async () => true,
    aiAutoSaveEnabled: async () => true,
    notifyHuman: () => {}
  };
}

beforeEach(() => {
  clearAiCursor();
  resetDocVersion();
});

describe('docVersion ストア', () => {
  it('bumpで版が進み購読者に通知される', () => {
    const seen: number[] = [];
    const unsub = subscribeDocVersion((info) => seen.push(info.version));
    expect(getDocVersion()).toBe(0);
    bumpDocVersion('human');
    bumpDocVersion('ai');
    expect(getDocVersion()).toBe(2);
    expect(getLastOrigin()).toBe('ai');
    expect(seen).toEqual([1, 2]);
    unsub();
    bumpDocVersion('human');
    expect(seen).toEqual([1, 2]);
  });
});

describe('docVersionPlugin', () => {
  it('人間のdispatchで版が進む(origin=human)', () => {
    const view = createView('あ\n');
    const before = getDocVersion();
    view.dispatch(view.state.tr.insertText('い', 1));
    expect(getDocVersion()).toBe(before + 1);
    expect(getLastOrigin()).toBe('human');
    view.destroy();
  });

  it('AIタグ付きdispatchでorigin=aiになる', () => {
    const view = createView('あ\n');
    view.dispatch(view.state.tr.setMeta(AI_TR_META, true).insertText('い', 1));
    expect(getLastOrigin()).toBe('ai');
    view.destroy();
  });

  it('空トランザクションでは版が進まない', () => {
    const view = createView('あ\n');
    const before = getDocVersion();
    view.dispatch(view.state.tr);
    expect(getDocVersion()).toBe(before);
    view.destroy();
  });

  it('変更時の人間カーソルが記録される (dispatch直結)', () => {
    expect(getLastCursor()).toBeNull();
    const el = document.createElement('div');
    document.body.appendChild(el);
    // createEditorView の dispatchTransaction がカーソルを記録する
    const view = createEditorView(el);
    view.dispatch(view.state.tr.insertText('あ', 1));
    const cursor = getLastCursor();
    expect(cursor).not.toBeNull();
    expect(Number.isInteger(cursor!.from)).toBe(true);
    expect(Number.isInteger(cursor!.to)).toBe(true);
    view.destroy();
    el.remove();
  });

  it('通知時点では最新のカーソルが読める (記録→通知の順序)', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    const view = createEditorView(el);
    let seenAtNotify: { from: number; to: number } | null | undefined;
    const unsub = subscribeDocVersion(() => {
      seenAtNotify = getLastCursor();
    });
    view.dispatch(view.state.tr.insertText('あいう', 1));
    unsub();
    // 通知コールバック実行時点で既に記録済み (送信が古い位置を読まない)
    expect(seenAtNotify).not.toBeNull();
    expect(seenAtNotify).toEqual(getLastCursor());
    expect(seenAtNotify).toEqual({
      from: view.state.selection.from,
      to: view.state.selection.to
    });
    view.destroy();
    el.remove();
  });
});

describe('get_version / get_changes', () => {
  it('get_versionは版番号のみを返す', async () => {
    const view = createView('あ\n');
    const handler = getToolHandler('get_version')!;
    bumpDocVersion('human');
    const result = (await handler({}, makeCtx(view))) as { version: number };
    expect(result.version).toBe(getDocVersion());
    view.destroy();
  });

  it('get_changesはsince以降の変更がなければchanged:false', async () => {
    const view = createView('あ\n');
    const handler = getToolHandler('get_changes')!;
    const current = getDocVersion();
    const result = (await handler({ since: current }, makeCtx(view))) as {
      version: number;
      changed: boolean;
    };
    expect(result).toEqual({ version: current, changed: false });
    view.destroy();
  });

  it('get_changesは変更があれば全文を返す', async () => {
    const view = createView('あ\n');
    const handler = getToolHandler('get_changes')!;
    const before = getDocVersion();
    view.dispatch(view.state.tr.insertText('い', 2));
    const result = (await handler({ since: before }, makeCtx(view))) as {
      version: number;
      changed: boolean;
      markdown: string;
      truncated: boolean;
    };
    expect(result.changed).toBe(true);
    expect(result.version).toBe(getDocVersion());
    expect(result.markdown).toContain('あい');
    expect(result.truncated).toBe(false);
    view.destroy();
  });

  it('since省略時は全文を返す', async () => {
    const view = createView('あ\n');
    const handler = getToolHandler('get_changes')!;
    const result = (await handler({}, makeCtx(view))) as { changed: boolean; markdown: string };
    expect(result.changed).toBe(true);
    expect(result.markdown).toContain('あ');
    view.destroy();
  });

  it('sinceが整数でなければエラー', async () => {
    const view = createView('あ\n');
    const handler = getToolHandler('get_changes')!;
    // 同期ツールは直接throwする
    expect(() => handler({ since: 'x' }, makeCtx(view))).toThrow('整数');
    view.destroy();
  });
});

describe('AI編集の版追跡', () => {
  it('insert_textはorigin=aiで版を進める', async () => {
    const view = createView('あ\n');
    const handler = getToolHandler('insert_text')!;
    await handler({ position: 2, markdown: 'い' }, makeCtx(view));
    expect(getLastOrigin()).toBe('ai');
    view.destroy();
  });

  it('get_documentはversionを含む', async () => {
    const view = createView('あ\n');
    const handler = getToolHandler('get_document')!;
    const result = (await handler({}, makeCtx(view))) as { version: number };
    expect(result.version).toBe(getDocVersion());
    view.destroy();
  });
});
