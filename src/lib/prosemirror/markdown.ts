import {
  MarkdownParser,
  MarkdownSerializer,
  defaultMarkdownParser,
  defaultMarkdownSerializer
} from 'prosemirror-markdown';
import { schema } from './schema';

const COMMENT_START = '<!--';
const COMMENT_END = '-->';

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

// この tokenizer は本アプリ専用に使うため、ここでコメント用ルールを追加する
const tokenizer = defaultMarkdownParser.tokenizer;
tokenizer.inline.ruler.before('html_inline', 'mdn_comment', commentRule);

/**
 * 本アプリのスキーマに結線した Markdown パーサ。
 * prosemirror-markdown の既定パーサは独自スキーマのノード型を生成するため、
 * その文書に対して schema を前提とするコマンド(リスト操作等)が効かなくなる。
 * トークン定義はノード名の文字列で書かれているので、同じ定義を再利用できる。
 */
export const markdownParser = new MarkdownParser(schema, tokenizer, {
  ...defaultMarkdownParser.tokens,
  mdn_comment: { node: 'html_comment', getAttrs: (tok) => ({ text: tok.content ?? '' }) }
});

/** 本アプリのスキーマに対応したシリアライザ (HTMLコメントはそのまま書き戻す) */
export const markdownSerializer = new MarkdownSerializer(
  {
    ...defaultMarkdownSerializer.nodes,
    html_comment: (state, node) => {
      state.write(node.attrs.text ?? '');
    }
  },
  defaultMarkdownSerializer.marks
);
