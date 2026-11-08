import { Plugin } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';
import { hasCodeBlockRenderer } from './codeBlockRenderers';

export function rangeSelectionPlugin(): Plugin {
  return new Plugin({
    props: {
      handleDOMEvents: {
        mousedown(view, event) {
          if (event.button === 0) view.dom.classList.add('markink-range-selecting');
          return false;
        }
      },
      decorations(state) {
        const { from, to, empty } = state.selection;
        if (empty) return null;
        const decorations: Decoration[] = [];
        state.doc.nodesBetween(from, to, (node, pos) => {
          if (hasCodeBlockRenderer(node) && from <= pos + 1 && to >= pos + node.nodeSize - 1) {
            decorations.push(Decoration.node(pos, pos + node.nodeSize, { class: 'markink-range-selected' }));
            return false;
          }
          return true;
        });
        return DecorationSet.create(state.doc, decorations);
      }
    },
    view(view) {
      const end = () => view.dom.classList.remove('markink-range-selecting');
      window.addEventListener('mouseup', end);
      window.addEventListener('blur', end);
      window.addEventListener('pointercancel', end);
      return { destroy() { end(); window.removeEventListener('mouseup', end); window.removeEventListener('blur', end); window.removeEventListener('pointercancel', end); } };
    }
  });
}
