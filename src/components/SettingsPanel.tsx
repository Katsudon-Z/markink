/** アプリ全般の設定パネル。 */
import { useCallback, useEffect, useState } from 'react';
import { ipc } from '../lib/ipc';
import { EDITOR_SHORTCUTS, FORMAT_SHORTCUTS } from '../lib/prosemirror/shortcuts';

export function SettingsPanel({
  restoreEnabled,
  onRestoreEnabledChange,
  onUserNameChange,
  lineNumbers,
  onLineNumbersChange,
  fontSizePx,
  fontFamily,
  onEditorFontChange,
  onClose
}: {
  restoreEnabled: boolean;
  onRestoreEnabledChange: (enabled: boolean) => void;
  onUserNameChange: (name: string) => void;
  lineNumbers: boolean;
  onLineNumbersChange: (enabled: boolean) => void;
  fontSizePx: number;
  fontFamily: string;
  onEditorFontChange: (patch: { sizePx?: number; family?: string }) => void;
  onClose: () => void;
}) {
  const [userName, setUserName] = useState('');
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [fontSize, setFontSize] = useState(String(fontSizePx));
  const [fontFamilyValue, setFontFamilyValue] = useState(fontFamily);
  const [appVersion, setAppVersion] = useState('');
  const [imagePathMode, setImagePathMode] = useState('relative');
  const [fileLoggingEnabled, setFileLoggingEnabled] = useState(false);
  const [fileLoggingLevel, setFileLoggingLevel] = useState<'error' | 'warn' | 'info' | 'debug'>('warn');

  const FONT_PRESETS = [
    { value: '', label: '既定 (Segoe UI, メイリオ)' },
    { value: "'Yu Gothic', '游ゴシック', sans-serif", label: '游ゴシック' },
    { value: "'MS Gothic', 'ＭＳ ゴシック', sans-serif", label: 'MS ゴシック' },
    { value: "'MS Mincho', 'ＭＳ 明朝', serif", label: 'MS 明朝' },
    { value: "Consolas, 'Courier New', monospace", label: '等幅 (Consolas)' }
  ];

  const refreshSettings = useCallback(async () => {
    try {
      const settings = await ipc.getSettings();
      setUserName(settings.userName);
      setImagePathMode(settings.imagePathMode === 'absolute' ? 'absolute' : 'relative');
      setFileLoggingEnabled(settings.fileLoggingEnabled);
      setFileLoggingLevel(settings.fileLoggingLevel);
      setSettingsError(null);
    } catch (error) {
      setSettingsError(String(error));
    }
  }, []);

  useEffect(() => { void refreshSettings(); }, [refreshSettings]);

  useEffect(() => {
    void import('@tauri-apps/api/app')
      .then(({ getVersion }) => getVersion())
      .then((v) => setAppVersion(v))
      .catch(() => setAppVersion(''));
  }, []);

  const runSettingsAction = useCallback(
    async (action: () => Promise<unknown>) => {
      try {
        await action();
        await refreshSettings();
      } catch (e) {
        setSettingsError(e instanceof Error ? e.message : String(e));
      }
    },
    [refreshSettings]
  );

  const saveName = () => {
    void runSettingsAction(() => ipc.setUserName(userName)).then(() => onUserNameChange(userName.trim()));
  };

  return (
    <div className="restore-overlay" role="dialog" aria-modal="true" aria-label="設定">
      <div className="restore-dialog settings-dialog">
        <h2 className="restore-title">設定</h2>
        {settingsError && <p className="settings-dialog-error" role="alert">{settingsError}</p>}
        <div className="settings-dialog-row">
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

        <h3 className="settings-dialog-heading">自分の名前 (共同編集で表示)</h3>
        <div className="settings-dialog-row">
          <span>名前 <small>(空ならPCのログインユーザ名)</small></span>
          <input
            type="text"
            value={userName}
            placeholder="例: 田中"
            onChange={(e) => setUserName(e.target.value)}
            onBlur={saveName}
            aria-label="共同編集で表示する自分の名前"
            className="plugin-menu-input"
            style={{ position: 'static' }}
          />
        </div>

        <h3 className="settings-dialog-heading">表示</h3>
        <div className="settings-dialog-row">
          <span>行番号を表示する</span>
          <input
            type="checkbox"
            checked={lineNumbers}
            onChange={(e) => onLineNumbersChange(e.target.checked)}
            aria-label="行番号ガターを表示する"
          />
        </div>
        <div className="settings-dialog-row">
          <span>文字サイズ (px)</span>
          <input
            type="number"
            value={fontSize}
            min={10}
            max={32}
            onChange={(e) => setFontSize(e.target.value)}
            onBlur={() => {
              const px = Number(fontSize);
              if (Number.isFinite(px)) onEditorFontChange({ sizePx: px });
            }}
            aria-label="エディタの文字サイズ"
          />
        </div>
        <div className="settings-dialog-row">
          <span>フォント</span>
          <select
            value={
              FONT_PRESETS.some((p) => p.value === fontFamilyValue) ? fontFamilyValue : ''
            }
            onChange={(e) => {
              setFontFamilyValue(e.target.value);
              onEditorFontChange({ family: e.target.value });
            }}
            aria-label="エディタのフォント"
          >
            {FONT_PRESETS.map((p) => (
              <option key={p.label} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
        </div>

        <h3 className="settings-dialog-heading">画像</h3>
        <div className="settings-dialog-row">
          <span>画像（リンク）のパス記録方式</span>
          <select
            value={imagePathMode}
            onChange={(e) => {
              setImagePathMode(e.target.value);
              void runSettingsAction(() => ipc.setImagePathMode(e.target.value));
            }}
            aria-label="画像リンクのパス記録方式"
          >
            <option value="relative">相対</option>
            <option value="absolute">絶対</option>
          </select>
        </div>
        <p className="restore-message">
          「画像（リンク）」で挿入するときの記録方式 (既定: 相対)。
          「画像（コピー）」は常にassetsへコピーします。
        </p>

        <h3 className="settings-dialog-heading">ログ</h3>
        <div className="settings-dialog-row">
          <span>ログをファイルに出力する</span>
          <input
            type="checkbox"
            checked={fileLoggingEnabled}
            onChange={(e) => {
              const enabled = e.target.checked;
              setFileLoggingEnabled(enabled);
              void runSettingsAction(() => ipc.setFileLogging(enabled, fileLoggingLevel));
            }}
            aria-label="ログをファイルに出力する"
          />
        </div>
        <div className="settings-dialog-row">
          <span>ログレベル</span>
          <select
            value={fileLoggingLevel}
            onChange={(e) => {
              const level = e.target.value as typeof fileLoggingLevel;
              setFileLoggingLevel(level);
              void runSettingsAction(() => ipc.setFileLogging(fileLoggingEnabled, level));
            }}
            aria-label="ログレベル"
          >
            <option value="error">Error</option>
            <option value="warn">Warn</option>
            <option value="info">Info</option>
            <option value="debug">Debug</option>
          </select>
        </div>
        <p className="restore-message">設定はすぐに反映されます。ログはアプリのローカルデータ領域に保存されます。</p>

        <h3 className="settings-dialog-heading">ショートカットキー</h3>
        <button className="btn" onClick={() => setShowShortcuts((v) => !v)}>
          {showShortcuts ? '一覧を閉じる' : '一覧を表示'}
        </button>
        {showShortcuts && (
          <div className="shortcut-list">
            <p className="restore-message">編集</p>
            <ul>
              {EDITOR_SHORTCUTS.map((s) => (
                <li key={s.keys}>
                  <code>{s.keys}</code> — {s.label}
                </li>
              ))}
            </ul>
            <p className="restore-message">書式</p>
            <ul>
              {FORMAT_SHORTCUTS.map((s) => (
                <li key={s.format}>
                  <code>{s.keys}</code> — {s.label}
                </li>
              ))}
            </ul>
          </div>
        )}
        <h3 className="settings-dialog-heading">バージョン情報</h3>
        <div className="settings-dialog-row">
          <span>markink</span>
          <strong>{appVersion ? `バージョン ${appVersion}` : '確認中…'}</strong>
        </div>
        <div className="settings-dialog-row">
          <span>公式サイト</span>
          <button
            className="btn"
            onClick={() => {
              void import('@tauri-apps/plugin-opener')
                .then(({ openUrl }) => openUrl('https://github.com/Katsudon-Z/markink'))
                .catch((e) =>
                  setSettingsError(e instanceof Error ? e.message : String(e))
                );
            }}
          >
            https://github.com/Katsudon-Z/markink を開く
          </button>
        </div>
        <div className="restore-actions">
          <button className="btn btn-primary" onClick={onClose}>
            閉じる
          </button>
        </div>
      </div>
    </div>
  );
}
