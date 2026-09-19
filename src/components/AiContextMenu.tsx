import { useEffect, useRef, useState } from 'react';
import type { AiModeId } from '../lib/ipc';

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

  // 画面内に収める
  const left = Math.max(8, Math.min(x, window.innerWidth - 264));
  const top = Math.max(8, Math.min(y, window.innerHeight - 260));

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
      style={{ left, top }}
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
