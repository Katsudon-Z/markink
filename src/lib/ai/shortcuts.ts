import type { AiModeId } from '../ipc';

// AI機能のショートカットキー定義 (単一情報源。Editor のキー処理と設定の一覧表示で共有)。
// ProseMirror の baseKeymap やブラウザ既定と衝突しない Ctrl+Shift 系を使う。

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

/** エディタ組み込みのショートカット (設定の一覧表示用) */
export interface EditorShortcut {
  keys: string;
  label: string;
}

export const EDITOR_SHORTCUTS: EditorShortcut[] = [
  { keys: 'Ctrl + Z / Ctrl + Y', label: '元に戻す / やり直し' },
  { keys: 'Enter', label: 'リストで次の項目' },
  { keys: 'Shift + Enter', label: '段落内改行' },
  { keys: 'Tab / Shift + Tab', label: '表のセル移動' },
  { keys: 'Ctrl + クリック', label: 'リンクを外部ブラウザで開く' }
];

/**
 * 書式設定のショートカット (単一情報源。Editor のキー処理と設定の一覧表示で共有)。
 * ProseMirror の baseKeymap や AI ショートカットと衝突しない組み合わせを使う。
 */
export interface FormatShortcutDef {
  /** KeyboardEvent.code */
  code: string;
  shift: boolean;
  /** commands.ts のフォーマットID */
  format: string;
  /** 表示用 */
  keys: string;
  label: string;
}

export const FORMAT_SHORTCUTS: FormatShortcutDef[] = [
  { code: 'KeyB', shift: false, format: 'bold', keys: 'Ctrl + B', label: '太字' },
  { code: 'KeyI', shift: false, format: 'italic', keys: 'Ctrl + I', label: '斜体' },
  { code: 'KeyK', shift: false, format: 'link', keys: 'Ctrl + K', label: 'リンク' },
  { code: 'KeyE', shift: false, format: 'code', keys: 'Ctrl + E', label: 'コードブロック' },
  { code: 'Digit1', shift: true, format: 'h1', keys: 'Ctrl + Shift + 1', label: '見出し1' },
  { code: 'Digit2', shift: true, format: 'h2', keys: 'Ctrl + Shift + 2', label: '見出し2' },
  { code: 'Digit3', shift: true, format: 'h3', keys: 'Ctrl + Shift + 3', label: '見出し3' },
  { code: 'Digit0', shift: true, format: 'paragraph', keys: 'Ctrl + Shift + 0', label: '本文' },
  { code: 'KeyL', shift: true, format: 'list', keys: 'Ctrl + Shift + L', label: '箇条書き' },
  { code: 'KeyO', shift: true, format: 'orderedList', keys: 'Ctrl + Shift + O', label: '番号付きリスト' },
  { code: 'Period', shift: true, format: 'quote', keys: 'Ctrl + Shift + .', label: '引用' }
];
