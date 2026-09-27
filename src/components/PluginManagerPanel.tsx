import { useCallback, useEffect, useState } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { ipc, type PluginInfo } from '../lib/ipc';

interface PluginManagerPanelProps {
  onClose: () => void;
}

export function PluginManagerPanel({ onClose }: PluginManagerPanelProps) {
  const [plugins, setPlugins] = useState<PluginInfo[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    setPlugins(await ipc.pluginList());
  }, []);

  useEffect(() => {
    void refresh().catch((cause) => setError(String(cause)));
  }, [refresh]);

  const install = async () => {
    setError(null);
    const selected = await open({
      multiple: false,
      filters: [{ name: 'markink plugin ZIP', extensions: ['zip'] }]
    });
    if (typeof selected !== 'string') return;
    setBusy(true);
    try {
      await ipc.pluginInstallZip(selected);
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
      await ipc.pluginUninstall(plugin.id);
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
          ZIPファイルを導入できます。現在は検証と保管のみで、プラグインコードは実行されません。
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
                <div className="plugin-manager-meta">導入済み・未実行</div>
              </div>
              <button className="btn" disabled={busy} onClick={() => void uninstall(plugin)}>削除</button>
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
