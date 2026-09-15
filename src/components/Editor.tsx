import React, { useEffect, useRef } from 'react';
import { EditorView } from 'prosemirror-view';
import { createEditorView } from '../lib/prosemirror/editor';
import { handleImageDropPasteFactory } from '../lib/prosemirror/image';
import './Editor.css';

interface EditorProps {
  onReady?: (view: EditorView) => void;
  /** 文書が変化したとき (自動保存の契機) */
  onChange?: () => void;
  /** 画像保存先フォルダの取得 (文書を切り替えても最新を参照) */
  getDocDir?: () => string | null;
}

export const Editor = React.memo(function Editor({ onReady, onChange, getDocDir }: EditorProps) {
  const editorRef = useRef<HTMLDivElement>(null);
  const onChangeRef = useRef(onChange);
  const onReadyRef = useRef(onReady);
  const getDocDirRef = useRef(getDocDir);
  onChangeRef.current = onChange;
  onReadyRef.current = onReady;
  getDocDirRef.current = getDocDir;

  useEffect(() => {
    if (!editorRef.current) return;
    const view = createEditorView(editorRef.current, undefined, () => onChangeRef.current?.());
    const onFile = handleImageDropPasteFactory(() => getDocDirRef.current?.() ?? null);

    const handleDrop = (e: DragEvent) => {
      const file = e.dataTransfer?.files?.[0];
      if (!file) return;
      e.preventDefault();
      e.stopPropagation();
      const pos = view.posAtCoords({ left: e.clientX, top: e.clientY });
      void onFile(file, view, pos?.pos ?? null);
    };
    const handleDragOver = (e: DragEvent) => e.preventDefault();

    view.dom.addEventListener('drop', handleDrop);
    view.dom.addEventListener('dragover', handleDragOver);

    onReadyRef.current?.(view);
    return () => {
      view.dom.removeEventListener('drop', handleDrop);
      view.dom.removeEventListener('dragover', handleDragOver);
      view.destroy();
    };
  }, []);

  return (
    <div className="editor-container">
      <div ref={editorRef} className="editor" />
    </div>
  );
});
