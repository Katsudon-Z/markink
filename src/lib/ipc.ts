import { invoke } from '@tauri-apps/api/core';

// Rust コマンド群の型付きラッパー (共通化: invoke 文字列と引数名の散在を防ぐ)

export interface SignalInfo {
  role: 'host' | 'client';
  url: string;
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

  takeStartupFile: () => invoke<string | null>('take_startup_file')
};
