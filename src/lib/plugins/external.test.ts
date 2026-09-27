import { describe, expect, it } from 'vitest';
import { findPluginModule, loadExternalModules } from './external';
import { aiPlugin } from '../../plugins/builtin/ai';
import { chartPlugin } from '../../plugins/builtin/chart';

describe('外部プラグイン読込 (Phase 4)', () => {
  it('名前空間から manifest＋activate を持つ export を拾う', () => {
    expect(findPluginModule({ aiPlugin })).toBe(aiPlugin);
    expect(findPluginModule({ chartPlugin })).toBe(chartPlugin);
    expect(findPluginModule({ nothing: 42 })).toBeNull();
    expect(findPluginModule({ broken: { manifest: { id: 'x' } } })).toBeNull();
  });

  it('無効化は読み込まず、破損は隔離する', async () => {
    const result = await loadExternalModules({
      listFiles: async () => ['a.mink.js', 'broken.mink.js', 'empty.mink.js'],
      importModule: async (path) => {
        if (path === 'a.mink.js') return { aiPlugin };
        if (path === 'broken.mink.js') throw new Error('読込失敗の再現');
        return {};
      },
      isDisabled: (id) => id === 'builtin.chart'
    });
    // a.mink.js=ai は有効で modules 入り。broken と空は failed に隔離
    expect(result.modules.map((m) => m.manifest.id)).toEqual(['builtin.ai']);
    expect(result.failed).toHaveLength(2);
    expect(result.failed[0].file).toBe('broken.mink.js');
  });

  it('無効 id は modules に入れない', async () => {
    const result = await loadExternalModules({
      listFiles: async () => ['x.mink.js'],
      importModule: async () => ({ chartPlugin }),
      isDisabled: (id) => id === 'builtin.chart'
    });
    expect(result.modules).toHaveLength(0);
    expect(result.skipped).toEqual(['builtin.chart']);
  });

  it('一覧の取得失敗は空振りする (ブラウザ開発時)', async () => {
    const result = await loadExternalModules({
      listFiles: async () => {
        throw new Error('Tauri 不在の再現');
      },
      importModule: async () => ({}),
      isDisabled: () => false
    });
    expect(result.modules).toHaveLength(0);
  });
});
