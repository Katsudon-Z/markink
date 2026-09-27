import type { PluginModule } from '../../../lib/plugins/types';
import { PLUGIN_API_VERSION } from '../../../lib/plugins/types';
import { createChartElement } from './ui';

/** チャートプラグイン。```chart フェンスを SVG プレビュー＋簡易編集で描く。 */
export const chartPlugin: PluginModule = {
  manifest: {
    id: 'builtin.chart',
    name: 'チャート',
    version: '0.2.0',
    apiVersion: PLUGIN_API_VERSION
  },
  activate(ctx) {
    ctx.log('activated');
    ctx.codeBlocks.register({
      lang: 'chart',
      render: (code, lang, edit) => createChartElement(code, lang, edit)
    });
    ctx.settings.addSection({ id: 'chart', title: 'チャート' });
  }
};
