import { describe, it, expect, beforeEach } from 'vitest';
import { EditorView } from 'prosemirror-view';
import { createEditorState } from '../../src/lib/prosemirror/editor';
import {
  attachAwareness,
  clearAiCursor,
  getAiCursor,
  setAiCursor,
  setAiName,
  AI_CURSOR_COLOR,
  type AwarenessLike
} from '../../src/lib/mcp/presence';
import { getToolHandler, registeredToolNames, TOOL_MANIFEST } from '../../src/lib/mcp/tools';
import type { ToolContext } from '../../src/lib/mcp/types';

function createView(markdown?: string) {
  const el = document.createElement('div');
  document.body.appendChild(el);
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

/** setLocalStateField の呼び出しを記録する偽 Awareness */
function makeFakeAwareness() {
  const calls: { field: string; value: unknown }[] = [];
  const states = new Map<number, unknown>();
  const awareness: AwarenessLike = {
    clientID: 1,
    getStates: () => states,
    setLocalStateField: (field, value) => {
      calls.push({ field, value });
    }
  };
  return { awareness, calls, states };
}

function cursorLabels(view: EditorView): string[] {
  return Array.from(view.dom.querySelectorAll('.mdn-collab-label')).map(
    (el) => el.textContent ?? ''
  );
}

beforeEach(() => {
  clearAiCursor();
  setAiName(null);
  attachAwareness(null);
});

describe('AIカーソルの描画', () => {
  it('set_cursor でAI名ラベルが表示される', async () => {
    const view = createView('あいうえお\n');
    setAiName('AI: テスト');
    const handler = getToolHandler('set_cursor')!;
    await handler({ from: 2, scroll: false }, makeCtx(view));
    expect(cursorLabels(view)).toContain('AI: テスト');
    view.destroy();
  });

  it('AI名が無い場合はカーソルを描画しない', async () => {
    const view = createView('あいうえお\n');
    const handler = getToolHandler('set_cursor')!;
    await handler({ from: 2, scroll: false }, makeCtx(view));
    expect(getAiCursor()).toEqual({ from: 2, to: 2 });
    expect(cursorLabels(view)).toHaveLength(0);
    view.destroy();
  });

  it('clearAiCursor でラベルが消える', async () => {
    const view = createView('あいうえお\n');
    setAiName('AI: テスト');
    const handler = getToolHandler('set_cursor')!;
    await handler({ from: 2, scroll: false }, makeCtx(view));
    expect(cursorLabels(view)).toHaveLength(1);
    clearAiCursor();
    view.dispatch(view.state.tr);
    expect(cursorLabels(view)).toHaveLength(0);
    view.destroy();
  });

  it('カーソル色はAI専用の紫', async () => {
    const view = createView('あ\n');
    setAiName('AI: テスト');
    const handler = getToolHandler('set_cursor')!;
    await handler({ from: 1, scroll: false }, makeCtx(view));
    const caret = view.dom.querySelector('.mdn-collab-cursor') as HTMLElement | null;
    expect(caret).not.toBeNull();
    // ブラウザは #7c3aed を rgb(124, 58, 237) に正規化する
    expect(caret!.style.borderColor).toBe('rgb(124, 58, 237)');
    view.destroy();
  });
});

describe('Awareness 連携', () => {
  it('ai フィールドにミラーし、人間の user には触れない', () => {
    const { awareness, calls } = makeFakeAwareness();
    attachAwareness(awareness);
    setAiName('AI: テスト');
    setAiCursor({ from: 2, to: 5 });

    const aiCalls = calls.filter((c) => c.field === 'ai');
    expect(aiCalls.length).toBeGreaterThan(0);
    const last = aiCalls[aiCalls.length - 1].value as {
      name: string;
      color: string;
      anchor: number;
      head: number;
    };
    expect(last.name).toBe('AI: テスト');
    expect(last.color).toBe(AI_CURSOR_COLOR);
    expect(last.anchor).toBe(2);
    expect(last.head).toBe(5);
    // user フィールドへの書き込みは一切ない
    expect(calls.some((c) => c.field === 'user' || c.field === 'cursor')).toBe(false);
  });

  it('クリア時は ai フィールドを消す', () => {
    const { awareness, calls } = makeFakeAwareness();
    attachAwareness(awareness);
    setAiName('AI: テスト');
    setAiCursor({ from: 1, to: 1 });
    clearAiCursor();
    const last = calls[calls.length - 1];
    expect(last.field).toBe('ai');
    expect(last.value).toBeUndefined();
  });

  it('他端末の ai 状態をリモートカーソルとして描画する', () => {
    const { awareness, states } = makeFakeAwareness();
    states.set(7, { user: { name: '人間' }, ai: { name: 'AI: 相手', anchor: 2, head: 2 } });
    attachAwareness(awareness);
    const view = createView('あいうえお\n');
    // 自分の AI カーソルは無し、リモートのみ
    expect(cursorLabels(view)).toContain('AI: 相手');
    expect(cursorLabels(view)).not.toContain('人間');
    view.destroy();
  });

  it('古い・範囲外のリモート位置でも落ちない', () => {
    const { awareness, states } = makeFakeAwareness();
    states.set(7, { ai: { name: 'AI: 古い', anchor: 9999, head: -5 } });
    states.set(8, { ai: { name: 'AI: 壊れ', anchor: 'x' } });
    states.set(9, {});
    attachAwareness(awareness);
    const view = createView('あ\n');
    // 例外なく描画 (範囲外はクランプ、非数値は無視)
    expect(() => view.dispatch(view.state.tr)).not.toThrow();
    view.destroy();
  });
});

describe('notify_human', () => {
  it('メッセージを人間に通知する', async () => {
    const view = createView('文\n');
    const handler = getToolHandler('notify_human')!;
    const received: string[] = [];
    const ctx = makeCtx(view);
    ctx.notifyHuman = (message: string) => received.push(message);
    const result = (await handler({ message: '終わりました' }, ctx)) as { ok: boolean };
    expect(result.ok).toBe(true);
    expect(received).toEqual(['終わりました']);
    view.destroy();
  });

  it('空メッセージはエラー', async () => {
    const view = createView('文\n');
    const handler = getToolHandler('notify_human')!;
    let threw = false;
    try {
      await handler({ message: '  ' }, makeCtx(view));
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
    view.destroy();
  });
});

describe('ツール登録の完全性 (マニフェスト一致)', () => {
  it('マニフェストの全ツールが登録されている (Rust側処理の disconnect を除く)', () => {
    // disconnect は Rust 側 (proto) で完結するためフロントには登録しない
    const locallyHandled = new Set(['disconnect']);
    const registered = new Set(registeredToolNames());
    for (const tool of TOOL_MANIFEST) {
      if (locallyHandled.has(tool.name)) {
        expect(registered.has(tool.name), `${tool.name} はRust側処理のため未登録のはず`).toBe(false);
        continue;
      }
      expect(registered.has(tool.name), `${tool.name} が未登録`).toBe(true);
    }
    expect(registered.size).toBe(TOOL_MANIFEST.length - locallyHandled.size);
  });
});
