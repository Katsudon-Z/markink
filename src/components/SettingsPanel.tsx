/** アプリ全般の設定パネル (復元機能の有効/無効など) */
export function SettingsPanel({
  restoreEnabled,
  onRestoreEnabledChange,
  onClose
}: {
  restoreEnabled: boolean;
  onRestoreEnabledChange: (enabled: boolean) => void;
  onClose: () => void;
}) {
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
        <div className="restore-actions">
          <button className="btn btn-primary" onClick={onClose}>
            閉じる
          </button>
        </div>
      </div>
    </div>
  );
}
