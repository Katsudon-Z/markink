import { type Command } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { toggleMark, wrapIn, setBlockType } from 'prosemirror-commands';
import { wrapInList } from 'prosemirror-schema-list';
import { undo, redo } from 'prosemirror-history';
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

/** 書式定義の単一情報源。UI と実行ロジックの双方がここを参照する */
export const FORMATS: FormatSpec[] = [
  { id: 'h1', label: 'H1', title: '大見出しにします', run: (v) => runCommand(v, setBlockType(schema.nodes.heading, { level: 1 })) },
  { id: 'h2', label: 'H2', title: '中見出しにします', run: (v) => runCommand(v, setBlockType(schema.nodes.heading, { level: 2 })) },
  { id: 'paragraph', label: '本文', title: '本文(段落)に戻します', run: (v) => runCommand(v, setBlockType(schema.nodes.paragraph)) },
  { id: 'bold', label: 'B', title: '太字にします', run: (v) => runCommand(v, toggleMark(schema.marks.strong)) },
  { id: 'italic', label: 'I', title: '斜体にします', run: (v) => runCommand(v, toggleMark(schema.marks.em)) },
  { id: 'list', label: '•', title: '箇条書きにします', run: (v) => runCommand(v, wrapInList(schema.nodes.bullet_list)) },
  { id: 'orderedList', label: '1.', title: '番号付きリストにします', run: (v) => runCommand(v, wrapInList(schema.nodes.ordered_list)) },
  { id: 'quote', label: '❝', title: '引用にします', run: (v) => runCommand(v, wrapIn(schema.nodes.blockquote)) },
  { id: 'code', label: '</>', title: 'コードブロックにします', run: (v) => runCommand(v, setBlockType(schema.nodes.code_block)) },
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

