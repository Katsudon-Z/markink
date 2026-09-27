import { describe, expect, it } from 'vitest';
import {
  addContextMenuItem,
  addSettingsSection,
  bindShortcut,
  clearAllSlots,
  getCodeBlockRenderer,
  listContextMenuItems,
  listSettingsSections,
  listShortcuts,
  matchShortcut,
  registerCodeBlockRenderer,
  registerCommand,
  unbindShortcut,
  unregisterCodeBlockRenderer
} from './slots';
import { registerCoreShortcuts } from './coreShortcuts';
import { FORMAT_SHORTCUTS } from '../shortcuts';

describe('プラグイン slot (Phase 1)', () => {
  it('ショートカットは code＋shift の完全一致で先勝ち', () => {
    clearAllSlots();
    bindShortcut({ id: 'a', code: 'KeyH', shift: true, run: () => true });
    bindShortcut({ id: 'b', code: 'KeyH', shift: false, run: () => false });
    expect(matchShortcut('KeyH', true)?.()).toBe(true);
    expect(matchShortcut('KeyH', false)?.()).toBe(false);
    expect(matchShortcut('KeyX', true)).toBeNull();
  });

  it('同 id の再 bind は置換する (Editor 再 mount 対応)', () => {
    clearAllSlots();
    bindShortcut({ id: 'a', code: 'KeyH', shift: true, run: () => true });
    bindShortcut({ id: 'a', code: 'KeyH', shift: true, run: () => false });
    expect(listShortcuts()).toHaveLength(1);
    expect(matchShortcut('KeyH', true)?.()).toBe(false);
    expect(unbindShortcut('a')).toBe(true);
    expect(matchShortcut('KeyH', true)).toBeNull();
  });

  it('中核ショートカットは書式の対応表と一致する (AI 系は AI プラグイン所有)', () => {
    clearAllSlots();
    const calls: string[] = [];
    const unregister = registerCoreShortcuts({
      onFormatText: (id) => calls.push(`fmt:${id}`)
    });
    // 書式分は全件登録される
    for (const fmt of FORMAT_SHORTCUTS) {
      expect(matchShortcut(fmt.code, fmt.shift)).not.toBeNull();
    }
    // AI 系は中核に含まれない
    expect(matchShortcut('Space', false)).toBeNull();
    expect(matchShortcut('KeyS', true)).toBeNull();
    matchShortcut('KeyB', false)?.();
    expect(calls).toEqual(['fmt:bold']);
    // 解除後は引けない
    unregister();
    expect(matchShortcut('KeyB', false)).toBeNull();
  });

  it('コマンド・メニュー・設定は重複拒否、codeBlock は言語照合', () => {
    clearAllSlots();
    registerCommand({ id: 'c1', title: 'c1', run: () => true });
    expect(() => registerCommand({ id: 'c1', title: 'dup', run: () => true })).toThrow();
    addContextMenuItem({ id: 'm1', label: 'm1', onSelect: () => {} });
    expect(() => addContextMenuItem({ id: 'm1', label: 'dup', onSelect: () => {} })).toThrow();
    expect(listContextMenuItems()).toHaveLength(1);
    addSettingsSection({ id: 's1', title: 's1' });
    expect(() => addSettingsSection({ id: 's1', title: 'dup' })).toThrow();
    expect(listSettingsSections()).toHaveLength(1);
    const el = document.createElement('div');
    registerCodeBlockRenderer({ lang: 'Chart', render: () => el });
    expect(getCodeBlockRenderer('chart')).toBeDefined();
    expect(getCodeBlockRenderer('CHART')).toBeDefined();
    expect(getCodeBlockRenderer('mermaid')).toBeUndefined();
    expect(() => registerCodeBlockRenderer({ lang: 'chart', render: () => el })).toThrow();
    expect(unregisterCodeBlockRenderer('chart')).toBe(true);
    expect(getCodeBlockRenderer('chart')).toBeUndefined();
  });
});
