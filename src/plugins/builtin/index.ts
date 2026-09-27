import type { PluginModule } from '../../lib/plugins/types';
import { helloPlugin } from './hello';
import { aiPlugin } from './ai';

/** 本体同梱プラグインの一覧。Phase 3 で chart を追加する。 */
export const builtinPlugins: readonly PluginModule[] = [helloPlugin, aiPlugin];
