import { type Command, TextSelection, type EditorState, type Transaction } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { toggleMark, wrapIn, setBlockType } from 'prosemirror-commands';
import { wrapInList, liftListItem } from 'prosemirror-schema-list';
import { undo, redo } from 'prosemirror-history';
import { addColumnAfter, addRowAfter, deleteColumn, deleteRow, deleteTable } from 'prosemirror-tables';
import { schema } from './schema';

export interface FormatPayload {
  href?: string;
}

export interface FormatSpec {
  id: string;
  /** ボタン表示 (アイコン/略号) */
  label: string;
  /** ツールチップ (日本語の用途説明) requirements.md:31 */
  title: string;
  run: (view: EditorView, payload?: FormatPayload) => void;
  /** 配置先メニュー。未指定はツールバー本体、'other'=その他、'table'=表、'date'=日付 */
  menu?: 'other' | 'table' | 'date';
}

/** コマンドを実行し、必要ならエディタにフォーカスを戻す */
function focusView(view: EditorView): void {
  if (view.hasFocus()) return;
  try {
    view.focus();
  } catch {
    // ヘッドレス環境などで focus が失敗しても編集操作は継続する
  }
}

function runCommand(view: EditorView, command: Command): void {
  command(
    view.state,
    (tr) => {
      if (tr) view.dispatch(tr);
      return true;
    },
    view
  );
  focusView(view);
}

function runLink(view: EditorView, payload?: FormatPayload): void {
  toggleMark(schema.marks.link, { href: payload?.href ?? '' })(
    view.state,
    (tr) => {
      view.dispatch(tr);
      return true;
    },
    view
  );
  focusView(view);
}

