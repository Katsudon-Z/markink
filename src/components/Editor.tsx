import React, { useEffect, useRef } from 'react';
import { EditorView } from 'prosemirror-view';
import { createEditorView } from '../lib/prosemirror/editor';
import './Editor.css';

interface EditorProps {
  onReady?: (view: EditorView) => void;
}

export const Editor: React.FC<EditorProps> = ({ onReady }) => {
  const editorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (editorRef.current) {
      const view = createEditorView(editorRef.current);
      onReady?.(view);
      return () => view.destroy();
    }
  }, []);

  return (
    <div className="editor-container">
      <div ref={editorRef} className="editor" />
    </div>
  );
};
