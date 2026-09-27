import type {
  CodeBlockRenderer,
  CommandDef,
  ContextMenuItem,
  SettingsSection,
  ShortcutDef
} from './types';

/**
 * プラグイン slot の共有レジストリ群 (単一情報源)。
 * - commands/contextMenu/settings/codeBlocks: 重複登録は拒否する。
 * - shortcuts: id 上書き (upsert) を許す。Editor が mount 時に中核操作を
 *   再登録するため (StrictMode の二重 mount でも破綻しない)。
 * - 照合は登録順。先勝ち。
 */

const commands = new Map<string, CommandDef>();
const shortcuts = new Map<string, ShortcutDef>();
const contextMenuItems: ContextMenuItem[] = [];
const settingsSections: SettingsSection[] = [];
const codeBlockRenderers = new Map<string, CodeBlockRenderer>();

const normalizeLang = (lang: string): string => lang.trim().toLowerCase();

export function registerCommand(def: CommandDef): void {
  if (commands.has(def.id)) throw new Error(`重複コマンド id: ${def.id}`);
  commands.set(def.id, def);
}

export function unregisterCommand(id: string): boolean {
  return commands.delete(id);
}

export function listCommands(): CommandDef[] {
  return [...commands.values()];
}

export function bindShortcut(def: ShortcutDef): void {
  shortcuts.set(def.id, def);
}

export function unbindShortcut(id: string): boolean {
  return shortcuts.delete(id);
}

export function listShortcuts(): ShortcutDef[] {
  return [...shortcuts.values()];
}

/** Editor のキー処理用。code＋shift の完全一致で先勝ちの run を返す。 */
export function matchShortcut(code: string, shift: boolean): (() => boolean) | null {
  for (const def of shortcuts.values()) {
    if (def.code === code && def.shift === shift) return def.run;
  }
  return null;
}

export function addContextMenuItem(item: ContextMenuItem): void {
  if (contextMenuItems.some((e) => e.id === item.id)) {
    throw new Error(`重複メニュー id: ${item.id}`);
  }
  contextMenuItems.push(item);
}

export function listContextMenuItems(): ContextMenuItem[] {
  return [...contextMenuItems];
}

export function addSettingsSection(section: SettingsSection): void {
  if (settingsSections.some((e) => e.id === section.id)) {
    throw new Error(`重複設定 id: ${section.id}`);
  }
  settingsSections.push(section);
}

export function listSettingsSections(): SettingsSection[] {
  return [...settingsSections];
}

export function registerCodeBlockRenderer(renderer: CodeBlockRenderer): void {
  const key = normalizeLang(renderer.lang);
  if (codeBlockRenderers.has(key)) throw new Error(`重複コードブロック言語: ${renderer.lang}`);
  codeBlockRenderers.set(key, renderer);
}

export function unregisterCodeBlockRenderer(lang: string): boolean {
  return codeBlockRenderers.delete(normalizeLang(lang));
}

export function getCodeBlockRenderer(lang: string): CodeBlockRenderer | undefined {
  return codeBlockRenderers.get(normalizeLang(lang));
}

/** テスト用に全 slot を空に戻す。本体からは呼ばない。 */
export function clearAllSlots(): void {
  commands.clear();
  shortcuts.clear();
  contextMenuItems.length = 0;
  settingsSections.length = 0;
  codeBlockRenderers.clear();
}
