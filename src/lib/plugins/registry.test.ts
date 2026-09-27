import { describe, expect, it } from 'vitest';
import { PLUGIN_API_VERSION, type PluginModule } from './types';
import { PluginRegistry, validateManifest } from './registry';
import { createPluginContext, loadPlugins } from './loader';

const valid = (id: string): PluginModule => ({
  manifest: { id, name: id, version: '0.2.0', apiVersion: PLUGIN_API_VERSION },
  activate: () => {}
});

describe('プラグイン基盤 (Phase 0)', () => {
  it('不正 manifest を登録拒否する', () => {
    const registry = new PluginRegistry();
    expect(() => registry.register(valid('Bad ID!') as PluginModule)).toThrow();
    expect(() =>
      registry.register({
        manifest: { id: 'x.bad', name: 'x', version: '1', apiVersion: '9.9' },
        activate: () => {}
      })
    ).toThrow();
    expect(registry.list()).toHaveLength(0);
  });

  it('重複 id を登録拒否する', () => {
    const registry = new PluginRegistry();
    registry.register(valid('builtin.hello'));
    expect(() => registry.register(valid('builtin.hello'))).toThrow();
    expect(validateManifest(valid('builtin.hello').manifest)).toEqual([]);
  });

  it('activate 失敗を隔離し、後続は起動する', async () => {
    const order: string[] = [];
    const boom: PluginModule = {
      manifest: { id: 'bad.boom', name: 'boom', version: '0.2.0', apiVersion: PLUGIN_API_VERSION },
      activate: () => {
        throw new Error('起動失敗の再現');
      }
    };
    const good: PluginModule = {
      manifest: { id: 'good.ok', name: 'ok', version: '0.2.0', apiVersion: PLUGIN_API_VERSION },
      activate: () => {
        order.push('good');
      }
    };
    const registry = new PluginRegistry();
    const result = await loadPlugins([boom, good], createPluginContext, registry);
    expect(result.loaded).toEqual(['good.ok']);
    expect(result.failed).toHaveLength(1);
    expect(order).toEqual(['good']);
    expect(registry.get('bad.boom')).toBeUndefined();
  });
});
