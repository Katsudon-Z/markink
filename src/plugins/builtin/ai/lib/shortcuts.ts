import type { AiModeId } from '../../../../lib/ipc';

// AI機能のショートカットキー定義 (設定の一覧表示用)。
// 実行経路の所有者は AI プラグイン (index.ts が slot に登録する)。

export interface AiShortcut {
  mode: AiModeId;
  /** 表示用 (例: "Ctrl + Shift + S") */
  keys: string;
  label: string;
  /** プロンプト不要で即実行できるか (要約・続きのみ) */
  direct: boolean;
}

export const AI_SHORTCUTS: AiShortcut[] = [
  { mode: 'continue', keys: 'Ctrl + Space', label: 'AI続き (確認なしで挿入)', direct: true },
  { mode: 'summary', keys: 'Ctrl + Shift + S', label: 'AI要約', direct: true },
  { mode: 'question', keys: 'Ctrl + Shift + Q', label: 'AI質問 (メニューを開く)', direct: false },
  { mode: 'edit', keys: 'Ctrl + Shift + E', label: 'AI編集代行 (メニューを開く)', direct: false }
];
