import { invoke } from '@tauri-apps/api/core';

// Rust コマンド群の型付きラッパー (共通化: invoke 文字列と引数名の散在を防ぐ)

export interface SignalInfo {
  role: 'host' | 'client';
  url: string;
}

export interface AppSettings {
  restoreEnabled: boolean;
  userName: string;
  lineNumbers: boolean;
  imagePathMode: string;
  fileLoggingEnabled: boolean;
  fileLoggingLevel: 'error' | 'warn' | 'info' | 'debug';
  fontSize: number;
  fontFamily: string;
}

export interface RelayStats {
  rx: number;
  tx: number;
  subs: number;
}

export interface PluginInfo {
  id: string;
  name: string;
  version: string;
  apiVersion: number;
  description: string | null;
  author: string | null;
  permissions: string[];
  networkOrigins: string[];
  settingsFields: Array<{
    key: string;
    label: string;
    type: 'text' | 'number' | 'choice';
    defaultValue?: string;
    options?: string[];
  }>;
  entry: string | null;
  installed: boolean;
  executable: boolean;
}

/** 自動保存データ (本文 + 共同編集のルーム名 + 文書パス) */
export interface AutosaveData {
  content: string;
  room: string | null;
  path: string | null;
}

export const ipc = {
  readMarkdown: (path: string) => invoke<string>('read_markdown', { path }),
  writeMarkdown: (path: string, content: string) => invoke<void>('write_markdown', { path, content }),
  writeTextFile: (path: string, content: string) => invoke<void>('write_text_file', { path, content }),

  writeAsset: (docDir: string, fileName: string, bytes: number[]) =>
    invoke<string>('write_asset', { docDir, fileName, bytes }),

  autosave: (content: string, room: string | null, path: string | null) =>
    invoke<void>('autosave', { content, room, path }),
  readAutosave: () => invoke<AutosaveData | null>('read_autosave'),
  deleteAutosave: () => invoke<void>('delete_autosave'),

  resolveSignal: (docDir: string, room: string) =>
    invoke<SignalInfo>('collab_resolve_signal', { docDir, room }),
  probeSignal: (docDir: string) => invoke<SignalInfo | null>('collab_probe_signal', { docDir }),
  releaseSignal: () => invoke<void>('collab_release_signal'),
  relayStats: (room: string) => invoke<RelayStats | null>('collab_relay_stats', { room }),

  takeStartupFile: () => invoke<string | null>('take_startup_file'),

  getSettings: () => invoke<AppSettings>('get_settings'),
  setRestoreEnabled: (enabled: boolean) =>
    invoke<void>('set_restore_enabled', { enabled }),
  setUserName: (name: string) => invoke<void>('set_user_name', { name }),
  osUsername: () => invoke<string | null>('os_username'),
  setLineNumbers: (enabled: boolean) => invoke<void>('set_line_numbers', { enabled }),
  setImagePathMode: (mode: string) => invoke<void>('set_image_path_mode', { mode }),
  setFileLogging: (enabled: boolean, level: AppSettings['fileLoggingLevel']) =>
    invoke<void>('set_file_logging', { enabled, level }),
  writePluginLog: (pluginId: string, level: AppSettings['fileLoggingLevel'], message: string) =>
    invoke<void>('plugin_log', { pluginId, level, message }),
  readFileBytes: (path: string) => invoke<number[]>('read_file_bytes', { path }),
  pluginInstallZip: (zipPath: string, expected: PluginInfo) =>
    invoke<PluginInfo>('plugin_install_zip', {
      zipPath, expectedId: expected.id, expectedVersion: expected.version,
      expectedPermissions: expected.permissions, expectedNetworkOrigins: expected.networkOrigins,
      expectedSettingsFields: expected.settingsFields
    }),
  pluginPreviewZip: (zipPath: string) => invoke<PluginInfo>('plugin_preview_zip', { zipPath }),
  pluginList: () => invoke<PluginInfo[]>('plugin_list'),
  pluginReadEntry: (id: string) => invoke<string>('plugin_read_entry', { id }),
  pluginGetSetting: (id: string, key: string) => invoke<string | null>('plugin_get_setting', { id, key }),
  pluginSetSetting: (id: string, key: string, value: string) => invoke<void>('plugin_set_setting', { id, key, value }),
  pluginRequestJson: (id: string, requestUrl: string, body: string, useApiKey: boolean, timeoutSecs: number) =>
    invoke<{ status: number; body: string }>('plugin_request_json', { id, requestUrl, body, useApiKey, timeoutSecs }),
  pluginHasApiKey: (id: string) => invoke<boolean>('plugin_has_api_key', { id }),
  pluginSetApiKey: (id: string, value: string) => invoke<void>('plugin_set_api_key', { id, value }),
  pluginDeleteApiKey: (id: string) => invoke<void>('plugin_delete_api_key', { id }),
  pluginUninstall: (id: string) => invoke<void>('plugin_uninstall', { id }),
  setEditorFont: (font: { sizePx?: number; family?: string }) =>
    invoke<void>('set_editor_font', { font })
};
