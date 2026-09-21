import type { EditorView } from 'prosemirror-view';
import { Fragment } from 'prosemirror-model';
import type { Node as PMNode } from 'prosemirror-model';
import { setBlockType } from 'prosemirror-commands';
import type { Transaction } from 'prosemirror-state';
import { markdownParser, markdownSerializer } from '../prosemirror/editor';
import manifest from '../../../shared/mcp-tools.json';
import { getOutline, searchDocument, MAX_DOCUMENT_CHARS } from './document';
import { AI_TR_META, getDocVersion } from './docVersion';
import { getAiCursor, setAiCursor, refreshAiCursor, scrollViewToCursor } from './presence';
import type { ToolContext, ToolHandler, ToolResult } from './types';

export interface McpToolDef {
  name: string;
  description: string;
  inputSchema: unknown;
}

export const TOOL_MANIFEST = manifest as McpToolDef[];

function requireView(ctx: ToolContext): EditorView {
  const view = ctx.getView();
  if (!view) throw new Error('エディタが準備できていません');
  return view;
}

function asInteger(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new Error(`${name} は整数で指定してください`);
  }
  return value;
}

function asOptionalInteger(value: unknown, name: string): number | undefined {
  if (value === undefined || value === null) return undefined;
  return asInteger(value, name);
}

function assertPosition(doc: PMNode, pos: number, name: string): void {
  if (pos < 0 || pos > doc.content.size) {
    throw new Error(`${name}=${pos} は文書範囲外です (有効範囲 0-${doc.content.size})`);
  }
}

function asString(value: unknown, name: string): string {
  if (typeof value !== 'string') throw new Error(`${name} は文字列で指定してください`);
  return value;
}

/** AI発のトランザクションであることを版管理に伝える */
function tagAi(tr: Transaction): Transaction {
  return tr.setMeta(AI_TR_META, true);
}

/**
 * AIの書き込み箇所にAIカーソルを表示する (AIの作業位置を常に可視化する)。
 * 人間の selection は動かさない。画面スクロールは行わない
 * (連続書き込みで人間の閲覧位置を奪わないため)。
 */
function showAiCursorAt(view: EditorView, from: number, to: number): void {
  setAiCursor({ from, to });
  refreshAiCursor(view);
}

/** 人間の IME 変換中はトランザクション適用を少し待つ (変換の破壊を避ける) */
async function waitForCompositionEnd(view: EditorView, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (view.composing && Date.now() - start < timeoutMs) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

function parseFragment(markdown: string): Fragment {
  return markdownParser.parse(markdown).content;
}

/**
 * 単一の素の段落なら中のテキストを返す (段落を分割せず差し込める)。
 * マーク・改行・コメント等のインライン要素を含む場合は null (ブロック挿入へ)。
 */
function singlePlainParagraphText(fragment: Fragment): string | null {
  if (fragment.childCount !== 1) return null;
  const child = fragment.firstChild;
  if (!child || child.type.name !== 'paragraph') return null;
  let plain = true;
  child.nodesBetween(0, child.content.size, (node) => {
    if (node.isText) {
      if (node.marks.length > 0) plain = false;
    } else if (!node.isTextblock) {
      plain = false;
    }
  });
  return plain ? child.textContent : null;
}

/**
 * フラグメントを位置へ挿入する (同一トランザクション内で複数回呼べる)。
 * - 単一の素の段落 × テキストブロック内 → テキスト差し込み (段落を割らない)
 * - 空ブロック × ブロック内容 → ブロックごと置換 (空段落に閉じたスライスを差せないため)
 * - それ以外 → tr.insert (必要に応じて段落を分割する)
 * 戻り値の to は分割が起きない場合に正確。AI は連鎖編集の前に再取得すること。
 */
function applyInsert(
  tr: Transaction,
  pos: number,
  fragment: Fragment
): { tr: Transaction; from: number; to: number } {
  const doc = tr.doc;
  assertPosition(doc, pos, 'position');
  if (fragment.size === 0) return { tr, from: pos, to: pos };
  // 親末端の空ブロック直後なら、その中に差し込む (末尾に空行を残さない。
  // 空文書の末尾に挿入した場合の先頭の空行を防ぐ)
  let $pos = doc.resolve(pos);
  const before = $pos.nodeBefore;
  if (
    before &&
    before.isTextblock &&
    before.content.size === 0 &&
    pos === $pos.end($pos.depth)
  ) {
    pos = pos - 1;
    $pos = doc.resolve(pos);
  }
  const plainText = singlePlainParagraphText(fragment);
  if (plainText !== null && $pos.parent.isTextblock) {
    const next = tr.insertText(plainText, pos);
    return { tr: next, from: pos, to: pos + plainText.length };
  }
  const parent = $pos.depth > 0 ? $pos.parent : null;
  if (parent && parent.isTextblock && parent.content.size === 0) {
    const blockStart = $pos.before($pos.depth);
    const blockEnd = $pos.after($pos.depth);
    const first = fragment.firstChild;
    if (!first) return { tr, from: pos, to: pos };
    let next = tr.replaceWith(blockStart, blockEnd, first);
    const rest: PMNode[] = [];
    fragment.forEach((node, _offset, index) => {
      if (index > 0) rest.push(node);
    });
    if (rest.length > 0) {
      next = next.insert(blockStart + first.nodeSize, Fragment.from(rest));
    }
    return { tr: next, from: blockStart, to: blockStart + fragment.size };
  }
  const next = tr.insert(pos, fragment);
  return { tr: next, from: pos, to: pos + fragment.size };
}

function findHeadingEnd(doc: PMNode, heading: string): number {
  let exact = -1;
  let partial = -1;
  const available: string[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name !== 'heading') return true;
    available.push(node.textContent);
    if (exact < 0 && node.textContent === heading) exact = pos + node.nodeSize;
    else if (partial < 0 && node.textContent.includes(heading)) partial = pos + node.nodeSize;
    return true;
  });
  if (exact >= 0) return exact;
  if (partial >= 0) return partial;
  throw new Error(
    `見出し「${heading}」が見つかりません。利用可能な見出し: ${
      available.length > 0 ? available.join(' / ') : '(なし)'
    }`
  );
}

