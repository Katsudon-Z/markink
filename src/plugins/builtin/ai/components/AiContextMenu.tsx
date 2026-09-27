import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { AiModeId } from '../../../../lib/ipc';

/**
 * エディタ右クリックのAIメニュー。
 * 4コマンド + メニュー内プロンプト入力欄 (質問・編集代行は必須)。
 * 入力欄の操作ではメニューを閉じない。Enter で質問を実行する。
 */
export function AiContextMenu({
  x,
  y,
  enabled,
  contextChars,
  hasSelection,
  autoFocusPrompt,
  onExecute,
  onCopy,
  onCut,
  onPaste,
  onClose,
  onOpenSettings
}: {
  x: number;
  y: number;
  enabled: boolean;
  contextChars: number;
  hasSelection: boolean;
  /** ショートカットから開いた場合、プロンプト欄にフォーカスする */
  autoFocusPrompt?: boolean;
  onExecute: (mode: AiModeId, prompt: string) => void;
  onCopy: () => void;
  onCut: () => void;
  onPaste: () => void;
  onClose: () => void;
  onOpenSettings: () => void;
}) {
  const [prompt, setPrompt] = useState('');
  const [hint, setHint] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  // 実測サイズで画面内に収める (下端がはみ出すときは上向きに開く)
  const [pos, setPos] = useState(() => {
    // 初回描画の一瞬のはみ出しを抑えるため、概算高さで事前クランプする
    const estH = 340;
    const estW = 256;
    const vw = typeof window !== 'undefined' ? window.innerWidth : 1024;
    const vh = typeof window !== 'undefined' ? window.innerHeight : 768;
    let top = y;
    if (y + estH > vh - 8) top = y - estH;
    top = Math.max(8, Math.min(top, Math.max(8, vh - estH - 8)));
    const left = Math.max(8, Math.min(x, Math.max(8, vw - estW - 8)));
    return { left, top };
  });
  const updatePos = () => {
    const el = rootRef.current;
    if (!el) return;
    const h = el.offsetHeight || 340;
    const w = el.offsetWidth || 256;
    let nextTop = y;
    if (y + h > window.innerHeight - 8) nextTop = y - h;
    nextTop = Math.max(8, nextTop);
    if (nextTop + h > window.innerHeight - 8) nextTop = Math.max(8, window.innerHeight - h - 8);
    const nextLeft = Math.max(8, Math.min(x, window.innerWidth - w - 8));
    setPos({ left: nextLeft, top: nextTop });
  };
  useLayoutEffect(updatePos, [x, y, hint, enabled]);
  useEffect(() => {
    window.addEventListener('resize', updatePos);
    return () => window.removeEventListener('resize', updatePos);
  }, [x, y]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    const onScroll = () => onClose();
    document.addEventListener('mousedown', onDown, true);
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('scroll', onScroll, true);
    return () => {
      document.removeEventListener('mousedown', onDown, true);
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('scroll', onScroll, true);
    };
  }, [onClose]);

  const run = (mode: AiModeId) => {
    if (!enabled) {
      setHint('AI呼び出しは設定で有効にしてください');
      return;
    }
    if ((mode === 'question' || mode === 'edit') && !prompt.trim()) {
      setHint('指示・質問を入力してください');
      inputRef.current?.focus();
      return;
    }
    onExecute(mode, prompt.trim());
  };

  const item = (mode: AiModeId, label: string, note: string) => (
    <button
      key={mode}
      type="button"
      className="ai-menu-item"
      onMouseDown={(e) => e.stopPropagation()}
      onClick={() => run(mode)}
    >
      <span>{label}</span>
      <small>{note}</small>
    </button>
  );

  const editItem = (key: string, label: string, action: () => void) => (
    <button
      key={key}
      type="button"
      className="ai-menu-item"
      onMouseDown={(e) => e.stopPropagation()}
      onClick={action}
    >
      <span>{label}</span>
    </button>
  );

  return (
    <div
      ref={rootRef}
      className="ai-context-menu"
      role="menu"
      aria-label="AIメニュー"
      style={{ left: pos.left, top: pos.top, maxHeight: 'calc(100vh - 16px)', overflowY: 'auto' }}
      onMouseDown={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="ai-menu-info">編集</div>
      {editItem('copy', 'コピー', onCopy)}
      {editItem('cut', '切り取り', onCut)}
      {editItem('paste', '貼り付け', onPaste)}
      <div className="ai-menu-info">
        {hasSelection ? '選択範囲を送信' : '文書全体を送信'} ({contextChars}文字)
      </div>
      {item('summary', 'AI要約', '箇条書き5行以内')}
      {item('continue', 'AI続き', 'カーソル位置から2〜3文')}
      {item('question', 'AI質問', '指示欄が必須')}
      {item('edit', 'AI編集代行', '指示欄が必須')}
      <input
        ref={inputRef}
        className="ai-menu-input"
        type="text"
        value={prompt}
        placeholder="指示・質問を入力 (Enterで質問)"
        aria-label="AIへの指示・質問"
        autoFocus={autoFocusPrompt === true}
        onMouseDown={(e) => e.stopPropagation()}
        onChange={(e) => {
          setPrompt(e.target.value);
          setHint(null);
        }}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter') run('question');
        }}
      />
      {hint ? (
        <div className="ai-menu-hint">{hint}</div>
      ) : !enabled ? (
        <button
          type="button"
          className="ai-menu-item ai-menu-sub"
          onMouseDown={(e) => e.stopPropagation()}
          onClick={onOpenSettings}
        >
          <span>AI呼び出しを有効にする…</span>
        </button>
      ) : null}
    </div>
  );
}
