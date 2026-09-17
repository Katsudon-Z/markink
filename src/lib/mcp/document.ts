import type { Node as PMNode } from 'prosemirror-model';

// 読み取り系ツール用の文書操作 (EditorView に依存しない純粋関数群)
// 座標系はすべて ProseMirror 絶対位置 (編集ツールにそのまま渡せる)

/** get_document が返す全文の上限文字数 (超過分は切り詰めて truncated:true) */
export const MAX_DOCUMENT_CHARS = 1_000_000;

export interface DocSearchMatch {
  from: number;
  to: number;
  excerpt: string;
}

export interface SearchOptions {
  regex?: boolean;
  caseSensitive?: boolean;
  maxResults?: number;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function makeExcerpt(text: string, index: number, length: number, context = 40): string {
  const start = Math.max(0, index - context);
  const end = Math.min(text.length, index + length + context);
  return `${start > 0 ? '…' : ''}${text.slice(start, end)}${end < text.length ? '…' : ''}`;
}

/** テキストノード単位で検索する (ノードをまたぐ一致は対象外) */
export function searchDocument(
  doc: PMNode,
  query: string,
  opts: SearchOptions = {}
): DocSearchMatch[] {
  if (!query) throw new Error('検索文字列が空です');
  const maxResults = opts.maxResults ?? 50;
  let pattern: RegExp;
  if (opts.regex) {
    try {
      pattern = new RegExp(query, opts.caseSensitive ? 'g' : 'gi');
    } catch {
      throw new Error(`正規表現が不正です: ${query}`);
    }
  } else {
    pattern = new RegExp(escapeRegExp(query), opts.caseSensitive ? 'g' : 'gi');
  }
  const matches: DocSearchMatch[] = [];
  doc.descendants((node, pos) => {
    if (matches.length >= maxResults) return false;
    if (!node.isText || !node.text) return true;
    pattern.lastIndex = 0;
    for (;;) {
      const m = pattern.exec(node.text);
      if (m === null || matches.length >= maxResults) break;
      if (m[0].length === 0) {
        // 空マッチで立ち止まらない
        pattern.lastIndex = m.index + 1;
        continue;
      }
      const from = pos + m.index;
      matches.push({ from, to: from + m[0].length, excerpt: makeExcerpt(node.text, m.index, m[0].length) });
    }
    return true;
  });
  return matches;
}

export interface OutlineHeading {
  level: number;
  text: string;
  /** 見出しブロック内の先頭位置 (set_heading 等にそのまま渡せる) */
  pos: number;
}

export function getOutline(doc: PMNode): OutlineHeading[] {
  const headings: OutlineHeading[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name === 'heading') {
      const level = node.attrs.level;
      headings.push({
        level: typeof level === 'number' ? level : 1,
        text: node.textContent,
        pos: pos + 1
      });
    }
    return true;
  });
  return headings;
}
