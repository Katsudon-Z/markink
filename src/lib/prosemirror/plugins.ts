import { type Command, type Plugin } from 'prosemirror-state';
import { keymap } from 'prosemirror-keymap';
import { baseKeymap } from 'prosemirror-commands';
import { InputRule, inputRules } from 'prosemirror-inputrules';
import type { MarkType } from 'prosemirror-model';
import { splitListItem } from 'prosemirror-schema-list';
import { dropCursor } from 'prosemirror-dropcursor';
import { gapCursor } from 'prosemirror-gapcursor';
import { history, undo, redo } from 'prosemirror-history';
import { tableEditing } from 'prosemirror-tables';
import { schema } from './schema';
import { placeholderPlugin } from './image';
import { aiCursorPlugin, getAttachedAwareness } from '../mcp/presence';
import { docVersionPlugin } from '../mcp/docVersion';
import { lineNumbersPlugin } from './lineNumbers';

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
  /**
   * 共同編集時だけ必要な Yjs 履歴。y-prosemirror は共同編集開始時に動的に
   * 読み込むため、通常起動のメインバンドルには含めない。
   */
  collabHistory?: {
    plugin: () => Plugin;
    undo: Command;
    redo: Command;
  };
}

/** 通常編集と共同編集で共通のプラグイン構成 (単一情報源) */
export function createBasePlugins({ historyMode, collabHistory }: BasePluginOptions): Plugin[] {
  if (historyMode === 'collab' && !collabHistory) {
    throw new Error('共同編集の履歴プラグインが読み込まれていません');
  }
  const historyPlugins: Plugin[] =
    historyMode === 'collab'
      ? [collabHistory!.plugin()]
      : [history()];

  const historyKeys: Record<string, Command> =
    historyMode === 'collab'
      ? { 'Mod-z': collabHistory!.undo, 'Mod-y': collabHistory!.redo, 'Mod-Shift-z': collabHistory!.redo }
      : { 'Mod-z': undo, 'Mod-y': redo, 'Mod-Shift-z': redo };

  // Markdown のインライン記法を入力時に変換 (`*x*`→斜体、`**x**`→太字、`` `x` ``→コード)。
  // ブロック記法 (#、-、>) は既存の Enter/リスト挙動と干渉するため対象外。
  // markInputRule は同梱版に無いため、prosemirror-markdown 例と同等の自前実装を使う。
  const markInputRule = (regexp: RegExp, markType: MarkType): InputRule =>
    new InputRule(regexp, (state, match, start, end) => {
      const tr = state.tr;
      if (match[1]) {
        const textStart = start + match[0].indexOf(match[1]);
        const textEnd = textStart + match[1].length;
        tr.delete(textEnd, end);
        tr.delete(start, textStart);
        tr.addMark(start, start + match[1].length, markType.create());
        tr.removeStoredMark(markType);
      }
      return tr;
    });
  const markdownInput = inputRules({
    rules: [
      markInputRule(/(?:^|[^*_])\*([^*]+)\*$/, schema.marks.em),
      markInputRule(/(?:^|[^*_])\*\*([^*]+)\*\*$/, schema.marks.strong),
      markInputRule(/(?:^|[^`])`([^`]+)`$/, schema.marks.code)
    ]
  });

  return [
    markdownInput,
    ...historyPlugins,
    // 表のセル移動 (Tab/Shift-Tab) などは keymap より先に評価する
    tableEditing(),
    // AI共同編集のカーソル (接続中のみ描画。単独・共同の両モードで有効)
    aiCursorPlugin(getAttachedAwareness),
    // 文書版の監視 (変更検知用。AI編集と人間編集を区別する)
    docVersionPlugin(),
    // 行番号ガター (設定で表示切替)
    lineNumbersPlugin(),
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
