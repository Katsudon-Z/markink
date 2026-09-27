import { useCallback, useEffect, useState } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { ipc, type PluginInfo } from '../lib/ipc';
import type { PluginManifest, PluginPermission } from '../lib/plugins/api';
import { parsePluginManifest } from '../lib/plugins/manifest';
import type { PluginManager, PluginState } from '../lib/plugins/manager';

interface PluginManagerPanelProps {
  manager: PluginManager;
  onClose: () => void;
}

function toManifest(plugin: PluginInfo): PluginManifest {
  return parsePluginManifest(JSON.stringify({
    id: plugin.id, name: plugin.name, version: plugin.version,
    apiVersion: plugin.apiVersion, permissions: plugin.permissions,
    networkOrigins: plugin.networkOrigins, settingsFields: plugin.settingsFields,
    ...(plugin.description ? { description: plugin.description } : {}),
    ...(plugin.author ? { author: plugin.author } : {}),
    ...(plugin.entry ? { entry: plugin.entry } : {})
  }));
}

export function PluginManagerPanel({ manager, onClose }: PluginManagerPanelProps) {
  const [plugins, setPlugins] = useState<PluginInfo[]>([]);
  const [states, setStates] = useState<Record<string, PluginState>>({});
  const [failures, setFailures] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [apiKeys, setApiKeys] = useState<Record<string, string>>({});
  const [hasApiKey, setHasApiKey] = useState<Record<string, boolean>>({});
  const [settingValues, setSettingValues] = useState<Record<string, string>>({});

  const refresh = useCallback(async () => {
    const installed = await ipc.pluginList();
    setPlugins(installed);
    const keyStates = await Promise.all(installed.map(async (plugin) => [
      plugin.id,
      plugin.permissions.includes('secrets.use') ? await ipc.pluginHasApiKey(plugin.id) : false
    ] as const));
    setHasApiKey(Object.fromEntries(keyStates));
    const values = await Promise.all(installed.flatMap((plugin) => plugin.settingsFields.map(async (field) => [
      `${plugin.id}:${field.key}`,
      await ipc.pluginGetSetting(plugin.id, field.key) ?? field.defaultValue ?? ''
    ] as const)));
    setSettingValues(Object.fromEntries(values));
    setStates(Object.fromEntries(manager.list().map((item) => [item.manifest.id, item.state])));
    setFailures(Object.fromEntries(manager.list().filter((item) => item.error).map((item) => [item.manifest.id, item.error!] )));
  }, [manager]);

  useEffect(() => {
    void refresh().catch((cause) => setError(String(cause)));
  }, [refresh]);

  useEffect(() => manager.subscribe(() => {
    setStates(Object.fromEntries(manager.list().map((item) => [item.manifest.id, item.state])));
    setFailures(Object.fromEntries(manager.list().filter((item) => item.error).map((item) => [item.manifest.id, item.error!] )));
  }), [manager]);

  const install = async () => {
    setError(null);
    const selected = await open({
      multiple: false,
      filters: [{ name: 'markink plugin ZIP', extensions: ['zip'] }]
    });
    if (typeof selected !== 'string') return;
    setBusy(true);
    try {
      const preview = await ipc.pluginPreviewZip(selected);
      const previous = plugins.find((item) => item.id === preview.id);
      if (previous && !window.confirm(
        `「${previous.name} ${previous.version}」を「${preview.name} ${preview.version}」へ更新しますか？\n` +
        `要求権限: ${preview.permissions.length ? preview.permissions.join(', ') : 'なし'}\n` +
        `通信先: ${preview.networkOrigins.length ? preview.networkOrigins.join(', ') : 'なし'}\n` +
        '実行中の場合は停止し、更新後は再度有効化が必要です。'
      )) return;
      const wasActive = manager.list().some((item) => item.manifest.id === preview.id && item.state === 'active');
      if (wasActive) await manager.disable(preview.id);
      try {
        await ipc.pluginInstallZip(selected, preview);
      } catch (installError) {
        if (wasActive && previous) {
          try {
            const oldManifest = toManifest(previous);
            await manager.enable(oldManifest, new Set(oldManifest.permissions as PluginPermission[]));
          } catch (restoreError) {
            throw new Error(`更新に失敗し、旧版の再起動にも失敗しました: ${String(installError)} / ${String(restoreError)}`);
          }
        }
        throw installError;
      }
      await refresh();
    } catch (cause) {
      setError(String(cause));
      await refresh().catch(() => {});
    } finally {
      setBusy(false);
    }
  };

  const uninstall = async (plugin: PluginInfo) => {
    if (!window.confirm(`「${plugin.name} ${plugin.version}」を削除しますか？`)) return;
    setError(null);
    setBusy(true);
    try {
      await manager.disable(plugin.id);
      await ipc.pluginUninstall(plugin.id);
      await refresh();
    } catch (cause) {
      setError(String(cause));
    } finally {
      setBusy(false);
    }
  };

  const toggle = async (plugin: PluginInfo) => {
    setError(null);
    setBusy(true);
    try {
      const state = states[plugin.id] ?? 'disabled';
      if (state === 'active' || state === 'failed') {
        await manager.disable(plugin.id);
      } else {
        if (!plugin.entry) throw new Error('実行entryがありません');
        if (!window.confirm(
          `「${plugin.name}」のコードを実行しますか？\n` +
          `要求権限: ${plugin.permissions.length ? plugin.permissions.join(', ') : 'なし'}\n` +
          `通信先: ${plugin.networkOrigins.length ? plugin.networkOrigins.join(', ') : 'なし'}\n` +
          'このZIPは信頼できる発行元から入手したものに限って有効化してください。' +
          'ZIPの発行元署名は検証されず、Workerは外部通信などを完全には制限できません。'
        )) return;
        const manifest = toManifest(plugin);
        await manager.enable(manifest, new Set(manifest.permissions as PluginPermission[]));
      }
      await refresh();
    } catch (cause) {
      setError(String(cause));
      await refresh().catch(() => {});
    } finally {
      setBusy(false);
    }
  };

  const saveApiKey = async (plugin: PluginInfo) => {
    setError(null);
    setBusy(true);
    try {
      await ipc.pluginSetApiKey(plugin.id, apiKeys[plugin.id] ?? '');
      setApiKeys((current) => ({ ...current, [plugin.id]: '' }));
      await refresh();
    } catch (cause) {
      setError(String(cause));
    } finally {
      setBusy(false);
    }
  };

  const deleteApiKey = async (plugin: PluginInfo) => {
    setError(null);
    setBusy(true);
    try {
      await ipc.pluginDeleteApiKey(plugin.id);
      await refresh();
    } catch (cause) {
      setError(String(cause));
    } finally {
      setBusy(false);
    }
  };

  const saveSetting = async (plugin: PluginInfo, field: PluginInfo['settingsFields'][number]) => {
    const value = (settingValues[`${plugin.id}:${field.key}`] ?? '').trim();
    if (!value || value.length > 4096 || (field.type === 'number' && !Number.isFinite(Number(value)))
      || (field.type === 'choice' && !field.options?.includes(value))) {
      setError(`「${field.label}」の値が不正です。`);
      return;
    }
    setError(null);
    setBusy(true);
    try {
      await ipc.pluginSetSetting(plugin.id, field.key, value);
      await refresh();
    } catch (cause) {
      setError(String(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="restore-overlay" role="dialog" aria-modal="true" aria-labelledby="plugin-manager-title">
      <section className="restore-dialog ai-settings plugin-manager">
        <h2 id="plugin-manager-title" className="restore-title">プラグイン管理</h2>
        <p className="restore-message">
          ZIPを導入し、信頼できるプラグインを有効化できます。有効化はこの起動中のみ有効です。
          ZIPの発行元署名は検証されず、Workerは外部通信などを完全には制限できません。
        </p>
        {error && <p className="plugin-manager-error" role="alert">{error}</p>}
        <div className="plugin-manager-list">
          {plugins.length === 0 ? (
            <p className="restore-message">導入済みのプラグインはありません。</p>
          ) : plugins.map((plugin) => (
            <article className="plugin-manager-item" key={plugin.id}>
              <div>
                <strong>{plugin.name}</strong> <span>v{plugin.version}</span>
                <div className="plugin-manager-meta">{plugin.id} · API {plugin.apiVersion}</div>
                {plugin.author && <div className="plugin-manager-meta">作者: {plugin.author}</div>}
                {plugin.description && <p>{plugin.description}</p>}
                {plugin.permissions.length > 0 && (
                  <div className="plugin-manager-meta">要求権限: {plugin.permissions.join(', ')}</div>
                )}
                {plugin.networkOrigins.length > 0 && (
                  <div className="plugin-manager-meta">通信先: {plugin.networkOrigins.join(', ')}</div>
                )}
                {plugin.settingsFields.map((field) => {
                  const key = `${plugin.id}:${field.key}`;
                  return <div className="plugin-manager-meta" key={key}>
                    <label htmlFor={`plugin-setting-${key}`}>{field.label}</label>
                    {field.type === 'choice' ? <select
                      id={`plugin-setting-${key}`}
                      value={settingValues[key] ?? ''}
                      onChange={(event) => setSettingValues((current) => ({ ...current, [key]: event.target.value }))}
                    >
                      {!settingValues[key] && <option value="">選択してください</option>}
                      {field.options?.map((option) => <option key={option} value={option}>{option}</option>)}
                    </select> : <input
                      id={`plugin-setting-${key}`}
                      type={field.type === 'number' ? 'number' : 'text'}
                      value={settingValues[key] ?? ''}
                      onChange={(event) => setSettingValues((current) => ({ ...current, [key]: event.target.value }))}
                    />}
                    <button className="btn" disabled={busy} onClick={() => void saveSetting(plugin, field)}>保存</button>
                  </div>;
                })}
                {plugin.permissions.includes('secrets.use') && (
                  <div className="plugin-manager-meta">
                    <label htmlFor={`plugin-api-key-${plugin.id}`}>APIキー: {hasApiKey[plugin.id] ? '設定済み' : '未設定'}</label>
                    <input
                      id={`plugin-api-key-${plugin.id}`}
                      type="password"
                      autoComplete="off"
                      value={apiKeys[plugin.id] ?? ''}
                      onChange={(event) => setApiKeys((current) => ({ ...current, [plugin.id]: event.target.value }))}
                    />
                    <button className="btn" disabled={busy || !(apiKeys[plugin.id] ?? '')} onClick={() => void saveApiKey(plugin)}>保存</button>
                    <button className="btn" disabled={busy || !hasApiKey[plugin.id]} onClick={() => void deleteApiKey(plugin)}>削除</button>
                  </div>
                )}
                <div className="plugin-manager-meta">状態: {states[plugin.id] === 'active' ? '実行中' : states[plugin.id] === 'failed' ? '実行失敗' : '停止中'}</div>
                {failures[plugin.id] && <div className="plugin-manager-error">{failures[plugin.id]}</div>}
              </div>
              <div className="plugin-manager-buttons">
                <button className="btn" disabled={busy || !plugin.executable} onClick={() => void toggle(plugin)}>
                  {states[plugin.id] === 'active' || states[plugin.id] === 'failed' ? '停止' : '有効化'}
                </button>
                <button className="btn" disabled={busy} onClick={() => void uninstall(plugin)}>削除</button>
              </div>
            </article>
          ))}
        </div>
        <div className="restore-actions">
          <button className="btn btn-primary" disabled={busy} onClick={() => void install()}>
            ZIPから導入
          </button>
          <button className="btn" onClick={onClose}>閉じる</button>
        </div>
      </section>
    </div>
  );
}
