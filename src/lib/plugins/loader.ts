import type { PluginContext, PluginManifest, PluginModule } from './types';
import { PluginRegistry } from './registry';
import { writeLog, type ActiveLogLevel } from '../log';
import {
  addContextMenuItem,
  addSettingsSection,
  bindShortcut,
  registerCodeBlockRenderer,
  registerCommand
} from './slots';

export interface PluginFailure {
  id: string;
  error: string;
}

export interface LoadResult {
  loaded: string[];
  failed: PluginFailure[];
}

const toErrorText = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/** 検証・activate を1件ずつ行う。失敗は隔離し、全体は止めない (本体の起動継続が要件)。 */
export async function loadPlugins(
  modules: readonly PluginModule[],
  createContext: (manifest: PluginManifest) => PluginContext,
  registry: PluginRegistry = new PluginRegistry()
): Promise<LoadResult> {
  const loaded: string[] = [];
  const failed: PluginFailure[] = [];
  for (const module of modules) {
    const id = module?.manifest?.id ?? '(unknown)';
    try {
      registry.register(module);
    } catch (err) {
      failed.push({ id, error: toErrorText(err) });
      continue;
    }
    try {
      await module.activate(createContext(module.manifest));
      loaded.push(id);
    } catch (err) {
      registry.unregister(id);
      failed.push({ id, error: toErrorText(err) });
    }
  }
  return { loaded, failed };
}

/** 文脈生成。各 slot は共有レジストリに結線する。log は共通ロガー経由。 */
export function createPluginContext(manifest: PluginManifest): PluginContext {
  return {
    manifest,
    log: (message: string, level: ActiveLogLevel = 'info') =>
      writeLog(level, `plugin:${manifest.id}`, message),
    commands: { register: (def) => registerCommand(def) },
    shortcuts: { bind: (def) => bindShortcut(def) },
    contextMenu: { add: (item) => addContextMenuItem(item) },
    settings: { addSection: (section) => addSettingsSection(section) },
    codeBlocks: { register: (renderer) => registerCodeBlockRenderer(renderer) }
  };
}
