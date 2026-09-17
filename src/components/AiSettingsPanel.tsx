import { useCallback, useEffect, useState } from 'react';
import { ipc, type McpSettings, type McpStatus } from '../lib/ipc';

/** AI共同編集 (MCPサーバ) の設定パネル。接続情報の表示・コピー・切断を行う */
export function AiSettingsPanel({ onClose }: { onClose: () => void }) {
  const [settings, setSettings] = useState<McpSettings | null>(null);
  const [status, setStatus] = useState<McpStatus | null>(null);
  const [exePath, setExePath] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [s, st] = await Promise.all([ipc.mcpGetSettings(), ipc.mcpStatus()]);
      setSettings(s);
      setStatus(st);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), 2000);
    return () => clearInterval(timer);
  }, [refresh]);

  useEffect(() => {
    void ipc.mcpExePath().then(setExePath).catch(() => setExePath('app.exe'));
  }, []);

  const copyText = useCallback(async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const area = document.createElement('textarea');
      area.value = text;
      document.body.appendChild(area);
      area.select();
      document.execCommand('copy');
      area.remove();
    }
    setCopied(label);
    window.setTimeout(() => setCopied(null), 1500);
  }, []);

  const runAction = useCallback(
    async (action: () => Promise<unknown>) => {
      try {
        await action();
        await refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [refresh]
  );

  const httpUrl =
    status?.httpPort != null ? `http://127.0.0.1:${status.httpPort}/mcp` : null;
  const stdioSnippet = JSON.stringify(
    { mcpServers: { mdnotepad: { command: exePath || 'app.exe', args: ['mcp-stdio'] } } },
    null,
    2
  );

  const stateLabel = !status?.enabled
    ? '無効'
    : status.connection
      ? `接続中: ${status.connection}`
      : '待機中 (AIの接続待ち)';

  return (
    <div className="restore-overlay" role="dialog" aria-modal="true" aria-label="AI共同編集の設定">
      <div className="restore-dialog ai-settings">
        <h2 className="restore-title">AI共同編集 (MCPサーバ)</h2>
        {error && <p className="ai-settings-error">{error}</p>}
        <div className="ai-settings-row">
          <span>
            有効化 <small>(ON のときのみ localhost で待ち受けます)</small>
          </span>
          <input
            type="checkbox"
            checked={settings?.mcpEnabled ?? false}
            onChange={(e) => void runAction(() => ipc.mcpSetEnabled(e.target.checked))}
            aria-label="AI共同編集を有効にする"
          />
        </div>
        <div className="ai-settings-row">
          <span>状態</span>
          <strong>{stateLabel}</strong>
        </div>
        {status?.connection && (
          <div className="ai-settings-row">
            <span>接続中のAI</span>
            <button className="btn" onClick={() => void runAction(() => ipc.mcpDisconnectAi())}>
              切断する
            </button>
          </div>
        )}
        <div className="ai-settings-row">
          <span>AI編集時の自動保存</span>
          <input
            type="checkbox"
            checked={settings?.aiAutoSave ?? true}
            onChange={(e) => void runAction(() => ipc.mcpSetAiAutoSave(e.target.checked))}
            aria-label="AI編集時に自動保存する"
          />
        </div>
        <h3 className="ai-settings-heading">接続方法1: stdio (Claude Desktop など)</h3>
        <p className="restore-message">AIクライアントの設定に以下を登録します。</p>
        <pre className="ai-settings-code">{stdioSnippet}</pre>
        <button className="btn" onClick={() => void copyText(stdioSnippet, 'stdio')}>
          {copied === 'stdio' ? 'コピーしました' : '設定をコピー'}
        </button>
        <h3 className="ai-settings-heading">接続方法2: HTTP (opencode / Cursor など)</h3>
        {httpUrl ? (
          <>
            <div className="ai-settings-row">
              <span>URL</span>
              <code>{httpUrl}</code>
            </div>
            <div className="ai-settings-row">
              <span>トークン</span>
              <code className="ai-settings-token">{settings?.mcpToken ?? '(なし)'}</code>
            </div>
            <div className="ai-settings-actions">
              <button
                className="btn"
                disabled={!httpUrl}
                onClick={() => httpUrl && void copyText(httpUrl, 'url')}
              >
                {copied === 'url' ? 'コピーしました' : 'URLをコピー'}
              </button>
              <button
                className="btn"
                disabled={!settings?.mcpToken}
                onClick={() => settings?.mcpToken && void copyText(settings.mcpToken, 'token')}
              >
                {copied === 'token' ? 'コピーしました' : 'トークンをコピー'}
              </button>
              <button
                className="btn"
                onClick={() =>
                  void runAction(async () => {
                    await ipc.mcpRegenerateToken();
                    await ipc.mcpDisconnectAi();
                  })
                }
              >
                トークンを再生成
              </button>
            </div>
            <p className="restore-message">
              Authorization ヘッダに「Bearer トークン」を付けて接続します。同時に参加できるAIは1つのみです。
            </p>
          </>
        ) : (
          <p className="restore-message">有効化すると URL とトークンを表示します。</p>
        )}
        <div className="restore-actions">
          <button className="btn btn-primary" onClick={onClose}>
            閉じる
          </button>
        </div>
      </div>
    </div>
  );
}
