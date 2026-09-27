import type { Node as PMNode } from 'prosemirror-model';
import type { EditorView } from 'prosemirror-view';
import { getCodeBlockRenderer } from '../plugins/slots';

/**
 * コードブロックの NodeView 差込口 (Phase 1)。
 * 言語登録があればプラグイン描画、なければ既定の pre>code (従来と同一)。
 * 内容変化時は作り直す (update は常に false)。
 */
export function codeBlockNodeView() {
  return (node: PMNode, view: EditorView, getPos: (() => number | undefined) | undefined) => {
    void view;
    void getPos;
    const lang = typeof node.attrs.params === 'string' ? node.attrs.params : '';
    const code = node.textContent;
    const renderer = getCodeBlockRenderer(lang);
    if (renderer) {
      const dom = renderer.render(code, lang);
      return { dom, update: () => false };
    }
    const pre = document.createElement('pre');
    const codeEl = document.createElement('code');
    pre.appendChild(codeEl);
    return { dom: pre, contentDOM: codeEl, update: () => false };
  };
}
