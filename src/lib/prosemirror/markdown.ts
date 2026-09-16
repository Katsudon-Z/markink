import {
  MarkdownParser,
  MarkdownSerializer,
  defaultMarkdownParser,
  defaultMarkdownSerializer
} from 'prosemirror-markdown';
import type { Node as PMNode } from 'prosemirror-model';
import { schema } from './schema';

const COMMENT_START = '<!--';
const COMMENT_END = '-->';

interface TokenLike {
  type: string;
  children?: TokenLike[];
}

// ルール登録に必要な markdown-it の StateInline の最小形
interface InlineStateLike {
  src: string;
  pos: number;
  push(type: string, tag: string, nesting: number): { content: string };
}

// HTMLコメントを本文テキストではなく専用トークンとして切り出す
function commentRule(state: InlineStateLike, silent: boolean): boolean {
  const start = state.pos;
  if (!state.src.startsWith(COMMENT_START, start)) return false;
  const end = state.src.indexOf(COMMENT_END, start + COMMENT_START.length);
  if (end < 0) return false;
  if (!silent) {
    state.push('mdn_comment', '', 0).content = state.src.slice(start, end + COMMENT_END.length);
  }
  state.pos = end + COMMENT_END.length;
  return true;
}

// 表のセル内テキストを段落で包む (セルの内容はブロックのため)
const CELL_OPEN = new Set(['th_open', 'td_open']);
const CELL_CLOSE = new Set(['th_close', 'td_close']);

function wrapTableCellContent(tokens: TokenLike[]): TokenLike[] {
  const out: TokenLike[] = [];
  for (const token of tokens) {
    if (CELL_OPEN.has(token.type)) out.push(token, { type: 'paragraph_open' });
    else if (CELL_CLOSE.has(token.type)) out.push({ type: 'paragraph_close' }, token);
    else out.push(token);
  }
  return out;
}

// この tokenizer は本アプリ専用に使うため、ここで表の有効化とコメント用ルールの追加を行う
const tokenizer = defaultMarkdownParser.tokenizer;
tokenizer.enable('table');
tokenizer.inline.ruler.before('html_inline', 'mdn_comment', commentRule);

// 表のセル内容を段落で包むため、トークン列を加工してからパーサへ渡す
const wrappedTokenizer = {
  parse: (text: string, env?: object): TokenLike[] =>
    wrapTableCellContent(tokenizer.parse(text, env) as TokenLike[])
} as unknown as typeof tokenizer;

/**
 * 本アプリのスキーマに結線した Markdown パーサ。
 * prosemirror-markdown の既定パーサは独自スキーマのノード型を生成するため、
 * その文書に対して schema を前提とするコマンド(リスト操作等)が効かなくなる。
 * トークン定義はノード名の文字列で書かれているので、同じ定義を再利用できる。
 */
export const markdownParser = new MarkdownParser(schema, wrappedTokenizer, {
  ...defaultMarkdownParser.tokens,
  mdn_comment: { node: 'html_comment', getAttrs: (tok) => ({ text: tok.content ?? '' }) },
  table: { block: 'table' },
  thead: { ignore: true },
  tbody: { ignore: true },
  tr: { block: 'table_row' },
  th: { block: 'table_header' },
  td: { block: 'table_cell' }
});

/** 表のセル内容を 1 行の Markdown テキストにする (改行は空白に、| はエスケープ) */
function cellToMarkdown(cell: PMNode): string {
  return markdownSerializer
    .serialize(cell)
    .replace(/\s*\n+\s*/g, ' ')
    .trim()
    .replace(/\|/g, '\\|');
}

/** 本アプリのスキーマに対応したシリアライザ (HTMLコメントと表はそのまま書き戻す) */
export const markdownSerializer = new MarkdownSerializer(
  {
    ...defaultMarkdownSerializer.nodes,
    html_comment: (state, node) => {
      state.write(node.attrs.text ?? '');
    },
    table(state, node) {
      const rows: string[][] = [];
      node.forEach((row) => {
        const cells: string[] = [];
        row.forEach((cell) => cells.push(cellToMarkdown(cell)));
        rows.push(cells);
      });
      if (rows.length === 0) return;
      const columns = Math.max(...rows.map((row) => row.length));
      const fill = (cells: string[]) => [
        ...cells,
        ...Array<string>(Math.max(0, columns - cells.length)).fill('')
      ];
      const writeRow = (cells: string[]) => state.write(`| ${fill(cells).join(' | ')} |\n`);
      writeRow(rows[0]);
      writeRow(Array<string>(columns).fill('---'));
      for (let i = 1; i < rows.length; i += 1) writeRow(rows[i]);
      state.closeBlock(node);
    }
  },
  defaultMarkdownSerializer.marks
);
