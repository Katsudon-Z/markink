import { Schema } from 'prosemirror-model';
import { addListNodes } from 'prosemirror-schema-list';
import { schema as basicSchema } from 'prosemirror-schema-basic';

const nodes = addListNodes(basicSchema.spec.nodes, 'paragraph block*', 'block').addToEnd(
  // Markdown の HTML コメント (編集画面では既定で非表示)
  'html_comment',
  {
    attrs: { text: { default: '' } },
    inline: true,
    group: 'inline',
    atom: true,
    parseDOM: [
      {
        tag: 'span.mdn-html-comment',
        getAttrs: (dom) => ({ text: (dom as HTMLElement).textContent ?? '' })
      }
    ],
    toDOM: (node) => [
      'span',
      { class: 'mdn-html-comment', contenteditable: 'false' },
      node.attrs.text
    ]
  }
);

export const schema = new Schema({
  nodes,
  marks: basicSchema.spec.marks
});

export type MDNSchema = typeof schema;