/** 現在の日付・日時をカーソル位置に挿入する */
function insertDateText(format: (d: Date) => string): Command {
  return (state, dispatch) => {
    if (!dispatch) return true;
    const { from, to } = state.selection;
    dispatch(state.tr.insertText(format(new Date()), from, to).scrollIntoView());
    return true;
  };
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function dateSlash(d: Date): string {
  return `${d.getFullYear()}/${pad2(d.getMonth() + 1)}/${pad2(d.getDate())}`;
}

function dateJa(d: Date): string {
  return `${d.getFullYear()}年${pad2(d.getMonth() + 1)}月${pad2(d.getDate())}日`;
}

function datetimeSlash(d: Date): string {
  return `${dateSlash(d)} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function timeColon(d: Date): string {
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

/** 和暦の日付 (令和・平成・昭和・大正・明治。元年表記あり)。それ以前は西暦 */
export function warekiText(d: Date): string {
  const eras = [
    { name: '令和', start: new Date(2019, 4, 1) },
    { name: '平成', start: new Date(1989, 0, 8) },
    { name: '昭和', start: new Date(1926, 11, 25) },
    { name: '大正', start: new Date(1912, 6, 30) },
    { name: '明治', start: new Date(1868, 8, 8) }
  ];
  const t = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  for (const e of eras) {
    if (t >= e.start.getTime()) {
      const year = d.getFullYear() - e.start.getFullYear() + 1;
      const y = year === 1 ? '元' : String(year);
      return `${e.name}${y}年${d.getMonth() + 1}月${d.getDate()}日`;
    }
  }
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
}

const TABLE_ROWS = 3;
const TABLE_COLUMNS = 3;

/** 水平線を挿入する。空段落は置換し、文字のある場所は直後に置く */
function insertHorizontalRule(state: Parameters<Command>[0], dispatch?: Parameters<Command>[1]): boolean {
  const hr = schema.nodes.horizontal_rule;
  if (!hr) return false;
  if (!dispatch) return true;
  const { $from, empty } = state.selection;
  const tr = state.tr;
  if (empty && $from.depth > 0 && $from.parent.isTextblock && $from.parent.content.size === 0) {
    tr.replaceWith($from.before($from.depth), $from.after($from.depth), hr.create());
  } else {
    tr.replaceSelectionWith(hr.create());
  }
  if (!tr.docChanged) return false;
  dispatch(tr.scrollIntoView());
  return true;
}

/**
 * 書式変更の基本方針 (クリア→設定):
 * まずリストから完全に持ち上げて素の段落に戻し、それから目的の書式を付ける。
 * ProseMirror は不正な構造への変換を黙って拒否するため (例: list_item 先頭の
 * 見出し化、見出しのリスト巻き)、クリアを先行させないと「何も起きない」になる。
 */

/** 選択開始位置がリスト項目内なら、その項目を抱えるリストの種類を返す */
function enclosingListType(state: EditorState) {
  const { bullet_list, ordered_list, list_item } = schema.nodes;
  const $from = state.selection.$from;
  for (let d = $from.depth; d > 0; d -= 1) {
    if ($from.node(d).type === list_item) {
      const parent = d > 1 ? $from.node(d - 1) : null;
      if (parent && (parent.type === bullet_list || parent.type === ordered_list)) {
        return parent.type;
      }
      return null;
    }
  }
  return null;
}

/** リストから完全に持ち上げる (多階層も解消)。持ち上げたら true */
function liftOutOfLists(
  dispatch: ((tr: Transaction) => void) | undefined,
  view: EditorView | undefined
): boolean {
  const { list_item } = schema.nodes;
  if (!list_item || !dispatch || !view) return false;
  let lifted = false;
  for (let i = 0; i < 10; i += 1) {
    const s: EditorState = view.state;
    const $from = s.selection.$from;
    let inside = false;
    for (let d = $from.depth; d > 0; d -= 1) {
      if ($from.node(d).type === list_item) {
        inside = true;
        break;
      }
    }
    if (!inside) break;
    if (!liftListItem(list_item)(s, dispatch, view)) break;
    lifted = true;
  }
  return lifted;
}

/**
 * 見出し化 (リスト内なら全階層から持ち上げてから変換)。
 */
function setHeadingLevel(level: number): Command {
  return (state, dispatch, view) => {
    if (dispatch && view) {
      liftOutOfLists(dispatch, view);
      return setBlockType(schema.nodes.heading, { level })(view.state, dispatch, view);
    }
    return setBlockType(schema.nodes.heading, { level })(state, dispatch, view);
  };
}

/** 本文化: リストから出す (リスト外では段落に変換)。 */
function toParagraph(): Command {
  return (state, dispatch, view) => {
    if (dispatch && view && liftOutOfLists(dispatch, view)) {
      return true;
    }
    return setBlockType(schema.nodes.paragraph)(state, dispatch, view);
  };
}

/**
 * リスト化: 同種リスト内なら解除 (持ち上げて終わり)、
 * それ以外はクリア (持ち上げ+段落化) してから巻く。
 */
function toggleList(kind: 'bullet' | 'ordered'): Command {
  return (state, dispatch, view) => {
    const target =
      kind === 'bullet' ? schema.nodes.bullet_list : schema.nodes.ordered_list;
    if (dispatch && view) {
      const current = enclosingListType(state);
      if (current && current === target) {
        liftOutOfLists(dispatch, view);
        return true;
      }
      liftOutOfLists(dispatch, view);
      let s = view.state;
      // 見出しは段落に戻してから巻く (list_item 先頭は paragraph 必須のため)
      setBlockType(schema.nodes.paragraph)(s, dispatch, view);
      s = view.state;
      return wrapInList(target)(s, dispatch, view);
    }
    return wrapInList(target)(state, dispatch, view);
  };
}

/** 引用化: リストから出してから巻く (見出しは保持する)。 */
function wrapQuote(): Command {
  return (state, dispatch, view) => {
    if (dispatch && view) {
      liftOutOfLists(dispatch, view);
      return wrapIn(schema.nodes.blockquote)(view.state, dispatch, view);
    }
    return wrapIn(schema.nodes.blockquote)(state, dispatch, view);
  };
}

/** コードブロック化: リストから出してから変換する。 */
function toCodeBlock(): Command {
  return (state, dispatch, view) => {
    if (dispatch && view) {
      liftOutOfLists(dispatch, view);
      return setBlockType(schema.nodes.code_block)(view.state, dispatch, view);
    }
    return setBlockType(schema.nodes.code_block)(state, dispatch, view);
  };
}

/** 表を挿入し、先頭セルにカーソルを移す */
function insertTable(rows: number, columns: number): Command {
  return (state, dispatch) => {
    const { table, table_row: tableRow, table_cell: cell, table_header: header } = state.schema.nodes;
    if (!table || !tableRow || !cell || !header) return false;
    const createRow = (isHeader: boolean) =>
      tableRow.create(
        null,
        Array.from({ length: columns }, () => (isHeader ? header : cell).createAndFill()!)
      );
    const tableNode = table.create(null, [
      createRow(true),
      ...Array.from({ length: Math.max(0, rows - 1) }, () => createRow(false))
    ]);
    if (dispatch) {
      const { $from, empty } = state.selection;
      const inTextblock = $from.depth > 0 && $from.parent.isTextblock;
      const tr = state.tr;
      let insertPos = state.selection.from;
      if (empty && inTextblock && $from.parent.content.size === 0) {
        // 空の段落は表で置き換える (空文書でも挿入できるように)
        insertPos = $from.before($from.depth);
        tr.replaceWith(insertPos, $from.after($from.depth), tableNode);
      } else if (empty && inTextblock) {
        // 文字のある段落は残し、その直後に表を置く
        insertPos = $from.after($from.depth);
        tr.insert(insertPos, tableNode);
      } else {
        tr.replaceSelectionWith(tableNode);
        if (!tr.docChanged && inTextblock) {
          insertPos = $from.after($from.depth);
          tr.insert(insertPos, tableNode);
        }
      }
      if (!tr.docChanged) return false;
      // 先頭セル (表 > 行 > セル > 段落) のテキスト位置へカーソルを移す
      let textPos = -1;
      tr.doc.nodesBetween(insertPos, insertPos + tableNode.nodeSize, (node, pos) => {
        if (textPos < 0 && node.isTextblock) {
          textPos = pos + 1;
          return false;
        }
        return true;
      });
      if (textPos >= 0) tr.setSelection(TextSelection.near(tr.doc.resolve(textPos)));
      // 表が文書の最後に来る場合は、後ろに空の段落を用意する (表の後ろに書き足せるように)
      if (insertPos + tableNode.nodeSize >= tr.doc.content.size) {
        tr.insert(tr.doc.content.size, state.schema.nodes.paragraph.createAndFill()!);
      }
      dispatch(tr.scrollIntoView());
    }
    return true;
  };
}

/** 書式定義の単一情報源。UI と実行ロジックの双方がここを参照する */
export const FORMATS: FormatSpec[] = [
  { id: 'h1', label: 'H1', title: '大見出しにします', run: (v) => runCommand(v, setHeadingLevel(1)) },
  { id: 'h2', label: 'H2', title: '中見出しにします', run: (v) => runCommand(v, setHeadingLevel(2)) },
  { id: 'h3', label: 'H3', title: '小見出しにします', run: (v) => runCommand(v, setHeadingLevel(3)) },
  { id: 'h4', label: 'H4', title: '見出し4にします', menu: 'other', run: (v) => runCommand(v, setHeadingLevel(4)) },
  { id: 'h5', label: 'H5', title: '見出し5にします', menu: 'other', run: (v) => runCommand(v, setHeadingLevel(5)) },
  { id: 'hr', label: '―', title: '水平線を挿入します', menu: 'other', run: (v) => runCommand(v, insertHorizontalRule) },
  { id: 'paragraph', label: '本文', title: '本文(段落)に戻します', run: (v) => runCommand(v, toParagraph()) },
  { id: 'bold', label: 'B', title: '太字にします', run: (v) => runCommand(v, toggleMark(schema.marks.strong)) },
  { id: 'italic', label: 'I', title: '斜体にします', run: (v) => runCommand(v, toggleMark(schema.marks.em)) },
  { id: 'list', label: '•', title: '箇条書きにします (もう一度で解除)', run: (v) => runCommand(v, toggleList('bullet')) },
  { id: 'orderedList', label: '1.', title: '番号付きリストにします (もう一度で解除)', run: (v) => runCommand(v, toggleList('ordered')) },
  { id: 'quote', label: '❝', title: '引用にします', run: (v) => runCommand(v, wrapQuote()) },
  { id: 'code', label: '</>', title: 'コードブロックにします', run: (v) => runCommand(v, toCodeBlock()) },
  { id: 'table', label: '表', title: '3行×3列の表を挿入します', menu: 'table', run: (v) => runCommand(v, insertTable(TABLE_ROWS, TABLE_COLUMNS)) },
  { id: 'rowAdd', label: '行+', title: '現在の行の下に行を追加します', menu: 'table', run: (v) => runCommand(v, addRowAfter) },
  { id: 'rowDelete', label: '行-', title: '現在の行を削除します', menu: 'table', run: (v) => runCommand(v, deleteRow) },
  { id: 'columnAdd', label: '列+', title: '現在の列の右に列を追加します', menu: 'table', run: (v) => runCommand(v, addColumnAfter) },
  { id: 'columnDelete', label: '列-', title: '現在の列を削除します', menu: 'table', run: (v) => runCommand(v, deleteColumn) },
  { id: 'tableDelete', label: '表-', title: '表を削除します', menu: 'table', run: (v) => runCommand(v, deleteTable) },
  { id: 'link', label: '🔗', title: 'リンクを挿入します (Ctrl+クリックで開く)', run: runLink },
  { id: 'date', label: '日付（yyyy/mm/dd）', title: '現在の日付を挿入します', menu: 'date', run: (v) => runCommand(v, insertDateText(dateSlash)) },
  { id: 'dateJa', label: '日付（yyyy年mm月dd日）', title: '現在の日付を和文形式で挿入します', menu: 'date', run: (v) => runCommand(v, insertDateText(dateJa)) },
  { id: 'datetime', label: '日時（yyyy/mm/dd hh:mm）', title: '現在の日時を挿入します', menu: 'date', run: (v) => runCommand(v, insertDateText(datetimeSlash)) },
  { id: 'time', label: '時刻（hh:mm:ss）', title: '現在の時刻を挿入します', menu: 'date', run: (v) => runCommand(v, insertDateText(timeColon)) },
  { id: 'dateWareki', label: '日付（和暦）', title: '現在の日付を和暦で挿入します', menu: 'date', run: (v) => runCommand(v, insertDateText(warekiText)) },
  // 画像挿入はファイル選択ダイアログと設定 (リンク/コピー・相対/絶対) が要るため、
  // App.handleFormat が横取りして非同期フローで処理する。直接呼ばれた場合は何もしない。
  { id: 'image-link', label: '画像（リンク）', title: '画像を参照リンクで挿入します (コピーなし)', menu: 'other', run: () => {} },
  { id: 'image-copy', label: '画像（コピー）', title: '画像をassetsにコピーして挿入します', menu: 'other', run: () => {} },
  { id: 'undo', label: '↶', title: '元に戻す (Ctrl+Z)', run: (v) => runCommand(v, undo) },
  { id: 'redo', label: '↷', title: 'やり直す (Ctrl+Y)', run: (v) => runCommand(v, redo) }
];

export function getFormat(id: string): FormatSpec | undefined {
  return FORMATS.find((f) => f.id === id);
}

/** 書式を適用する。未知の ID は何もせず安全に終了する */
export function applyFormat(view: EditorView, id: string, payload?: FormatPayload): void {
  getFormat(id)?.run(view, payload);
}

