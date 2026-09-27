import { builtinPlugins } from '../../plugins/builtin';
import { createPluginContext, loadPlugins, type LoadResult } from './loader';
import { PluginRegistry } from './registry';
import { writeLog } from '../log';

/** 本体同梱プラグインの保管庫 (起動時に1回だけ投入する)。 */
export const pluginRegistry = new PluginRegistry();

/** 同梱プラグインを一括起動する。失敗があっても throw しない (本体起動を継続する)。 */
export function startPlugins(): Promise<LoadResult> {
  return loadPlugins(builtinPlugins, createPluginContext, pluginRegistry).then((result) => {
    for (const f of result.failed) writeLog('warn', 'plugin-host', `${f.id} の起動に失敗: ${f.error}`);
    writeLog('info', 'plugin-host', `プラグイン起動: ${result.loaded.length}件`);
    return result;
  });
}
