/** 0.2.0 プラグイン機構: 型定義 (Phase 0)。Host API は Phase 1 以降で拡張する。 */
import type { ActiveLogLevel } from '../log';

/** 本体が受け付けるプラグイン API 版。manifest の apiVersion と照合する。 */
export const PLUGIN_API_VERSION = '0.2';

/** 単一ファイル配布 (.mink.js) に埋め込む manifest */
export interface PluginManifest {
  /** 例: "builtin.hello"。英小文字・数字・._- */
  id: string;
  name: string;
  version: string;
  /** 本体との互換版。現行は "0.2" のみ */
  apiVersion: string;
  /** 将来の権限申告 (例: "ai", "settings", "ipc")。Phase 0 では記録のみ */
  permissions?: string[];
}

/** プラグインに渡す実行文脈。slot 系 API は共有レジストリに結線する。 */
export interface PluginContext {
  readonly manifest: PluginManifest;
  log(message: string, level?: ActiveLogLevel): void;
  readonly commands: {
    register(def: CommandDef): void;
  };
  readonly shortcuts: {
    bind(def: ShortcutDef): void;
  };
  readonly contextMenu: {
    add(item: ContextMenuItem): void;
  };
  readonly settings: {
    addSection(section: SettingsSection): void;
  };
  readonly codeBlocks: {
    register(renderer: CodeBlockRenderer): void;
  };
}

/** 単一プラグインの実体。activate 失敗時は loader が隔離する。 */
export interface PluginModule {
  readonly manifest: PluginManifest;
  activate(ctx: PluginContext): void | Promise<void>;
  deactivate?(): void | Promise<void>;
}

/** コマンド実行。true＝処理済み (Phase 1 では記録のみ、実行経路は Phase 2)。 */
export type CommandRun = () => boolean | void;

export interface CommandDef {
  id: string;
  title: string;
  run: CommandRun;
}

/** Ctrl/Cmd 前提のキーバインド (Editor のキー処理と対応。code は KeyboardEvent.code)。 */
export interface ShortcutDef {
  id: string;
  code: string;
  shift: boolean;
  run: () => boolean;
}

/** 右クリックメニューへの追加項目 (UI 結線は Phase 2)。 */
export interface ContextMenuItem {
  id: string;
  label: string;
  onSelect: () => void;
}

/** 設定画面への追加区分 (UI 結線は Phase 2)。 */
export interface SettingsSection {
  id: string;
  title: string;
}

/** コードブロック言語別の描画 (lang はフェンスの言語名。小文字照合)。 */
export interface CodeBlockEditContext {
  /** 内容を差し替える。成功したら true */
  apply: (newCode: string) => boolean;
}

export interface CodeBlockRenderer {
  lang: string;
  render: (code: string, lang: string, edit?: CodeBlockEditContext) => HTMLElement;
}
