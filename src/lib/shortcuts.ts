/**
 * 中核ショートカットの定義 (単一情報源。Editor のキー登録と設定の一覧表示で共有)。
 * AI 系は含まない (AI プラグインが所有する)。
 */

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
 * 書式設定のショートカット (単一情報源)。
 * ProseMirror の baseKeymap と衝突しない組み合わせを使う。
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
