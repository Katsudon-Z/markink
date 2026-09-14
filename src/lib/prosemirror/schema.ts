import { Schema } from 'prosemirror-model';
import { addListNodes } from 'prosemirror-schema-list';
import { schema as basicSchema } from 'prosemirror-schema-basic';

const nodes = addListNodes(basicSchema.spec.nodes, 'paragraph block*', 'block');

export const schema = new Schema({
  nodes,
  marks: basicSchema.spec.marks
});

export type MDNSchema = typeof schema;
