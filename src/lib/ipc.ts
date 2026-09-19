import { invoke } from '@tauri-apps/api/core';

// Rust コマンド群の型付きラッパー (共通化: invoke 文字列と引数名の散在を防ぐ)

export interface SignalInfo {
  role: 'host' | 'client';
  url: string;
}

/** AI共同編集 (MCP) の設定 (Rust Settings と同形) */
export interface McpSettings {
  mcpEnabled: boolean;
  mcpToken: string | null;
  aiAutoSave: boolean;
  /** 前回保存していない内容の復元機能を使うか (既定: 無効) */
  restoreEnabled: boolean;
  /** エディタ起点のAI呼び出しを使うか (既定: 無効) */
  aiCallEnabled: boolean;
  /** 共同編集で表示する自分の名前 (空なら自動生成) */
  userName: string;
  /** 行番号ガターを表示するか */
  lineNumbers: boolean;
  /** エディタの文字サイズ (px) */
  fontSize: number;
  /** エディタのフォントファミリ (CSS値。空なら既定) */
  fontFamily: string;
  /** AI呼び出しの提供方式: "local" | "api" */
  aiProvider: string;
  /** serve に渡すモデル (local 時) */
  aiModel: string;
  /** serve のURL (local 時・localhost のみ) */
  aiBackendUrl: string;
  /** OpenAI互換APIのエンドポイント (api 時) */
  aiApiUrl: string;
  /** APIキー (api 時) */
  aiApiKey: string;
  /** APIのモデル名 (api 時) */
  aiApiModel: string;
  aiTimeoutSecs: number;
  aiMaxChars: number;
}

/** AI共同編集 (MCP) の実行状態 */
export interface McpStatus {
  enabled: boolean;
  /** stdio ブリッジ用 WS のポート */
  port: number | null;
  /** Streamable HTTP 用のポート */
  httpPort: number | null;
  /** 接続中のAI表示名 (例: "AI: Claude Desktop") */
  connection: string | null;
}

export interface RelayStats {
  rx: number;
  tx: number;
  subs: number;
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

  mcpGetSettings: () => invoke<McpSettings>('mcp_get_settings'),
  setRestoreEnabled: (enabled: boolean) =>
    invoke<void>('set_restore_enabled', { enabled }),
  setUserName: (name: string) => invoke<void>('set_user_name', { name }),
  setLineNumbers: (enabled: boolean) => invoke<void>('set_line_numbers', { enabled }),
  setEditorFont: (font: { sizePx?: number; family?: string }) =>
    invoke<void>('set_editor_font', { font }),
  mcpAutostart: () => invoke<McpStatus>('mcp_autostart'),
  mcpSetEnabled: (enabled: boolean) => invoke<McpStatus>('mcp_set_enabled', { enabled }),
  mcpRegenerateToken: () => invoke<string>('mcp_regenerate_token'),
  mcpStatus: () => invoke<McpStatus>('mcp_status'),
  mcpDisconnectAi: () => invoke<void>('mcp_disconnect_ai'),
  mcpGetAiAutoSave: () => invoke<boolean>('mcp_get_ai_auto_save'),
  mcpSetAiAutoSave: (enabled: boolean) => invoke<void>('mcp_set_ai_auto_save', { enabled }),
  mcpExePath: () => invoke<string>('mcp_exe_path'),
  mcpResponse: (id: number, ok: boolean, data: unknown, error: string | null) =>
    invoke<void>('mcp_response', { id, ok, data, error }),
  /** 文書変更の版通知 (Rust が AI へ転送する。デバウンス済みで呼ぶ) */
  // 注意: Tauri v2 のコマンド引数は JS 側 camelCase で送る
  // (docDir/fileName と同じ約束。snake_case では missing key 扱いになる)
  mcpDocChanged: (
    version: number,
    origin: string,
    cursorFrom: number | null,
    cursorTo: number | null
  ) =>
    invoke<void>('mcp_doc_changed', {
      version,
      origin,
      cursorFrom,
      cursorTo
    }),

  // ---- エディタ起点のAI呼び出し (opencode serve) ----
  aiAutostart: () => invoke<AiServeStatus>('ai_autostart'),
  aiStatus: () => invoke<AiServeStatus>('ai_status'),
  aiSetEnabled: (enabled: boolean) => invoke<AiServeStatus>('ai_set_enabled', { enabled }),
  aiSetConfig: (config: {
    provider?: string;
    model?: string;
    backendUrl?: string;
    apiUrl?: string;
    apiKey?: string;
    apiModel?: string;
    maxChars?: number;
    timeoutSecs?: number;
    opencodeBin?: string;
  }) => invoke<AiServeStatus>('ai_set_config', { config }),
  aiAsk: (mode: AiModeId, prompt: string, context: string) =>
    invoke<AiAnswer>('ai_ask', { mode, prompt, context }),
  aiAbort: () => invoke<void>('ai_abort')
};

/** エディタ起点AI呼び出しの用途 */
export type AiModeId = 'summary' | 'continue' | 'question' | 'edit';

/** serve デーモンの状態 */
export interface AiServeStatus {
  enabled: boolean;
  running: boolean;
  url: string;
}

/** AIの応答 */
export interface AiAnswer {
  text: string;
}
