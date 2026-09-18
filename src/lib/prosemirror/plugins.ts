import { type Command, type Plugin } from 'prosemirror-state';
import { keymap } from 'prosemirror-keymap';
import { baseKeymap } from 'prosemirror-commands';
import { splitListItem } from 'prosemirror-schema-list';
import { dropCursor } from 'prosemirror-dropcursor';
import { gapCursor } from 'prosemirror-gapcursor';
import { history, undo, redo } from 'prosemirror-history';
import { tableEditing } from 'prosemirror-tables';
import { yUndoPlugin, undoCommand as yUndo, redoCommand as yRedo } from 'y-prosemirror';
import { schema } from './schema';
import { placeholderPlugin } from './image';
import { aiCursorPlugin, getAttachedAwareness } from '../mcp/presence';
import { docVersionPlugin } from '../mcp/docVersion';

export const PLACEHOLDER_HINT =
  '入力例: ここに入力してください。上部のボタンで見出しや箇条書きも作れます。';

/** Shift+Enter: 段落内で改行 (箇条書きを増やさない) */
export const insertHardBreak: Command = (state, dispatch) => {
  const hardBreak = schema.nodes.hard_break;
  if (!hardBreak) return false;
  if (dispatch) {
    dispatch(state.tr.replaceSelectionWith(hardBreak.create()).scrollIntoView());
  }
  return true;
};

/**
 * Enter: 箇条書き/番号付きリストでは次の項目を作る。
 * リスト外では baseKeymap の段落分割にフォールバックする。
 * (リスト内で splitBlock を使うと同一項目内に段落が増えて「改行」に見えるため)
 */
export const splitListItemOnEnter: Command = splitListItem(schema.nodes.list_item);

export type HistoryMode = 'local' | 'collab';

export interface BasePluginOptions {
  /** local: 端末内履歴 / collab: 全員で共有する Yjs 履歴 */
  historyMode: HistoryMode;
}

/** 通常編集と共同編集で共通のプラグイン構成 (単一情報源) */
export function createBasePlugins({ historyMode }: BasePluginOptions): Plugin[] {
  const historyPlugins: Plugin[] =
    historyMode === 'collab'
      ? [yUndoPlugin()]
      : [history()];

  const historyKeys: Record<string, Command> =
    historyMode === 'collab'
      ? { 'Mod-z': yUndo, 'Mod-y': yRedo, 'Mod-Shift-z': yRedo }
      : { 'Mod-z': undo, 'Mod-y': redo, 'Mod-Shift-z': redo };

  return [
    ...historyPlugins,
    // 表のセル移動 (Tab/Shift-Tab) などは keymap より先に評価する
    tableEditing(),
    // AI共同編集のカーソル (接続中のみ描画。単独・共同の両モードで有効)
    aiCursorPlugin(getAttachedAwareness),
    // 文書版の監視 (変更検知用。AI編集と人間編集を区別する)
    docVersionPlugin(),
    keymap(historyKeys),
    // Enter/Shift+Enter は baseKeymap より先に評価する
    keymap({
      Enter: splitListItemOnEnter,
      'Shift-Enter': insertHardBreak
    }),
    keymap(baseKeymap),
    dropCursor(),
    gapCursor(),
    placeholderPlugin(PLACEHOLDER_HINT)
  ];
}
