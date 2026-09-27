import type { PluginModule } from './types';
import { validateManifest } from './registry';
import { ipc } from '../ipc';
import { writeLog } from '../log';

/**
 * 単一ファイル (.mink.js) の外部プラグイン読み込み。
 * 配置フォルダ (Rust list_plugins) → 動的 import → manifest 検証 → 呼出側で activate。
 * 1件の失敗はそのファイルだけ捨てる。Tauri 外 (ブラウザ開発) では空振りする。
 */

export type PluginNamespace = Record<string, unknown>;

export interface ExternalLoadDeps {
  listFiles: () => Promise<string[]>;
  importModule: (path: string) => Promise<PluginNamespace>;
  isDisabled: (id: string) => boolean;
}

const defaultDeps = (): ExternalLoadDeps => ({
  listFiles: () => ipc.listPlugins(),
  importModule: (path) => importPluginFile(path),
  isDisabled: () => false
});

/**
 * 配置ファイルをBlob URL経由で動的 import する。
 * asset 変換だと Windows パスの扱いで失敗するため、内容読み＋Blob に統一する。
 */
export async function importPluginFile(path: string): Promise<PluginNamespace> {
  const bytes = await ipc.readFileBytes(path);
  const code = new TextDecoder().decode(new Uint8Array(bytes));
  const url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
  try {
    return (await import(/* @vite-ignore */ url)) as PluginNamespace;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** 名前空間の export 群からプラグイン実体を探す。 Modular/Foo などの紛れは manifest で判定する。 */
export function findPluginModule(ns: PluginNamespace): PluginModule | null {
  for (const value of Object.values(ns)) {
    if (value == null || typeof value !== 'object') continue;
    const candidate = value as { manifest?: unknown; activate?: unknown };
    if (typeof candidate.activate !== 'function') continue;
    const module = value as PluginModule;
    if (validateManifest(module.manifest).length === 0) return module;
  }
  return null;
}

export interface ExternalLoadResult {
  modules: PluginModule[];
  skipped: string[];
  failed: { file: string; error: string }[];
}

/** 無効化済みは読み込まない (disabled は呼出側が設定から渡す)。 */
export async function loadExternalModules(deps: ExternalLoadDeps = defaultDeps()): Promise<ExternalLoadResult> {
  const modules: PluginModule[] = [];
  const skipped: string[] = [];
  const failed: { file: string; error: string }[] = [];
  let files: string[];
  try {
    files = await deps.listFiles();
  } catch (err) {
    writeLog('debug', 'plugin-host', `外部プラグイン一覧の取得を省略: ${err instanceof Error ? err.message : String(err)}`);
    return { modules, skipped, failed };
  }
  for (const file of files) {
    try {
      const ns = await deps.importModule(file);
      const module = findPluginModule(ns);
      if (!module) {
        failed.push({ file, error: 'プラグイン実体 (manifest＋activate) がありません' });
        continue;
      }
      if (deps.isDisabled(module.manifest.id)) {
        skipped.push(module.manifest.id);
        continue;
      }
      modules.push(module);
    } catch (err) {
      failed.push({ file, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return { modules, skipped, failed };
}
