import * as Y from 'yjs';
import { EditorState, Plugin } from 'prosemirror-state';
import { schema } from './schema';
import { markdownSerializer } from './markdown';
import { createBasePlugins } from './plugins';
import {
  ySyncPlugin,
  yCursorPlugin,
  yUndoPlugin,
  undoCommand as yUndo,
  redoCommand as yRedo,
  prosemirrorToYXmlFragment,
  yXmlFragmentToProsemirror
} from 'y-prosemirror';
import { remoteHighlightPlugin } from '../collaboration/remoteHighlight';

// y-prosemirror による Yjs ↔ ProseMirror 連携 (requirements.md:110)

export interface CollabPluginOptions {
  /** 相手のカーソルと名前ラベルを表示するか (既定: 表示する) */
  showCursors?: boolean;
}

/**
 * カーソルと名前ラベル。ラベルは絶対配置のオーバーレイなので
 * 本文の折り返しや行位置に影響しない。
 */
export function collabCursorBuilder(user: { name?: string; color?: string }): HTMLElement {
  const color = user?.color ?? '#999';
  const caret = document.createElement('span');
  caret.className = 'mdn-collab-cursor';
  caret.style.borderColor = color;

  const label = document.createElement('span');
  label.className = 'mdn-collab-label';
  label.style.backgroundColor = color;
  label.textContent = user?.name ?? '';
  caret.appendChild(label);

  return caret;
}

export function createCollabPlugins(
  session: {
    fragment: Y.XmlFragment;
    awareness: import('y-protocols/awareness').Awareness;
  },
  options: CollabPluginOptions = {}
): Plugin[] {
  const plugins: Plugin[] = [
    ySyncPlugin(session.fragment),
    ...createBasePlugins({
      historyMode: 'collab',
      collabHistory: { plugin: yUndoPlugin, undo: yUndo, redo: yRedo }
    }),
    // 他者の編集箇所のハイライト (3秒で消える)
    remoteHighlightPlugin()
  ];
  if (options.showCursors !== false) {
    plugins.splice(1, 0, yCursorPlugin(session.awareness, { cursorBuilder: collabCursorBuilder }));
  }
  return plugins;
}

export function createCollabEditorState(
  session: {
    fragment: Y.XmlFragment;
    awareness: import('y-protocols/awareness').Awareness;
  },
  // フラグメントが空(参加側で同期前)の場合の初期文書。同期到着後は自動で置換される
  fallbackDoc?: EditorState['doc'],
  options: CollabPluginOptions = {}
): EditorState {
  const doc =
    session.fragment.length > 0
      ? yXmlFragmentToProsemirror(schema, session.fragment)
      : (fallbackDoc ?? schema.topNodeType.createAndFill()!);
  return EditorState.create({
    doc,
    schema,
    plugins: createCollabPlugins(session, options)
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
  return markdownSerializer.serialize(pmDoc);
}