const handlers: Record<string, ToolHandler> = {
  get_document(_args, ctx): ToolResult {
    const view = requireView(ctx);
    const markdown = markdownSerializer.serialize(view.state.doc);
    const truncated = markdown.length > MAX_DOCUMENT_CHARS;
    return {
      title: ctx.getTitle(),
      path: ctx.getPath(),
      dirty: ctx.isDirty(),
      version: getDocVersion(),
      markdown: truncated ? markdown.slice(0, MAX_DOCUMENT_CHARS) : markdown,
      truncated
    };
  },

  search(args, ctx): ToolResult {
    const view = requireView(ctx);
    const query = args.query;
    if (typeof query !== 'string') throw new Error('query は文字列で指定してください');
    const matches = searchDocument(view.state.doc, query, {
      regex: args.regex === true,
      caseSensitive: args.caseSensitive === true,
      maxResults:
        args.maxResults === undefined ? undefined : asInteger(args.maxResults, 'maxResults')
    });
    return { matches };
  },

  get_outline(_args, ctx): ToolResult {
    const view = requireView(ctx);
    return { headings: getOutline(view.state.doc) };
  },

  get_version(): ToolResult {
    // 版番号のみの軽量呼び出し (変更検知ポーリング用。エディタ不要)
    return { version: getDocVersion() };
  },

  get_changes(args, ctx): ToolResult {
    const view = requireView(ctx);
    const current = getDocVersion();
    const since = args.since === undefined ? -1 : asInteger(args.since, 'since');
    if (since >= current) return { version: current, changed: false };
    const markdown = markdownSerializer.serialize(view.state.doc);
    const truncated = markdown.length > MAX_DOCUMENT_CHARS;
    return {
      version: current,
      changed: true,
      markdown: truncated ? markdown.slice(0, MAX_DOCUMENT_CHARS) : markdown,
      truncated
    };
  },

  get_cursor(_args, ctx): ToolResult {
    const view = requireView(ctx);
    const ai = getAiCursor();
    if (ai) return { from: ai.from, to: ai.to, ai: true };
    const { from, to } = view.state.selection;
    return { from, to, ai: false };
  },

  set_cursor(args, ctx): ToolResult {
    const view = requireView(ctx);
    const from = asInteger(args.from, 'from');
    const to = asOptionalInteger(args.to, 'to') ?? from;
    assertPosition(view.state.doc, from, 'from');
    assertPosition(view.state.doc, to, 'to');
    setAiCursor({ from, to });
    refreshAiCursor(view);
    if (args.scroll !== false) scrollViewToCursor(view, from);
    return { from, to };
  },

  async insert_text(args, ctx): Promise<ToolResult> {
    const view = requireView(ctx);
    const position = asInteger(args.position, 'position');
    const markdown = asString(args.markdown, 'markdown');
    if (!markdown.trim()) throw new Error('挿入内容が空です');
    await waitForCompositionEnd(view);
    const fragment = parseFragment(markdown);
    if (fragment.size === 0) throw new Error('挿入内容が空です');
    const applied = applyInsert(view.state.tr, position, fragment);
    view.dispatch(tagAi(applied.tr).scrollIntoView());
    showAiCursorAt(view, applied.from, applied.to);
    return { from: applied.from, to: applied.to };
  },

  async replace_range(args, ctx): Promise<ToolResult> {
    const view = requireView(ctx);
    const from = asInteger(args.from, 'from');
    const to = asInteger(args.to, 'to');
    if (from > to) throw new Error('from は to 以下で指定してください');
    const markdown = asString(args.markdown, 'markdown');
    const docSize = view.state.doc.content.size;
    assertPosition(view.state.doc, from, 'from');
    assertPosition(view.state.doc, to, 'to');
    await waitForCompositionEnd(view);
    if (from === 0 && to === docSize && docSize > 0) {
      const ok = await ctx.confirmFullReplace(
        `AIが文書全体の置換を要求しています (置換後 ${markdown.length}文字)。許可しますか?`
      );
      if (!ok) throw new Error('人間が文書全体の置換を拒否しました');
    }
    const fragment = parseFragment(markdown);
    if (fragment.size === 0) {
      view.dispatch(tagAi(view.state.tr.delete(from, to)).scrollIntoView());
      showAiCursorAt(view, from, from);
      return { from, to: from };
    }
    const applied = applyInsert(view.state.tr.delete(from, to), from, fragment);
    view.dispatch(tagAi(applied.tr).scrollIntoView());
    showAiCursorAt(view, applied.from, applied.to);
    return { from: applied.from, to: applied.to };
  },

  async replace_all(args, ctx): Promise<ToolResult> {
    const view = requireView(ctx);
    const search = asString(args.search, 'search');
    if (!search) throw new Error('search が空です');
    const replacement = asString(args.replacement, 'replacement');
    await waitForCompositionEnd(view);
    // 後ろから適用して位置ずれを防ぐ
    const matches = searchDocument(view.state.doc, search, {
      caseSensitive: args.caseSensitive === true,
      maxResults: 1000
    });
    if (matches.length === 0) return { replaced: 0 };
    let tr = view.state.tr;
    for (let i = matches.length - 1; i >= 0; i--) {
      const m = matches[i];
      tr = tr.insertText(replacement, m.from, m.to);
    }
    view.dispatch(tagAi(tr).scrollIntoView());
    // 後ろから適用するため先頭の一致位置は有効なまま。そこにカーソルを置く
    if (matches.length > 0) showAiCursorAt(view, matches[0].from, matches[0].from);
    return { replaced: matches.length };
  },

  async apply_markdown(args, ctx): Promise<ToolResult> {
    const view = requireView(ctx);
    const anchor = args.anchor;
    if (typeof anchor !== 'object' || anchor === null) {
      throw new Error('anchor は {position} / {heading} / {end:true} のいずれかで指定してください');
    }
    const typed = anchor as { position?: unknown; heading?: unknown; end?: unknown };
    const markdown = asString(args.markdown, 'markdown');
    if (!markdown.trim()) throw new Error('適用内容が空です');
    await waitForCompositionEnd(view);
    const fragment = parseFragment(markdown);
    if (fragment.size === 0) throw new Error('適用内容が空です');
    const doc = view.state.doc;
    let pos: number;
    if (typed.end === true) {
      pos = doc.content.size;
    } else if (typed.position !== undefined) {
      pos = asInteger(typed.position, 'anchor.position');
      assertPosition(doc, pos, 'anchor.position');
    } else if (typeof typed.heading === 'string') {
      pos = findHeadingEnd(doc, typed.heading);
    } else {
      throw new Error('anchor は {position} / {heading} / {end:true} のいずれかで指定してください');
    }
    const applied = applyInsert(view.state.tr, pos, fragment);
    view.dispatch(tagAi(applied.tr).scrollIntoView());
    showAiCursorAt(view, applied.from, applied.to);
    return { from: applied.from, to: applied.to };
  },

  async set_heading(args, ctx): Promise<ToolResult> {
    const view = requireView(ctx);
    const position = asInteger(args.position, 'position');
    const level = asInteger(args.level, 'level');
    if (level < 0 || level > 6) throw new Error('level は 0-6 で指定してください (0=段落)');
    const doc = view.state.doc;
    assertPosition(doc, position, 'position');
    const $pos = doc.resolve(position);
    if ($pos.depth === 0 || !$pos.parent.isTextblock) {
      throw new Error('ブロック内の位置を指定してください (get_outline の pos が使えます)');
    }
    await waitForCompositionEnd(view);
    const { paragraph, heading } = view.state.schema.nodes;
    const cmd = level === 0 ? setBlockType(paragraph) : setBlockType(heading, { level });
    let applied = false;
    cmd(view.state, (tr) => {
      view.dispatch(tagAi(tr).scrollIntoView());
      applied = true;
    });
    if (!applied) throw new Error('見出しを設定できませんでした');
    showAiCursorAt(view, position, position);
    return { ok: true, level };
  },

  async save_document(_args, ctx): Promise<ToolResult> {
    requireView(ctx);
    if (!(await ctx.aiAutoSaveEnabled())) {
      throw new Error('AI自動保存が無効です。設定で有効にしてから実行してください');
    }
    return ctx.saveDocument();
  },

  notify_human(args, ctx): ToolResult {
    const message = asString(args.message, 'message');
    if (!message.trim()) throw new Error('message が空です');
    ctx.notifyHuman(message);
    return { ok: true };
  }
};

export function getToolHandler(name: string): ToolHandler | undefined {
  return handlers[name];
}

export function registerToolHandler(name: string, handler: ToolHandler): void {
  handlers[name] = handler;
}

export function registeredToolNames(): string[] {
  return Object.keys(handlers);
}
