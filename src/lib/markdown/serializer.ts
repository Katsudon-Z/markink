import { EditorView } from 'prosemirror-view';
import { defaultMarkdownSerializer, defaultMarkdownParser } from 'prosemirror-markdown';

export function markdownToDoc(view: EditorView, markdown: string) {
  const parsed = defaultMarkdownParser.parse(markdown);
  if (parsed) {
    const { state } = view;
    const tr = state.tr.replace(0, state.doc.content.size, parsed.slice(0));
    view.dispatch(tr);
  }
}

export function docToMarkdown(view: EditorView): string {
  return defaultMarkdownSerializer.serialize(view.state.doc);
}
