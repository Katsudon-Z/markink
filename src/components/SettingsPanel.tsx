/** アプリ全般の設定パネル (復元・AI呼び出し・自分の名前) */
import { useCallback, useEffect, useState } from 'react';
import { ipc, type AiServeStatus } from '../lib/ipc';
import { AI_SHORTCUTS, EDITOR_SHORTCUTS, FORMAT_SHORTCUTS } from '../lib/ai/shortcuts';

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
  const [aiEnabled, setAiEnabled] = useState(false);
  const [aiStatus, setAiStatus] = useState<AiServeStatus | null>(null);
  const [aiProvider, setAiProvider] = useState('local');
  const [userName, setUserName] = useState('');
  const [aiModel, setAiModel] = useState('');
  const [aiBackendUrl, setAiBackendUrl] = useState('');
  const [aiApiUrl, setAiApiUrl] = useState('');
  const [aiApiKey, setAiApiKey] = useState('');
  const [aiApiModel, setAiApiModel] = useState('');
  const [aiMaxChars, setAiMaxChars] = useState('8000');
  const [aiError, setAiError] = useState<string | null>(null);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [fontSize, setFontSize] = useState(String(fontSizePx));
  const [fontFamilyValue, setFontFamilyValue] = useState(fontFamily);
  const [appVersion, setAppVersion] = useState('');
  const [imagePathMode, setImagePathMode] = useState('relative');

  const FONT_PRESETS = [
    { value: '', label: '既定 (Segoe UI, メイリオ)' },
    { value: "'Yu Gothic', '游ゴシック', sans-serif", label: '游ゴシック' },
    { value: "'MS Gothic', 'ＭＳ ゴシック', sans-serif", label: 'MS ゴシック' },
    { value: "'MS Mincho', 'ＭＳ 明朝', serif", label: 'MS 明朝' },
    { value: "Consolas, 'Courier New', monospace", label: '等幅 (Consolas)' }
  ];

  const refreshAi = useCallback(async () => {
    try {
      const [s, st] = await Promise.all([ipc.mcpGetSettings(), ipc.aiStatus()]);
      setAiEnabled(s.aiCallEnabled);
      setAiProvider(s.aiProvider || 'local');
      setUserName(s.userName);
      setAiModel(s.aiModel);
      setAiBackendUrl(s.aiBackendUrl);
      setAiApiUrl(s.aiApiUrl);
      setAiApiKey(s.aiApiKey);
      setAiApiModel(s.aiApiModel);
      setAiMaxChars(String(s.aiMaxChars));
      setImagePathMode(s.imagePathMode === 'absolute' ? 'absolute' : 'relative');
      setAiStatus(st);
      setAiError(null);
    } catch (e) {
      setAiError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void refreshAi();
  }, [refreshAi]);

  useEffect(() => {
    void import('@tauri-apps/api/app')
      .then(({ getVersion }) => getVersion())
      .then((v) => setAppVersion(v))
      .catch(() => setAppVersion(''));
  }, []);

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

  const saveName = () => {
    void runAiAction(() => ipc.setUserName(userName)).then(() => onUserNameChange(userName.trim()));
  };

  const isApi = aiProvider === 'api';

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

        <h3 className="ai-settings-heading">自分の名前 (共同編集で表示)</h3>
        <div className="ai-settings-row">
          <span>名前 <small>(空ならPCのログインユーザ名)</small></span>
          <input
            type="text"
            value={userName}
            placeholder="例: 田中"
            onChange={(e) => setUserName(e.target.value)}
            onBlur={saveName}
            aria-label="共同編集で表示する自分の名前"
            className="ai-menu-input"
            style={{ position: 'static' }}
          />
        </div>

        <h3 className="ai-settings-heading">表示</h3>
        <div className="ai-settings-row">
          <span>行番号を表示する</span>
          <input
            type="checkbox"
            checked={lineNumbers}
            onChange={(e) => onLineNumbersChange(e.target.checked)}
            aria-label="行番号ガターを表示する"
          />
        </div>
        <div className="ai-settings-row">
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
        <div className="ai-settings-row">
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

        <h3 className="ai-settings-heading">画像</h3>
        <div className="ai-settings-row">
          <span>画像（リンク）のパス記録方式</span>
          <select
            value={imagePathMode}
            onChange={(e) => {
              setImagePathMode(e.target.value);
              void runAiAction(() => ipc.setImagePathMode(e.target.value));
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

        <h3 className="ai-settings-heading">エディタからのAI呼び出し (右クリックメニュー)</h3>        {aiError && <p className="ai-settings-error">{aiError}</p>}
        <div className="ai-settings-row">
          <span>
            有効化 <small>(ON のときのみAI呼び出しが使えます)</small>
          </span>
          <input
            type="checkbox"
            checked={aiEnabled}
            onChange={(e) => void runAiAction(() => ipc.aiSetEnabled(e.target.checked))}
            aria-label="エディタからのAI呼び出しを有効にする"
          />
        </div>
        <div className="ai-settings-row">
          <span>提供方式</span>
          <select
            value={aiProvider}
            onChange={(e) => {
              setAiProvider(e.target.value);
              void runAiAction(() => ipc.aiSetConfig({ provider: e.target.value }));
            }}
            aria-label="AIの提供方式"
          >
            <option value="local">ローカル (opencode serve)</option>
            <option value="api">API (OpenAI互換)</option>
          </select>
        </div>
        <div className="ai-settings-row">
          <span>状態</span>
          <strong>{aiStatus?.running ? `起動中 (${aiStatus.url})` : isApi ? 'API直呼出' : '停止中'}</strong>
        </div>
        {!isApi ? (
          <>
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
          </>
        ) : (
          <>
            <div className="ai-settings-row">
              <span>API URL (chat/completions)</span>
              <input
                type="text"
                value={aiApiUrl}
                placeholder="https://api.openai.com/v1/chat/completions"
                onChange={(e) => setAiApiUrl(e.target.value)}
                onBlur={() => void runAiAction(() => ipc.aiSetConfig({ apiUrl: aiApiUrl }))}
                aria-label="APIエンドポイントURL"
                className="ai-menu-input"
                style={{ position: 'static' }}
              />
            </div>
            <div className="ai-settings-row">
              <span>APIキー</span>
              <input
                type="password"
                value={aiApiKey}
                placeholder="sk-..."
                onChange={(e) => setAiApiKey(e.target.value)}
                onBlur={() => void runAiAction(() => ipc.aiSetConfig({ apiKey: aiApiKey }))}
                aria-label="APIキー"
                className="ai-menu-input"
                style={{ position: 'static' }}
              />
            </div>
            <div className="ai-settings-row">
              <span>モデル名</span>
              <input
                type="text"
                value={aiApiModel}
                placeholder="例: gpt-4o-mini"
                onChange={(e) => setAiApiModel(e.target.value)}
                onBlur={() => void runAiAction(() => ipc.aiSetConfig({ apiModel: aiApiModel }))}
                aria-label="APIモデル名"
                className="ai-menu-input"
                style={{ position: 'static' }}
              />
            </div>
          </>
        )}
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
          {isApi
            ? '文書内容は指定したAPIエンドポイントへ送信されます。'
            : '文書内容は localhost のAIサーバ経由で選択モデルに送信されます。'}
        </p>

        <h3 className="ai-settings-heading">ショートカットキー</h3>
        <button className="btn" onClick={() => setShowShortcuts((v) => !v)}>
          {showShortcuts ? '一覧を閉じる' : '一覧を表示'}
        </button>
        {showShortcuts && (
          <div className="ai-shortcut-list">
            <p className="restore-message">AI機能 (エディタにフォーカスがあるとき)</p>
            <ul>
              {AI_SHORTCUTS.map((s) => (
                <li key={s.mode}>
                  <code>{s.keys}</code> — {s.label}
                </li>
              ))}
            </ul>
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
        <h3 className="ai-settings-heading">バージョン情報</h3>
        <div className="ai-settings-row">
          <span>markink</span>
          <strong>{appVersion ? `バージョン ${appVersion}` : '確認中…'}</strong>
        </div>
        <div className="ai-settings-row">
          <span>公式サイト</span>
          <button
            className="btn"
            onClick={() => {
              void import('@tauri-apps/plugin-opener')
                .then(({ openUrl }) => openUrl('https://github.com/Katsudon-Z/markink'))
                .catch((e) =>
                  setAiError(e instanceof Error ? e.message : String(e))
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
