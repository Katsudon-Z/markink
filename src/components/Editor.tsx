import React, { useEffect, useRef } from 'react';
import { EditorView } from 'prosemirror-view';
import { createEditorView } from '../lib/prosemirror/editor';
import { handleImageDropPasteFactory } from '../lib/prosemirror/image';
import type { AiModeId } from '../lib/ipc';
import { FORMAT_SHORTCUTS } from '../lib/ai/shortcuts';
import { setLineNumbersVisible } from '../lib/prosemirror/lineNumbers';
import './Editor.css';

interface EditorProps {
  onReady?: (view: EditorView) => void;
  /** 文書が変化したとき (自動保存の契機) */
  onChange?: () => void;
  /** 画像保存先フォルダの取得 (文書を切り替えても最新を参照) */
  getDocDir?: () => string | null;
  /** HTMLコメントを表示するか (既定: 非表示) */
  showComments?: boolean;
  /** 行番号ガターを表示するか */
  showLineNumbers?: boolean;
  /** エディタの文字サイズ (px)。未指定ならCSS既定 */
  fontSizePx?: number;
  /** エディタのフォントファミリ (CSS値)。空ならCSS既定 */
  fontFamily?: string;
  /** Ctrl+Space でAI続きを直接挿入 (確認なし)。処理したら true */
  onAiContinue?: () => boolean;
  /** AIショートカット (要約/質問/編集代行) */
  onAiShortcut?: (mode: AiModeId) => void;
  /** 書式ショートカット (commands.ts のフォーマットID) */
  onFormatText?: (id: string) => void;
}

export const Editor = React.memo(function Editor({
  onReady,
  onChange,
  getDocDir,
  showComments = false,
  showLineNumbers = true,
  fontSizePx,
  fontFamily,
  onAiContinue,
  onAiShortcut,
  onFormatText
}: EditorProps) {
  const editorRef = useRef<HTMLDivElement>(null);
  const onChangeRef = useRef(onChange);
  const onReadyRef = useRef(onReady);
  const getDocDirRef = useRef(getDocDir);
  const onAiContinueRef = useRef(onAiContinue);
  const onAiShortcutRef = useRef(onAiShortcut);
  const onFormatTextRef = useRef(onFormatText);
  onChangeRef.current = onChange;
  onReadyRef.current = onReady;
  getDocDirRef.current = getDocDir;
  onAiContinueRef.current = onAiContinue;
  onAiShortcutRef.current = onAiShortcut;
  onFormatTextRef.current = onFormatText;

  useEffect(() => {
    if (!editorRef.current) return;
    const view = createEditorView(
      editorRef.current,
      undefined,
      () => onChangeRef.current?.(),
      () => getDocDirRef.current?.() ?? null
    );
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
    // Ctrl+Space: AIで続きを書き、確認なしで挿入する (IME変換中は無視)
    // Ctrl+Shift+S/Q/E: AI要約 / AI質問・編集代行メニューを開く
    // 書式ショートカット: FORMAT_SHORTCUTS (Ctrl+B/I/K/E、Ctrl+Shift+数字/L/O/.)
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.repeat) return;
      if (view.composing) return;
      if (e.code === 'Space' && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        e.stopPropagation();
        onAiContinueRef.current?.();
        return;
      }
      if (e.altKey) return;
      if (e.shiftKey) {
        const shortcut = onAiShortcutRef.current;
        if (e.code === 'KeyS' || e.code === 'KeyQ' || e.code === 'KeyE') {
          if (!shortcut) return;
          e.preventDefault();
          e.stopPropagation();
          shortcut(e.code === 'KeyS' ? 'summary' : e.code === 'KeyQ' ? 'question' : 'edit');
          return;
        }
        const fmt = FORMAT_SHORTCUTS.find((f) => f.code === e.code && f.shift);
        if (fmt) {
          e.preventDefault();
          e.stopPropagation();
          onFormatTextRef.current?.(fmt.format);
        }
        return;
      }
      const fmt = FORMAT_SHORTCUTS.find((f) => f.code === e.code && !f.shift);
      if (fmt) {
        e.preventDefault();
        e.stopPropagation();
        onFormatTextRef.current?.(fmt.format);
      }
    };

    // Ctrl+クリック: リンクを外部ブラウザで開く (通常クリックはカーソル配置)。
    // エディタ内で遷移させない (WebViewが乗っ取られるのを防ぐ)。
    const handleLinkClick = (e: MouseEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const anchor = (e.target as HTMLElement | null)?.closest?.(
        'a[href]'
      ) as HTMLAnchorElement | null;
      if (!anchor) return;
      const href = anchor.getAttribute('href') ?? '';
      if (!/^(https?:|mailto:)/i.test(href)) return;
      e.preventDefault();
      e.stopPropagation();
      void import('@tauri-apps/plugin-opener')
        .then(({ openUrl }) => openUrl(href))
        .catch(() => {});
    };

    view.dom.addEventListener('drop', handleDrop);
    view.dom.addEventListener('dragover', handleDragOver);
    view.dom.addEventListener('keydown', handleKeyDown, true);
    view.dom.addEventListener('click', handleLinkClick, true);

    onReadyRef.current?.(view);
    return () => {
      view.dom.removeEventListener('drop', handleDrop);
      view.dom.removeEventListener('dragover', handleDragOver);
      view.dom.removeEventListener('keydown', handleKeyDown, true);
      view.dom.removeEventListener('click', handleLinkClick, true);
      view.destroy();
    };
  }, []);

  const editorClass = [
    'editor',
    showComments ? 'show-comments' : '',
    showLineNumbers ? 'with-line-numbers' : ''
  ]
    .filter(Boolean)
    .join(' ');

  const editorStyle: React.CSSProperties = {};
  if (Number.isFinite(fontSizePx) && (fontSizePx as number) > 0) {
    editorStyle.fontSize = `${fontSizePx}px`;
  }
  if (fontFamily) editorStyle.fontFamily = fontFamily;

  return (
    <div className="editor-container">
      <div ref={editorRef} className={editorClass} style={editorStyle} />
      <LineNumbersToggle visible={showLineNumbers} editorRef={editorRef} />
    </div>
  );
});

function LineNumbersToggle({
  visible,
  editorRef
}: {
  visible: boolean;
  editorRef: React.RefObject<HTMLDivElement | null>;
}) {
  useEffect(() => {
    setLineNumbersVisible(visible);
    const el = editorRef.current;
    if (el) el.classList.toggle('with-line-numbers', visible);
  }, [visible, editorRef]);
  return null;
}
