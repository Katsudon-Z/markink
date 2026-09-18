import type { EditorView } from 'prosemirror-view';
import { markdownSerializer } from '../prosemirror/editor';
import type { AiModeId } from '../ipc';

/** AI呼び出しに送る文書コンテキスト (右クリック位置の選択・カーソルから作る) */
export interface AiContext {
  /** 送信本文 */
  context: string;
  /** 送信時に選択範囲があったか */
  hasSelection: boolean;
  /** 選択範囲 (スナップショット。適用時に clamp する) */
  selFrom: number;
  selTo: number;
  /** カーソル位置 (挿入先の目安) */
  cursorPos: number;
}

/**
 * モード別のコンテキストを組み立てる。
 * - 要約/質問/編集代行: 選択範囲があればその plain text、なければ全文 markdown。
 * - 続き: カーソルより前の plain text (最大 maxChars)。
 */
export function buildAiContext(view: EditorView, mode: AiModeId, maxChars: number): AiContext {
  const { selection, doc } = view.state;
  const cursorPos = Math.max(0, Math.min(selection.from, doc.content.size));
  const hasSelection = !selection.empty;
  const selFrom = Math.max(0, Math.min(selection.from, doc.content.size));
  const selTo = Math.max(0, Math.min(selection.to, doc.content.size));
  if (mode === 'continue') {
    const from = Math.max(0, cursorPos - Math.max(0, maxChars));
    return {
      context: doc.textBetween(from, cursorPos, '\n'),
      hasSelection: false,
      selFrom: cursorPos,
      selTo: cursorPos,
      cursorPos
    };
  }
  if (hasSelection) {
    return {
      context: doc.textBetween(selFrom, selTo, '\n'),
      hasSelection,
      selFrom,
      selTo,
      cursorPos
    };
  }
  const markdown = markdownSerializer.serialize(doc);
  return {
    context: markdown.length > maxChars ? markdown.slice(0, maxChars) : markdown,
    hasSelection,
    selFrom: 0,
    selTo: doc.content.size,
    cursorPos
  };
}

/** モードの表示名 */
export function aiModeLabel(mode: AiModeId): string {
  switch (mode) {
    case 'summary':
      return 'AI要約';
    case 'continue':
      return 'AI続き';
    case 'question':
      return 'AI質問';
    case 'edit':
      return 'AI編集代行';
  }
}
