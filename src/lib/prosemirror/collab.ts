import * as Y from 'yjs';
import { EditorState, Plugin } from 'prosemirror-state';
import { schema } from './schema';
import { keymap } from 'prosemirror-keymap';
import { baseKeymap } from 'prosemirror-commands';
import { dropCursor } from 'prosemirror-dropcursor';
import { gapCursor } from 'prosemirror-gapcursor';
import { defaultMarkdownSerializer } from 'prosemirror-markdown';
import { placeholderPlugin } from './image';
import {
  ySyncPlugin,
  yCursorPlugin,
  yUndoPlugin,
  undoCommand,
  redoCommand,
  prosemirrorToYXmlFragment,
  yXmlFragmentToProsemirror
} from 'y-prosemirror';

// y-prosemirror による Yjs ↔ ProseMirror 連携 (requirements.md:110)

export function createCollabPlugins(session: {
  fragment: Y.XmlFragment;
  awareness: import('y-protocols/awareness').Awareness;
}): Plugin[] {
  return [
    ySyncPlugin(session.fragment),
    yCursorPlugin(session.awareness),
    yUndoPlugin(),
    // 共同編集時は Yjs の Undo/Redo を使用 (履歴は全員で共有)
    keymap({
      'Mod-z': undoCommand,
      'Mod-y': redoCommand
    }),
    keymap(baseKeymap),
    dropCursor(),
    gapCursor(),
    placeholderPlugin('入力例: ここに入力してください。上部のボタンで見出しや箇条書きも作れます。')
  ];
}

export function createCollabEditorState(
  session: {
    fragment: Y.XmlFragment;
    awareness: import('y-protocols/awareness').Awareness;
  },
  // フラグメントが空(参加側で同期前)の場合の初期文書。同期到着後は自動で置換される
  fallbackDoc?: EditorState['doc']
): EditorState {
  const doc =
    session.fragment.length > 0
      ? yXmlFragmentToProsemirror(schema, session.fragment)
      : (fallbackDoc ?? schema.topNodeType.createAndFill()!);
  return EditorState.create({
    doc,
    schema,
    plugins: createCollabPlugins(session)
  });
}

// セッション参加時に、現LOCAL文書の内容をYjsに反映 (ルームの最初の参加者用)
export function seedFragmentFromProseMirror(
  doc: EditorState['doc'],
  ydoc: Y.Doc,
  fragment: Y.XmlFragment
): void {
  ydoc.transact(() => {
    if (fragment.length === 0) {
      void (prosemirrorToYXmlFragment as unknown as (d: EditorState['doc'], f?: Y.XmlFragment) => Y.XmlFragment)(doc, fragment);
    }
  });
}

// 共同編集終了時: Yjs の内容を Markdown に変換
export function fragmentToMarkdown(fragment: Y.XmlFragment): string {
  const pmDoc = yXmlFragmentToProsemirror(schema, fragment);
  return defaultMarkdownSerializer.serialize(pmDoc);
}

