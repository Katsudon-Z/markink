import type { Node as PMNode } from 'prosemirror-model';
import type { EditorView } from 'prosemirror-view';
import { getCodeBlockRenderer } from '../plugins/slots';

/**
 * コードブロックの NodeView 差込口。
 * 言語登録があればプラグイン描画、なければ既定の pre>code (従来と同一)。
 * 内容変化時は作り直す (update は常に false)。
 */
export function codeBlockNodeView() {
  return (node: PMNode, view: EditorView, getPos: (() => number | undefined) | undefined) => {
    const lang = typeof node.attrs.params === 'string' ? node.attrs.params : '';
    const code = node.textContent;
    const renderer = getCodeBlockRenderer(lang);
    if (renderer) {
      const dom = renderer.render(code, lang, {
        apply: (newCode: string) => {
          try {
            const pos = getPos?.();
            if (pos == null) return false;
            const next = newCode
              ? node.type.create({ ...node.attrs }, view.state.schema.text(newCode))
              : node.type.create({ ...node.attrs });
            view.dispatch(view.state.tr.replaceWith(pos, pos + node.nodeSize, next));
            return true;
          } catch {
            return false;
          }
        }
      });
      return { dom, update: () => false };
    }
    const pre = document.createElement('pre');
    const codeEl = document.createElement('code');
    pre.appendChild(codeEl);
    return { dom: pre, contentDOM: codeEl, update: () => false };
  };
}
