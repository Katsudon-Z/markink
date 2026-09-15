import { DOMSerializer, type Node as PMNode } from 'prosemirror-model';
import { schema } from '../prosemirror/editor';

const HTML_STYLE =
  "body{font-family:'Segoe UI',Meiryo,sans-serif;max-width:860px;margin:2rem auto;padding:0 1rem;line-height:1.7;}" +
  'img{max-width:100%;}pre{background:#f5f5f5;padding:1em;border-radius:6px;overflow-x:auto;}' +
  'blockquote{border-left:3px solid #ddd;margin:.5em 0;padding-left:1em;color:#555;}' +
  'table{border-collapse:collapse;}td,th{border:1px solid #ccc;padding:4px 8px;}';

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** 文書ノードから自己完結した HTML 文書を生成する (requirements.md:103) */
export function documentToHtml(doc: PMNode, title: string): string {
  const fragment = DOMSerializer.fromSchema(schema).serializeFragment(doc.content);
  const body = document.createElement('div');
  body.appendChild(fragment);
  return (
    `<!doctype html>\n<html lang="ja">\n<head>\n<meta charset="utf-8">\n` +
    `<title>${escapeHtml(title)}</title>\n<style>${HTML_STYLE}</style>\n</head>\n` +
    `<body>\n${body.innerHTML}\n</body>\n</html>\n`
  );
}
