import type { EditorView } from 'prosemirror-view';
import { markdownParser } from '../prosemirror/editor';
import { AI_TR_META } from '../mcp/docVersion';
import { refreshAiCursor, setAiCursor } from '../mcp/presence';

/** 位置を文書範囲に収める (送信後に人間が編集していた場合のずれ対策) */
function clampPos(view: EditorView, pos: number): number {
  return Math.max(0, Math.min(pos, view.state.doc.content.size));
}

/**
 * AI応答の markdown をカーソル位置に挿入する (単一トランザクション)。
 * 素の1段落ならテキスト差し込み (段落を割らない)、それ以外はブロック挿入。
 */
export function insertAiMarkdown(view: EditorView, pos: number, markdown: string): void {
  const fragment = markdownParser.parse(markdown).content;
  if (fragment.size === 0) throw new Error('AIの応答が空です');
  const at = clampPos(view, pos);
  const doc = view.state.doc;
  const $pos = doc.resolve(at);
  let tr = view.state.tr;
  if (
    fragment.childCount === 1 &&
    fragment.firstChild?.type.name === 'paragraph' &&
    $pos.parent.isTextblock
  ) {
    const text = fragment.firstChild.textContent;
    tr = text ? tr.insertText(text, at) : tr;
  } else {
    tr = tr.insert(at, fragment);
  }
  view.dispatch(tr.setMeta(AI_TR_META, true).scrollIntoView());
  const end = clampPos(view, at + fragment.size);
  setAiCursor({ from: at, to: end });
  refreshAiCursor(view);
}

/**
 * AI応答の markdown で範囲を置換する (単一トランザクション。確認ダイアログが前提)。
 * 空応答の場合は削除のみ行う。
 */
export function replaceAiRange(
  view: EditorView,
  from: number,
  to: number,
  markdown: string
): void {
  const safeFrom = clampPos(view, Math.min(from, to));
  const safeTo = clampPos(view, Math.max(from, to));
  const fragment = markdown.trim()
    ? markdownParser.parse(markdown).content
    : null;
  let tr = view.state.tr.delete(safeFrom, safeTo);
  if (fragment && fragment.size > 0) {
    tr = tr.insert(safeFrom, fragment);
  }
  view.dispatch(tr.setMeta(AI_TR_META, true).scrollIntoView());
  const end = fragment ? clampPos(view, safeFrom + fragment.size) : safeFrom;
  setAiCursor({ from: safeFrom, to: end });
  refreshAiCursor(view);
}
