import type { EditorView } from 'prosemirror-view';

/** Rust gateway から届くツール実行要求 (mcp:request イベント) */
export interface McpRequest {
  id: number;
  tool: string;
  args: Record<string, unknown>;
}

/** ツール実行に必要なエディタ側の口 (App が参照で注入する) */
export interface ToolContext {
  getView: () => EditorView | null;
  getTitle: () => string;
  getPath: () => string | null;
  isDirty: () => boolean;
  /** 文書保存 (M3)。未保存文書ではエラーを投げる */
  saveDocument: () => Promise<{ path: string }>;
  /** 全文置換の人間確認 (M3)。許可で true */
  confirmFullReplace: (summary: string) => Promise<boolean>;
  /** AI自動保存が有効か (M3) */
  aiAutoSaveEnabled: () => Promise<boolean>;
  /** 人間への通知表示 (M4) */
  notifyHuman: (message: string) => void;
}

export type ToolResult = unknown;

export type ToolHandler = (
  args: Record<string, unknown>,
  ctx: ToolContext
) => Promise<ToolResult> | ToolResult;
