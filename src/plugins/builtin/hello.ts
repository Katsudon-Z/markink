import type { PluginModule } from '../../lib/plugins/types';
import { PLUGIN_API_VERSION } from '../../lib/plugins/types';

/** 起動確認＋slot 実証用ダミー。Phase 2 で ai、Phase 3 で chart を追加する。 */
export const helloPlugin: PluginModule = {
  manifest: {
    id: 'builtin.hello',
    name: 'Hello (動作確認用)',
    version: '0.2.0',
    apiVersion: PLUGIN_API_VERSION
  },
  activate(ctx) {
    ctx.log('activated');
    ctx.commands.register({
      id: 'hello.greet',
      title: 'Hello (動作確認)',
      run: () => {
        ctx.log('hello');
        return true;
      }
    });
    // Ctrl+Shift+H でログ出力 (Editor の共有レジストリ経由で発火する)
    ctx.shortcuts.bind({
      id: 'hello.greet',
      code: 'KeyH',
      shift: true,
      run: () => {
        ctx.log('hello via shortcut');
        return true;
      }
    });
    ctx.contextMenu.add({ id: 'hello.greet', label: 'Hello', onSelect: () => ctx.log('hello') });
    ctx.settings.addSection({ id: 'hello', title: 'Hello' });
  }
};
