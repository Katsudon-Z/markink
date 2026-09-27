import { EXTENSION_API_VERSION } from './api';
import type {
  PluginHostApi,
  PluginId,
  PluginManifest,
  PluginPermission,
  PluginRuntime
} from './api';

export type PluginState = 'disabled' | 'starting' | 'active' | 'failed';

export interface ManagedPlugin {
  manifest: PluginManifest;
  state: PluginState;
  error?: string;
}

export interface PluginManagerOptions {
  runtime: PluginRuntime;
  createHostApi: (manifest: PluginManifest, permissions: ReadonlySet<PluginPermission>) => PluginHostApi;
}

/** In-memory lifecycle manager. Persistence and ZIP installation belong to the platform layer. */
export class PluginManager {
  private readonly plugins = new Map<PluginId, ManagedPlugin>();
  private readonly hostApis = new Map<PluginId, PluginHostApi>();

  constructor(private readonly options: PluginManagerOptions) {}

  list(): ManagedPlugin[] {
    return [...this.plugins.values()].map((plugin) => ({ ...plugin }));
  }

  async enable(
    manifest: PluginManifest,
    grantedPermissions: ReadonlySet<PluginPermission>
  ): Promise<void> {
    if (manifest.apiVersion !== EXTENSION_API_VERSION) throw new Error('互換性のない Extension API です。');
    if (!manifest.entry) throw new Error('実行entryがmanifestにありません。');
    const current = this.plugins.get(manifest.id);
    if (current?.state === 'active') {
      if (current.manifest.version !== manifest.version) {
        throw new Error('有効なプラグインの更新前に、現在の版を無効化してください。');
      }
      return;
    }
    if (current?.state === 'starting') throw new Error('プラグインは起動中です。');
    if (current?.state === 'failed') throw new Error('失敗したプラグインを無効化してから再試行してください。');
    for (const permission of manifest.permissions) {
      if (!grantedPermissions.has(permission)) {
        throw new Error(`プラグイン ${manifest.name} に必要な権限が許可されていません: ${permission}`);
      }
    }

    this.plugins.set(manifest.id, { manifest, state: 'starting' });
    let host: PluginHostApi | undefined;
    try {
      const approved = new Set(manifest.permissions.filter((permission) => grantedPermissions.has(permission)));
      host = this.options.createHostApi(manifest, approved);
      await this.options.runtime.start(manifest, host);
      this.hostApis.set(manifest.id, host);
      this.plugins.set(manifest.id, { manifest, state: 'active' });
    } catch (error) {
      await host?.dispose();
      this.hostApis.delete(manifest.id);
      this.plugins.set(manifest.id, {
        manifest,
        state: 'failed',
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  async disable(pluginId: PluginId): Promise<void> {
    const current = this.plugins.get(pluginId);
    if (!current || current.state === 'disabled') return;
    try {
      await this.options.runtime.stop(pluginId);
      await this.hostApis.get(pluginId)?.dispose();
      this.hostApis.delete(pluginId);
      this.plugins.set(pluginId, { manifest: current.manifest, state: 'disabled' });
    } catch (error) {
      await this.hostApis.get(pluginId)?.dispose();
      this.hostApis.delete(pluginId);
      this.plugins.set(pluginId, {
        manifest: current.manifest,
        state: 'failed',
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }
}
