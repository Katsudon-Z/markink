import { type Command, TextSelection } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { toggleMark, wrapIn, setBlockType } from 'prosemirror-commands';
import { wrapInList } from 'prosemirror-schema-list';
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
  /** false のものはツールバーの「その他」メニューに入る (既定: true) */
  inToolbar?: boolean;
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
  { id: 'h1', label: 'H1', title: '大見出しにします', run: (v) => runCommand(v, setBlockType(schema.nodes.heading, { level: 1 })) },
  { id: 'h2', label: 'H2', title: '中見出しにします', run: (v) => runCommand(v, setBlockType(schema.nodes.heading, { level: 2 })) },
  { id: 'h3', label: 'H3', title: '小見出しにします', run: (v) => runCommand(v, setBlockType(schema.nodes.heading, { level: 3 })) },
  { id: 'h4', label: 'H4', title: '見出し4にします', inToolbar: false, run: (v) => runCommand(v, setBlockType(schema.nodes.heading, { level: 4 })) },
  { id: 'h5', label: 'H5', title: '見出し5にします', inToolbar: false, run: (v) => runCommand(v, setBlockType(schema.nodes.heading, { level: 5 })) },
  { id: 'hr', label: '―', title: '水平線を挿入します', inToolbar: false, run: (v) => runCommand(v, insertHorizontalRule) },
  { id: 'paragraph', label: '本文', title: '本文(段落)に戻します', run: (v) => runCommand(v, setBlockType(schema.nodes.paragraph)) },
  { id: 'bold', label: 'B', title: '太字にします', run: (v) => runCommand(v, toggleMark(schema.marks.strong)) },
  { id: 'italic', label: 'I', title: '斜体にします', run: (v) => runCommand(v, toggleMark(schema.marks.em)) },
  { id: 'list', label: '•', title: '箇条書きにします', run: (v) => runCommand(v, wrapInList(schema.nodes.bullet_list)) },
  { id: 'orderedList', label: '1.', title: '番号付きリストにします', run: (v) => runCommand(v, wrapInList(schema.nodes.ordered_list)) },
  { id: 'quote', label: '❝', title: '引用にします', run: (v) => runCommand(v, wrapIn(schema.nodes.blockquote)) },
  { id: 'code', label: '</>', title: 'コードブロックにします', run: (v) => runCommand(v, setBlockType(schema.nodes.code_block)) },
  { id: 'table', label: '表', title: '3行×3列の表を挿入します', run: (v) => runCommand(v, insertTable(TABLE_ROWS, TABLE_COLUMNS)) },
  { id: 'rowAdd', label: '行+', title: '現在の行の下に行を追加します', run: (v) => runCommand(v, addRowAfter) },
  { id: 'rowDelete', label: '行-', title: '現在の行を削除します', run: (v) => runCommand(v, deleteRow) },
  { id: 'columnAdd', label: '列+', title: '現在の列の右に列を追加します', run: (v) => runCommand(v, addColumnAfter) },
  { id: 'columnDelete', label: '列-', title: '現在の列を削除します', run: (v) => runCommand(v, deleteColumn) },
  { id: 'tableDelete', label: '表-', title: '表を削除します', run: (v) => runCommand(v, deleteTable) },
  { id: 'link', label: '🔗', title: 'リンクを挿入します', run: runLink },
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

