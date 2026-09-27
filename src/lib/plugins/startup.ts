import { builtinPlugins } from '../../plugins/builtin';
import { createPluginContext, loadPlugins, type LoadResult } from './loader';
import { importPluginFile, loadExternalModules } from './external';
import { PluginRegistry } from './registry';
import { ipc } from '../ipc';
import { writeLog } from '../log';

/** 本体同梱＋外部プラグインの保管庫 (起動時に1回だけ投入する)。 */
export const pluginRegistry = new PluginRegistry();

/** 起動済みプラグインの一覧 (設定画面の表示用)。外部は id のみ分かるものもある。 */
export function listLoadedPlugins(): { id: string; name: string }[] {
  return pluginRegistry.list().map((m) => ({ id: m.manifest.id, name: m.manifest.name }));
}

/** 同梱→外部の順に起動する。失敗があっても throw しない (本体起動を継続する)。 */
export async function startPlugins(): Promise<LoadResult> {
  const builtin = await loadPlugins(builtinPlugins, createPluginContext, pluginRegistry);
  let disabled: string[] = [];
  try {
    disabled = (await ipc.mcpGetSettings()).disabledPlugins ?? [];
  } catch {
    disabled = [];
  }
  const external = await loadExternalModules({
    listFiles: () => ipc.listPlugins(),
    importModule: (path) => importPluginFile(path),
    isDisabled: (id) => disabled.includes(id)
  });
  for (const s of external.skipped) writeLog('info', 'plugin-host', `${s} は無効化のため起動しません`);
  for (const f of external.failed) writeLog('warn', 'plugin-host', `${f.file} を読み込めません: ${f.error}`);
  const activated = await loadPlugins(external.modules, createPluginContext, pluginRegistry);
  for (const f of activated.failed) writeLog('warn', 'plugin-host', `${f.id} を有効化できません: ${f.error}`);
  const loaded = [...builtin.loaded, ...activated.loaded];
  const failed = [
    ...builtin.failed,
    ...external.failed.map((f) => ({ id: f.file, error: f.error })),
    ...activated.failed
  ];
  writeLog('info', 'plugin-host', `プラグイン起動: ${loaded.length}件`);
  return { loaded, failed };
}
