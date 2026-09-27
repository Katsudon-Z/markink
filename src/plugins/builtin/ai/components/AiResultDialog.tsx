import { useEffect, useState } from 'react';

/**
 * AI応答の結果ダイアログ。
 * [挿入する][選択範囲を置換][コピー][破棄する]。実行中は経過表示+中断。
 */
export function AiResultDialog({
  title,
  busy,
  elapsedSecs,
  text,
  canReplace,
  error,
  onInsert,
  onReplace,
  onAbort,
  onClose
}: {
  title: string;
  busy: boolean;
  elapsedSecs: number;
  text: string;
  canReplace: boolean;
  error: string | null;
  onInsert: () => void;
  onReplace: () => void;
  onAbort: () => void;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1500);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const copy = () => {
    void navigator.clipboard
      ?.writeText(text)
      .then(() => setCopied(true))
      .catch(() => setCopied(false));
  };

  return (
    <div className="restore-overlay" role="dialog" aria-modal="true" aria-label={title}>
      <div className="restore-dialog ai-settings">
        <h2 className="restore-title">{title}</h2>
        {busy ? (
          <>
            <p className="restore-message">AIが考えています… ({elapsedSecs}秒)</p>
            <div className="restore-actions">
              <button className="btn" onClick={onAbort}>
                中断する
              </button>
            </div>
          </>
        ) : (
          <>
            {error && <p className="ai-settings-error">{error}</p>}
            {text && <pre className="ai-settings-code ai-result-pre">{text}</pre>}
            <div className="restore-actions">
              <button className="btn btn-primary" onClick={onInsert} disabled={!text}>
                挿入する
              </button>
              <button className="btn" onClick={onReplace} disabled={!text || !canReplace}>
                選択範囲を置換
              </button>
              <button className="btn" onClick={copy} disabled={!text}>
                {copied ? 'コピーしました' : 'コピー'}
              </button>
              <button className="btn" onClick={onClose}>
                破棄する
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
