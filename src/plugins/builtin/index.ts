import type { PluginModule } from '../../lib/plugins/types';
import { helloPlugin } from './hello';
import { aiPlugin } from './ai';
import { chartPlugin } from './chart';

/** 本体同梱プラグインの一覧 */
export const builtinPlugins: readonly PluginModule[] = [helloPlugin, aiPlugin, chartPlugin];
