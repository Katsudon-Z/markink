import { Schema } from 'prosemirror-model';
import { addListNodes } from 'prosemirror-schema-list';
import { schema as basicSchema } from 'prosemirror-schema-basic';
import { tableNodes } from 'prosemirror-tables';

// 表 (prosemirror-tables)。セルには段落などのブロックを入れられるようにする
const tableSpec = tableNodes({ tableGroup: 'block', cellContent: 'block+', cellAttributes: {} });

// コードブロックに言語名 (フェンスの情報文字列) を保持する。
// 既定スキーマには attrs が無いため往復で言語が落ちる (```chart が ``` になる)。
// 既定 "" のため既存文書への影響はない。
const codeBlockSpec = basicSchema.spec.nodes.get('code_block');

const nodes = addListNodes(basicSchema.spec.nodes, 'paragraph block*', 'block')
  .append(tableSpec)
  .update('code_block', {
    ...codeBlockSpec,
    attrs: { ...codeBlockSpec?.attrs, params: { default: '' } }
  })
  .addToEnd(
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
