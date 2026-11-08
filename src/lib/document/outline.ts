import type { Node as PMNode } from 'prosemirror-model';

export interface OutlineHeading {
  level: number;
  text: string;
  pos: number;
}

export function getOutline(doc: PMNode): OutlineHeading[] {
  const headings: OutlineHeading[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name === 'heading') {
      headings.push({
        level: typeof node.attrs.level === 'number' ? node.attrs.level : 1,
        text: node.textContent,
        pos: pos + 1
      });
    }
    return true;
  });
  return headings;
}
