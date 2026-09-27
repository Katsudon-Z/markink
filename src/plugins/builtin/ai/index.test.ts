import { describe, expect, it } from 'vitest';
import { clearAllSlots, listSettingsSections, matchShortcut } from '../../../lib/plugins/slots';
import { aiBridge } from './bridge';
import { aiPlugin } from './index';
import { createPluginContext } from '../../../lib/plugins/loader';

describe('AI プラグイン (Phase 2)', () => {
  it('ショートカットを shortcut slot に登録し bridge に委譲する', async () => {
    clearAllSlots();
    aiBridge.continueDirectly = null;
    aiBridge.handleAiShortcut = null;
    await aiPlugin.activate(createPluginContext(aiPlugin.manifest));
    // bridge 未設定時は不発 (false) で落ちない
    expect(matchShortcut('Space', false)?.()).toBe(false);
    const calls: string[] = [];
    aiBridge.continueDirectly = () => {
      calls.push('continue');
      return true;
    };
    aiBridge.handleAiShortcut = (mode) => calls.push(mode);
    matchShortcut('Space', false)?.();
    matchShortcut('KeyS', true)?.();
    matchShortcut('KeyQ', true)?.();
    matchShortcut('KeyE', true)?.();
    expect(calls).toEqual(['continue', 'summary', 'question', 'edit']);
    expect(listSettingsSections().some((s) => s.id === 'ai')).toBe(true);
    aiBridge.continueDirectly = null;
    aiBridge.handleAiShortcut = null;
  });
});
