import { Plugin } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';
import type { EditorView } from 'prosemirror-view';
import type { Node as PMNode } from 'prosemirror-model';
import { ySyncPluginKey } from 'y-prosemirror';
import { getAttachedAwareness, type AwarenessLike } from '../mcp/presence';

// 共同編集時、他端末 (他者) が編集した箇所を薄くハイライトする。
// 色はその参加者のカーソル色を使い、10秒で消える。
// y-prosemirror はリモート変更を全文置換のトランザクションとして適用するため、
// 前後文書の textBetween 差分で変更範囲を求める (本文編集では正確に追従する)。

interface Highlight {
  from: number;
  to: number;
  color: string;
  expiresAt: number;
}

const HIGHLIGHT_MS = 10000;
const DEFAULT_COLOR = '#999999';

let highlights: Highlight[] = [];
let activeView: EditorView | null = null;

/** ハイライトを消す (共同編集の終了時など) */
export function clearRemoteHighlights(): void {
  highlights = [];
}

function hexToRgba(hex: string, alpha: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return `rgba(153, 153, 153, ${alpha})`;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

/** 変更位置に最も近いリモート参加者の色を選ぶ (色はカーソルと揃える) */
function pickRemoteColor(awareness: AwarenessLike | null, mid: number): string {
  if (!awareness) return DEFAULT_COLOR;
  let bestColor = DEFAULT_COLOR;
  let bestDist = Number.MAX_SAFE_INTEGER;
  awareness.getStates().forEach((raw, id) => {
    if (id === awareness.clientID) return;
    const state = raw as { user?: { color?: string }; cursor?: { anchor?: number } };
    const user = state.user;
    if (!user) return;
    const color = user.color || DEFAULT_COLOR;
    const anchor = state.cursor?.anchor;
    const dist =
      typeof anchor === 'number' ? Math.abs(anchor - mid) : Number.MAX_SAFE_INTEGER;
    if (dist < bestDist) {
      bestDist = dist;
      bestColor = color;
    }
  });
  return bestColor;
}

/** 前後文書の差分から変更範囲を求める (PM絶対位置で正確に) */
function diffPmRange(oldDoc: PMNode, newDoc: PMNode): { from: number; to: number } | null {
  const a = docChars(oldDoc);
  const b = docChars(newDoc);
  let start = 0;
  while (start < a.length && start < b.length && a[start].ch === b[start].ch) start += 1;
  let ea = a.length;
  let eb = b.length;
  while (ea > start && eb > start && a[ea - 1].ch === b[eb - 1].ch) {
    ea -= 1;
    eb -= 1;
  }
  if (start === ea && start === eb) return null;
  // 挿入点 (from) と変更末尾 (to) をPM位置で求める
  const from = start < b.length ? b[start].pos : newDoc.content.size;
  const to = eb > start ? b[eb - 1].pos + 1 : from;
  const safeFrom = Math.max(0, Math.min(from, newDoc.content.size));
  const safeTo = Math.max(safeFrom, Math.min(to, newDoc.content.size));
  if (safeFrom >= safeTo) return null;
  return { from: safeFrom, to: safeTo };
}

/** 文書の全文字を (PM位置, 文字) の列挙にする */
function docChars(doc: PMNode): Array<{ pos: number; ch: string }> {
  const out: Array<{ pos: number; ch: string }> = [];
  doc.descendants((node, pos) => {
    if (node.isText && node.text) {
      for (let i = 0; i < node.text.length; i += 1) {
        out.push({ pos: pos + i, ch: node.text[i] });
      }
    }
    return true;
  });
  return out;
}

/**
 * リモート変更のハイライトプラグイン (共同編集時のみ createCollabPlugins で追加)。
 * 10秒後に空トランザクションを dispatch して有効期限切れの装飾を落とす。
 */
export function remoteHighlightPlugin(): Plugin {
  return new Plugin({
    view(editorView) {
      activeView = editorView;
      return {
        update(view) {
          activeView = view;
        },
        destroy() {
          if (activeView === editorView) activeView = null;
          clearRemoteHighlights();
        }
      };
    },
    appendTransaction(trs, oldState, newState) {
      // リモート変更の検知: y-sync の isChangeOrigin メタが第一。
      // キー実体の不一致に備え、addToHistory:false + 文書変化でも拾う
      // (y-sync の _tr は addToHistory を付けない。AI/人間の通常編集は付けない)。
      const remote = trs.some((tr) => {
        if (
          (tr.getMeta(ySyncPluginKey) as { isChangeOrigin?: boolean } | null)?.isChangeOrigin ===
          true
        ) {
          return true;
        }
        return tr.docChanged && tr.getMeta('addToHistory') === false;
      });
      if (!remote) return undefined;
      const range = diffPmRange(oldState.doc, newState.doc);
      if (!range) return undefined;
      const awareness = getAttachedAwareness();
      const color = pickRemoteColor(awareness, (range.from + range.to) / 2);
      highlights.push({
        from: range.from,
        to: range.to,
        color,
        expiresAt: Date.now() + HIGHLIGHT_MS
      });
      // 3秒後に空 dispatch して有効期限切れの装飾を落とす
      if (activeView) {
        window.setTimeout(() => {
          try {
            activeView?.dispatch(activeView.state.tr);
          } catch {
            /* noop */
          }
        }, HIGHLIGHT_MS + 120);
      }
      return undefined;
    },
    props: {
      decorations(state) {
        const now = Date.now();
        const alive = highlights.filter((h) => h.expiresAt > now);
        if (alive.length !== highlights.length) highlights = alive;
        if (highlights.length === 0) return null;
        const docSize = state.doc.content.size;
        const decos = highlights.map((h) =>
          Decoration.inline(
            Math.max(0, Math.min(h.from, docSize)),
            Math.max(0, Math.min(h.to, docSize)),
            { class: 'mdn-remote-change', style: `background-color: ${hexToRgba(h.color, 0.25)}` }
          )
        );
        return DecorationSet.create(state.doc, decos);
      }
    }
  });
}
