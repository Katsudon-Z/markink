import { useCallback, useEffect, useState } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { ipc, type PluginInfo } from '../lib/ipc';
import type { PluginPermission } from '../lib/plugins/api';
import { installedManifest } from '../lib/plugins/info';
import type { PluginManager, PluginState } from '../lib/plugins/manager';

interface PluginManagerPanelProps {
  manager: PluginManager;
  onClose: () => void;
}

export function PluginManagerPanel({ manager, onClose }: PluginManagerPanelProps) {
  const [plugins, setPlugins] = useState<PluginInfo[]>([]);
  const [states, setStates] = useState<Record<string, PluginState>>({});
  const [failures, setFailures] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [apiKeys, setApiKeys] = useState<Record<string, string>>({});
  const [hasApiKey, setHasApiKey] = useState<Record<string, boolean>>({});
  const [pendingUpdates, setPendingUpdates] = useState<Record<string, boolean>>({});
  const [settingValues, setSettingValues] = useState<Record<string, string>>({});

  const refresh = useCallback(async () => {
    const installed = await ipc.pluginList();
    setPlugins(installed);
    const keyStates = await Promise.all(installed.map(async (plugin) => [
      plugin.id,
      plugin.permissions.includes('secrets.use') ? await ipc.pluginHasApiKey(plugin.id) : false
    ] as const));
    setHasApiKey(Object.fromEntries(keyStates));
    const pending = await Promise.all(installed.map(async (plugin) => [
      plugin.id, await ipc.pluginHasPendingUpdate(plugin.id)
    ] as const));
    setPendingUpdates(Object.fromEntries(pending));
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
      multiple: true,
      filters: [{ name: 'markink plugin ZIP', extensions: ['zip'] }]
    });
    const paths = typeof selected === 'string' ? [selected] : selected;
    if (!paths?.length) return;
    setBusy(true);
    try {
      const errors: string[] = [];
      for (const path of paths) {
        try {
          const preview = await ipc.pluginPreviewZip(path);
          const previous = (await ipc.pluginList()).find((item) => item.id === preview.id);
          if (previous && !window.confirm(
            `「${previous.name} ${previous.version}」を「${preview.name} ${preview.version}」へ更新しますか？\n` +
            `要求権限: ${preview.permissions.length ? preview.permissions.join(', ') : 'なし'}\n` +
            `通信先: ${preview.networkOrigins.length ? preview.networkOrigins.join(', ') : 'なし'}\n` +
            '実行中の場合は停止し、更新後は再度有効化が必要です。'
          )) continue;
          const wasActive = manager.list().some((item) => item.manifest.id === preview.id && item.state === 'active');
          const wasEnabled = previous && (await ipc.pluginEnabledIds()).includes(preview.id);
          if (previous) await ipc.pluginSetEnabled(preview.id, false);
          if (wasActive) await manager.disable(preview.id);
          try {
            await ipc.pluginInstallZip(path, preview);
          } catch (installError) {
            if (previous) {
              try {
                if (wasActive) {
                  const oldManifest = installedManifest(previous);
                  await manager.enable(oldManifest, new Set(oldManifest.permissions as PluginPermission[]));
                }
                if (wasEnabled) await ipc.pluginSetEnabled(preview.id, true);
              } catch (restoreError) {
                throw new Error(`更新に失敗し、旧版の状態復元にも失敗しました: ${String(installError)} / ${String(restoreError)}`);
              }
            }
            throw installError;
          }
        } catch (cause) {
          errors.push(`${path}: ${String(cause)}`);
        }
      }
      await refresh();
      if (errors.length) setError(errors.join('\n'));
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
      await ipc.pluginSetEnabled(plugin.id, false);
      await manager.disable(plugin.id);
      await ipc.pluginUninstall(plugin.id);
      await refresh();
    } catch (cause) {
      setError(String(cause));
    } finally {
      setBusy(false);
    }
  };

  const rollback = async (plugin: PluginInfo) => {
    setError(null);
    setBusy(true);
    try {
      await ipc.pluginSetEnabled(plugin.id, false);
      await manager.disable(plugin.id);
      await ipc.pluginRollbackUpdate(plugin.id);
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
        await ipc.pluginSetEnabled(plugin.id, false);
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
        const manifest = installedManifest(plugin);
        const pendingUpdate = await ipc.pluginHasPendingUpdate(plugin.id);
        try {
          await manager.enable(manifest, new Set(manifest.permissions as PluginPermission[]));
        } catch (startupError) {
          if (pendingUpdate) {
            await manager.disable(plugin.id);
            try {
              await ipc.pluginRollbackUpdate(plugin.id);
            } catch (rollbackError) {
              throw new Error(`新版の起動と旧版の復元に失敗しました: ${String(startupError)} / ${String(rollbackError)}`);
            }
            throw new Error(`新版の起動に失敗したため旧版へ戻しました: ${String(startupError)}`);
          }
          throw startupError;
        }
        if (pendingUpdate) await ipc.pluginCommitUpdate(plugin.id);
        try {
          await ipc.pluginSetEnabled(plugin.id, true);
        } catch (cause) {
          await manager.disable(plugin.id);
          throw cause;
        }
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
      <section className="restore-dialog settings-dialog plugin-manager">
        <h2 id="plugin-manager-title" className="restore-title">プラグイン管理</h2>
        <p className="restore-message">
          複数のZIPを導入できます。有効にしたプラグインは次回起動時も有効になります。
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
                {pendingUpdates[plugin.id] && <div className="plugin-manager-meta">更新待ち: 新版の起動確認後に旧版を削除します。</div>}
                {failures[plugin.id] && <div className="plugin-manager-error">{failures[plugin.id]}</div>}
              </div>
              <div className="plugin-manager-buttons">
                <button className="btn" disabled={busy || !plugin.executable} onClick={() => void toggle(plugin)}>
                  {states[plugin.id] === 'active' || states[plugin.id] === 'failed' ? '停止' : '有効化'}
                </button>
                <button className="btn" disabled={busy} onClick={() => void uninstall(plugin)}>削除</button>
                {pendingUpdates[plugin.id] && <button className="btn" disabled={busy} onClick={() => void rollback(plugin)}>旧版へ戻す</button>}
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
