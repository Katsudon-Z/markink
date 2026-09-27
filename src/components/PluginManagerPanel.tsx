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
    ...(plugin.description ? { description: plugin.description } : {}),
    ...(plugin.author ? { author: plugin.author } : {}),
    ...(plugin.entry ? { entry: plugin.entry } : {})
  }));
}

export function PluginManagerPanel({ manager, onClose }: PluginManagerPanelProps) {
  const [plugins, setPlugins] = useState<PluginInfo[]>([]);
  const [states, setStates] = useState<Record<string, PluginState>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    setPlugins(await ipc.pluginList());
    setStates(Object.fromEntries(manager.list().map((item) => [item.manifest.id, item.state])));
  }, [manager]);

  useEffect(() => {
    void refresh().catch((cause) => setError(String(cause)));
  }, [refresh]);

  useEffect(() => manager.subscribe(() => {
    setStates(Object.fromEntries(manager.list().map((item) => [item.manifest.id, item.state])));
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
      const incoming = await ipc.pluginInstallZip(selected);
      await manager.disable(incoming.id);
      await refresh();
    } catch (cause) {
      setError(String(cause));
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
                <div className="plugin-manager-meta">状態: {states[plugin.id] === 'active' ? '実行中' : states[plugin.id] === 'failed' ? '実行失敗' : '停止中'}</div>
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
