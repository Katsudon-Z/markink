import type { AiModeId } from '../../../lib/ipc';
import type { PluginModule } from '../../../lib/plugins/types';
import { PLUGIN_API_VERSION } from '../../../lib/plugins/types';
import { aiBridge } from './bridge';

/** AI プラグイン。ショートカットの所有権を本体から引き受ける。 */
export const aiPlugin: PluginModule = {
  manifest: {
    id: 'builtin.ai',
    name: 'AI',
    version: '0.2.0',
    apiVersion: PLUGIN_API_VERSION,
    permissions: ['ai', 'settings']
  },
  activate(ctx) {
    ctx.log('activated');
    ctx.shortcuts.bind({
      id: 'ai.continue',
      code: 'Space',
      shift: false,
      run: () => aiBridge.continueDirectly?.() ?? false
    });
    const modes: { code: string; mode: AiModeId }[] = [
      { code: 'KeyS', mode: 'summary' },
      { code: 'KeyQ', mode: 'question' },
      { code: 'KeyE', mode: 'edit' }
    ];
    for (const { code, mode } of modes) {
      ctx.shortcuts.bind({
        id: `ai.${mode}`,
        code,
        shift: true,
        run: () => {
          aiBridge.handleAiShortcut?.(mode);
          return true;
        }
      });
    }
    ctx.settings.addSection({ id: 'ai', title: 'AI' });
  }
};
