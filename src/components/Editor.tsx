import React, { useEffect, useRef } from 'react';
import { EditorView } from 'prosemirror-view';
import { createEditorView } from '../lib/prosemirror/editor';
import { handleImageDropPasteFactory } from '../lib/prosemirror/image';
import './Editor.css';

interface EditorProps {
  onReady?: (view: EditorView) => void;
  docDir?: string | null;
}

export const Editor: React.FC<EditorProps> = ({ onReady, docDir }) => {
  const editorRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const docDirRef = useRef<string | null>(null);

  useEffect(() => {
    docDirRef.current = docDir ?? null;
  }, [docDir]);

  useEffect(() => {
    if (!editorRef.current) return;
    const view = createEditorView(editorRef.current);
    docDirRef.current = docDir ?? null;
    const onFile = handleImageDropPasteFactory(() => docDirRef.current);

    view.dom.addEventListener('drop', (e: DragEvent) => {
      const file = e.dataTransfer?.files?.[0];
      if (!file) return;
      e.preventDefault();
      e.stopPropagation();
      const pos = view.posAtCoords({ left: e.clientX, top: e.clientY });
      void onFile(file, view, pos?.pos ?? null);
    });
    view.dom.addEventListener('dragover', (e: DragEvent) => {
      e.preventDefault();
    });

    onReady?.(view);
    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, []);

  return (
    <div className="editor-container">
      <div ref={editorRef} className="editor" />
    </div>
  );
};
