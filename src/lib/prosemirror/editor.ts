import { EditorState, type Command } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { schema } from './schema';
import { keymap } from 'prosemirror-keymap';
import { baseKeymap, toggleMark, wrapIn, setBlockType } from 'prosemirror-commands';
import { wrapInList } from 'prosemirror-schema-list';
import { history, undo, redo } from 'prosemirror-history';
import { dropCursor } from 'prosemirror-dropcursor';
import { gapCursor } from 'prosemirror-gapcursor';
import { defaultMarkdownParser, defaultMarkdownSerializer } from 'prosemirror-markdown';
import { placeholderPlugin } from './image';

export { undo, redo, defaultMarkdownParser, defaultMarkdownSerializer, schema };
export { createCollabEditorState, createCollabPlugins, seedFragmentFromProseMirror, fragmentToMarkdown } from './collab';

export function createEditorState(initialMarkdown?: string) {
  const doc = initialMarkdown ? defaultMarkdownParser.parse(initialMarkdown) : undefined;
  return EditorState.create({
    doc,
    schema,
    plugins: [
      history(),
      // Ctrl+Z / Ctrl+Y の Undo/Redo (requirements.md:46)
      keymap({
        'Mod-z': undo,
        'Mod-Shift-z': redo,
        'Mod-y': redo
      }),
      keymap(baseKeymap),
      dropCursor(),
      gapCursor(),
      placeholderPlugin('入力例: ここに入力してください。上部のボタンで見出しや箇条書きも作れます。')
    ]
  });
}

export function createEditorView(element: HTMLElement, state?: EditorState): EditorView {
  const editorState = state || createEditorState();
  const view = new EditorView(element, {
    state: editorState,
    dispatchTransaction(tr) {
      const newState = view.state.apply(tr);
      view.updateState(newState);
    }
  });
  return view;
}

export function applyFormat(view: EditorView, id: string): void {
  const { state } = view;
  const focus = (fn: Command) => {
    fn(state, (tr) => {
      if (tr) view.dispatch(tr);
      return true;
    }, view);
    if (!view.hasFocus()) view.focus();
  };

  switch (id) {
    case 'h1':
      focus(setBlockType(schema.nodes.heading, { level: 1 }));
      break;
    case 'h2':
      focus(setBlockType(schema.nodes.heading, { level: 2 }));
      break;
    case 'paragraph':
      focus(setBlockType(schema.nodes.paragraph));
      break;
    case 'bold':
      focus(toggleMark(schema.marks.strong));
      break;
    case 'italic':
      focus(toggleMark(schema.marks.em));
      break;
    case 'code':
      focus(setBlockType(schema.nodes.code_block));
      break;
    case 'quote':
      focus(wrapIn(schema.nodes.blockquote));
      break;
    case 'list':
      focus(wrapInList(schema.nodes.bullet_list));
      break;
    case 'orderedList':
      focus(wrapInList(schema.nodes.ordered_list));
      break;
    case 'link': {
      const href = window.prompt('リンク先の URL を入力してください') || '';
      focus(toggleMark(schema.marks.link, { href }));
      break;
    }
    case 'undo':
      undo(state, (tr) => {
        view.dispatch(tr);
        return true;
      }, view);
      break;
    case 'redo':
      redo(state, (tr) => {
        view.dispatch(tr);
        return true;
      }, view);
      break;
    default:
      break;
  }
}
