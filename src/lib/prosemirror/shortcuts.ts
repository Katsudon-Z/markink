export const EDITOR_SHORTCUTS = [
  { keys: 'Ctrl + Z / Ctrl + Y', label: '元に戻す / やり直し' },
  { keys: 'Enter', label: 'リストで次の項目' },
  { keys: 'Shift + Enter', label: '段落内改行' },
  { keys: 'Tab / Shift + Tab', label: '表のセル移動' },
  { keys: 'Ctrl + クリック', label: 'リンクを外部ブラウザで開く' }
];

export const FORMAT_SHORTCUTS = [
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
