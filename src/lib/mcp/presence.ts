import type { EditorView } from 'prosemirror-view';
import { Decoration, DecorationSet } from 'prosemirror-view';
import { Plugin } from 'prosemirror-state';

// AI プレゼンスの状態置き場とカーソル描画 (mcp-plan.md §2.1, M4)
// tools.ts はセッション有無で分岐せず、常にここを経由する。
//
// 重要: 人間と AI は同一アプリ内で同じ Y.Doc クライアント (同一 Awareness) を
// 共有するため、AI は人間の `user` フィールドを上書きしてはならない。
// AI は専用フィールド `ai: {name, color, anchor, head}` を使い、描画は
// yCursorPlugin ではなく自前の装飾プラグインで行う。

/** AIカーソルの色 (人間のパレットと衝突しない紫) */
export const AI_CURSOR_COLOR = '#7c3aed';

export interface AiCursor {
  from: number;
  to: number;
}

/** y-protocols Awareness の最小形 (yjs をメインバンドルに含めないための構造型) */
export interface AwarenessLike {
  readonly clientID: number;
  getStates(): Map<number, unknown>;
  setLocalStateField?(field: string, value: unknown): void;
}

let aiCursor: AiCursor | null = null;
let aiName: string | null = null;
let awareness: AwarenessLike | null = null;

export function setAiCursor(cursor: AiCursor | null): void {
  aiCursor = cursor;
  mirrorToAwareness();
}

export function getAiCursor(): AiCursor | null {
  return aiCursor;
}

export function clearAiCursor(): void {
  aiCursor = null;
  mirrorToAwareness();
}

export function setAiName(name: string | null): void {
  aiName = name;
  mirrorToAwareness();
}

export function getAiName(): string | null {
  return aiName;
}

/** 共同編集セッションの Awareness を接続/切断する (useCollabSession が呼ぶ) */
export function attachAwareness(next: AwarenessLike | null): void {
  awareness = next;
  mirrorToAwareness();
}

export function getAttachedAwareness(): AwarenessLike | null {
  return awareness;
}

/** AI状態を Awareness の `ai` フィールドへ反映 (`user` には触れない) */
function mirrorToAwareness(): void {
  if (!awareness?.setLocalStateField) return;
  if (aiCursor && aiName) {
    awareness.setLocalStateField('ai', {
      name: aiName,
      color: AI_CURSOR_COLOR,
      anchor: aiCursor.from,
      head: aiCursor.to
    });
  } else {
    awareness.setLocalStateField('ai', undefined);
  }
}

function clampPos(docSize: number, pos: number): number {
  if (!Number.isFinite(pos)) return 0;
  return Math.max(0, Math.min(docSize, Math.floor(pos)));
}

function buildAiCursorElement(name: string): HTMLElement {
  const caret = document.createElement('span');
  caret.className = 'mdn-collab-cursor';
  caret.style.borderColor = AI_CURSOR_COLOR;
  const label = document.createElement('span');
  label.className = 'mdn-collab-label';
  label.style.backgroundColor = AI_CURSOR_COLOR;
  label.textContent = name;
  caret.appendChild(label);
  return caret;
}

/**
 * AIカーソルの装飾プラグイン (単独編集・共同編集の両方で使う)。
 * - ローカルの AI カーソル (この端末に接続中の AI)
 * - リモートの AI カーソル (他端末の Awareness `ai` フィールド)
 * 位置は絶対位置で保持するため、同時編集で多少ずれることがある (目安表示)。
 */
export function aiCursorPlugin(getAwareness: () => AwarenessLike | null): Plugin {
  return new Plugin({
    props: {
      decorations(state): DecorationSet | null {
        const decos: Decoration[] = [];
        const docSize = state.doc.content.size;
        const local = getAiCursor();
        const name = getAiName();
        if (local && name) {
          try {
            const from = clampPos(docSize, local.from);
            decos.push(Decoration.widget(from, () => buildAiCursorElement(name), { side: -1 }));
            const to = clampPos(docSize, local.to);
            if (to > from) {
              decos.push(
                Decoration.inline(from, to, { class: 'mdn-ai-selection' })
              );
            }
          } catch {
            // 位置が不正な場合は描画しない
          }
        }
        const aw = getAwareness();
        if (aw) {
          aw.getStates().forEach((raw, id) => {
            if (id === aw.clientID) return; // 自分はローカル描画に一本化
            const remote = (raw as { ai?: { name?: unknown; anchor?: unknown; head?: unknown } }).ai;
            if (!remote || typeof remote.anchor !== 'number') return;
            try {
              const from = clampPos(docSize, remote.anchor);
              const to = clampPos(docSize, typeof remote.head === 'number' ? remote.head : remote.anchor);
              decos.push(
                Decoration.widget(from, () => buildAiCursorElement(String(remote.name ?? 'AI')), {
                  side: -1
                })
              );
              if (to > from) {
                decos.push(Decoration.inline(from, to, { class: 'mdn-ai-selection' }));
              }
            } catch {
              // 他端末の古い位置などは描画しない
            }
          });
        }
        return decos.length > 0 ? DecorationSet.create(state.doc, decos) : null;
      }
    }
  });
}

/** 装飾を再計算させる (状態変更後に呼ぶ。空トランザクションの dispatch) */
export function refreshAiCursor(view: EditorView): void {
  view.dispatch(view.state.tr);
}

/** AI位置へスクロールする (人間の selection は動かさない。レイアウト不可時は無視) */
export function scrollViewToCursor(view: EditorView, pos: number): void {
  try {
    const coords = view.coordsAtPos(pos);
    let parent: HTMLElement | null = (view.dom as HTMLElement).parentElement;
    while (parent) {
      const overflowY = window.getComputedStyle(parent).overflowY;
      if (overflowY === 'auto' || overflowY === 'scroll') {
        const rect = parent.getBoundingClientRect();
        const delta = coords.top - rect.top - 120;
        if (Math.abs(delta) > 40) parent.scrollTop += delta;
        return;
      }
      parent = parent.parentElement;
    }
  } catch {
    // jsdom 等レイアウト不可の環境では何もしない
  }
}
