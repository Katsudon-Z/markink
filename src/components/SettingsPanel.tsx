/** アプリ全般の設定パネル (復元機能の有効/無効など) */
import { useCallback, useEffect, useState } from 'react';
import { ipc, type AiServeStatus } from '../lib/ipc';

export function SettingsPanel({
  restoreEnabled,
  onRestoreEnabledChange,
  onClose
}: {
  restoreEnabled: boolean;
  onRestoreEnabledChange: (enabled: boolean) => void;
  onClose: () => void;
}) {
  const [aiEnabled, setAiEnabled] = useState(false);
  const [aiStatus, setAiStatus] = useState<AiServeStatus | null>(null);
  const [aiModel, setAiModel] = useState('');
  const [aiBackendUrl, setAiBackendUrl] = useState('');
  const [aiMaxChars, setAiMaxChars] = useState('8000');
  const [aiError, setAiError] = useState<string | null>(null);

  const refreshAi = useCallback(async () => {
    try {
      const [s, st] = await Promise.all([ipc.mcpGetSettings(), ipc.aiStatus()]);
      setAiEnabled(s.aiCallEnabled);
      setAiModel(s.aiModel);
      setAiBackendUrl(s.aiBackendUrl);
      setAiMaxChars(String(s.aiMaxChars));
      setAiStatus(st);
      setAiError(null);
    } catch (e) {
      setAiError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void refreshAi();
  }, [refreshAi]);

  const runAiAction = useCallback(
    async (action: () => Promise<unknown>) => {
      try {
        await action();
        await refreshAi();
      } catch (e) {
        setAiError(e instanceof Error ? e.message : String(e));
      }
    },
    [refreshAi]
  );

  return (
    <div className="restore-overlay" role="dialog" aria-modal="true" aria-label="設定">
      <div className="restore-dialog ai-settings">
        <h2 className="restore-title">設定</h2>
        <div className="ai-settings-row">
          <span>
            前回保存していない内容の復元 <small>(ON のときのみ自動保存し、異常終了時に復元を提案します)</small>
          </span>
          <input
            type="checkbox"
            checked={restoreEnabled}
            onChange={(e) => onRestoreEnabledChange(e.target.checked)}
            aria-label="前回保存していない内容の復元を有効にする"
          />
        </div>
        {!restoreEnabled && (
          <p className="restore-message">
            現在は無効です。編集中の内容は自動保存されず、異常終了時に復元できません。
            こまめな保存をお願いします。
          </p>
        )}
        <h3 className="ai-settings-heading">エディタからのAI呼び出し (右クリックメニュー)</h3>
        {aiError && <p className="ai-settings-error">{aiError}</p>}
        <div className="ai-settings-row">
          <span>
            有効化 <small>(ON のときのみ localhost で opencode serve を起動します)</small>
          </span>
          <input
            type="checkbox"
            checked={aiEnabled}
            onChange={(e) => void runAiAction(() => ipc.aiSetEnabled(e.target.checked))}
            aria-label="エディタからのAI呼び出しを有効にする"
          />
        </div>
        <div className="ai-settings-row">
          <span>状態</span>
          <strong>{aiStatus?.running ? `起動中 (${aiStatus.url})` : '停止中'}</strong>
        </div>
        <div className="ai-settings-row">
          <span>モデル (空なら serve 側の既定)</span>
          <input
            type="text"
            value={aiModel}
            placeholder="例: opencode-go/kimi-k3"
            onChange={(e) => setAiModel(e.target.value)}
            onBlur={() => void runAiAction(() => ipc.aiSetConfig({ model: aiModel }))}
            aria-label="AIモデル"
            className="ai-menu-input"
            style={{ position: 'static' }}
          />
        </div>
        <div className="ai-settings-row">
          <span>接続先 (localhost のみ)</span>
          <input
            type="text"
            value={aiBackendUrl}
            onChange={(e) => setAiBackendUrl(e.target.value)}
            onBlur={() => void runAiAction(() => ipc.aiSetConfig({ backendUrl: aiBackendUrl }))}
            aria-label="AI接続先URL"
            className="ai-menu-input"
            style={{ position: 'static' }}
          />
        </div>
        <div className="ai-settings-row">
          <span>送信上限文字数</span>
          <input
            type="number"
            value={aiMaxChars}
            min={1000}
            max={100000}
            onChange={(e) => setAiMaxChars(e.target.value)}
            onBlur={() =>
              void runAiAction(() =>
                ipc.aiSetConfig({ maxChars: Number(aiMaxChars) || 8000 })
              )
            }
            aria-label="送信上限文字数"
          />
        </div>
        <p className="restore-message">
          右クリックメニューの「AI要約・AI続き・AI質問・AI編集代行」から使います。
          文書内容は localhost のAIサーバ経由で選択モデルに送信されます。
        </p>
        <div className="restore-actions">
          <button className="btn btn-primary" onClick={onClose}>
            閉じる
          </button>
        </div>
      </div>
    </div>
  );
}
