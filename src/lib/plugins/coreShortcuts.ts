import { FORMAT_SHORTCUTS } from '../shortcuts';
import { bindShortcut, unbindShortcut } from './slots';

export interface CoreShortcutCallbacks {
  /** 書式ショートカット (commands.ts のフォーマットID) */
  onFormatText?: (id: string) => void;
}

/**
 * 中核ショートカット (書式のみ) を共有レジストリに登録する。
 * AI 系は AI プラグインが所有する。戻り値は解除関数 (unmount 時に呼ぶ)。
 */
export function registerCoreShortcuts(callbacks: CoreShortcutCallbacks): () => void {
  const ids: string[] = [];

  for (const fmt of FORMAT_SHORTCUTS) {
    const id = `core.format.${fmt.format}`;
    bindShortcut({
      id,
      code: fmt.code,
      shift: fmt.shift,
      run: () => {
        callbacks.onFormatText?.(fmt.format);
        return true;
      }
    });
    ids.push(id);
  }

  return () => {
    for (const id of ids) unbindShortcut(id);
  };
}
