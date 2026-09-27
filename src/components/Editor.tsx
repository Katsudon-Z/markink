import React, { useEffect, useRef } from 'react';
import { EditorView } from 'prosemirror-view';
import { createEditorView } from '../lib/prosemirror/editor';
import { handleImageDropPasteFactory } from '../lib/prosemirror/image';
import { matchShortcut } from '../lib/plugins/slots';
import { registerCoreShortcuts } from '../lib/plugins/coreShortcuts';
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
  /** 書式ショートカット (commands.ts のフォーマットID)。AI 系は AI プラグインが所有 */
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
  onFormatText
}: EditorProps) {
  const editorRef = useRef<HTMLDivElement>(null);
  const onChangeRef = useRef(onChange);
  const onReadyRef = useRef(onReady);
  const getDocDirRef = useRef(getDocDir);
  const onFormatTextRef = useRef(onFormatText);
  onChangeRef.current = onChange;
  onReadyRef.current = onReady;
  getDocDirRef.current = getDocDir;
  onFormatTextRef.current = onFormatText;

  useEffect(() => {
    if (!editorRef.current) return;
    // 中核ショートカット (書式) を共有レジストリに登録。解除は unmount 時。
    const unregisterCore = registerCoreShortcuts({
      onFormatText: (id) => onFormatTextRef.current?.(id)
    });
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
    // Ctrl/Cmd 系ショートカットは共有レジストリで引く (中核分は mount 時に登録)。
    // 対応表は coreShortcuts.ts が単一情報源。従来の直書き分岐と同等。
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.repeat) return;
      if (view.composing) return;
      if (e.altKey) return;
      // プラグイン UI (チャート編集欄など) のキー操作は本体で拾わない
      const target = e.target as HTMLElement | null;
      if (target?.closest?.('[data-plugin-ui]')) return;
      const run = matchShortcut(e.code, e.shiftKey);
      if (!run) return;
      e.preventDefault();
      e.stopPropagation();
      run();
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
      unregisterCore();
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
