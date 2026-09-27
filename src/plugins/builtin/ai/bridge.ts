import type { AiModeId } from '../../../lib/ipc';

/**
 * AI プラグインと React 側の橋渡し。
 * slot 登録 (起動時) とフック実体 (App マウント時) の順序が逆のため、
 * 実行関数はここに後付けする。未設定時は shortcut を不発にする。
 */
export interface AiBridge {
  continueDirectly: (() => boolean) | null;
  handleAiShortcut: ((mode: AiModeId) => void) | null;
}

export const aiBridge: AiBridge = {
  continueDirectly: null,
  handleAiShortcut: null
};
