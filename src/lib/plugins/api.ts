/** Public, runtime-independent contracts for markink extensions. */

export const EXTENSION_API_VERSION = 1 as const;

export type PluginId = string;
export type PluginPermission =
  | 'document.read'
  | 'document.edit'
  | 'ui.register'
  | 'ui.notify'
  | 'log.write';

export interface DocumentSnapshot {
  title: string;
  markdown: string;
  selection: { from: number; to: number } | null;
  revision: number;
}

export interface EditProposal {
  /** Absolute ProseMirror positions from a snapshot returned by document.read. */
  baseRevision: number;
  from: number;
  to: number;
  markdown: string;
  /** Optional short explanation shown by the host before applying broad edits. */
  reason?: string;
}

export interface EditResult {
  from: number;
  to: number;
  revision: number;
}

export interface PluginCommand {
  id: string;
  title: string;
  placement: 'menu';
  description?: string;
}

export interface PluginManifest {
  id: PluginId;
  name: string;
  version: string;
  apiVersion: number;
  description?: string;
  author?: string;
  entry?: string;
  permissions: PluginPermission[];
}

export interface PluginLogEvent {
  level: 'error' | 'warn' | 'info' | 'debug';
  message: string;
  fields?: Record<string, string | number | boolean>;
}

export interface PluginHostApi {
  readonly pluginId: PluginId;
  readDocument(): Promise<DocumentSnapshot>;
  applyEdit(proposal: EditProposal): Promise<EditResult>;
  registerCommand(command: PluginCommand, handler: () => void | Promise<void>): Promise<() => void>;
  notify(message: string): Promise<void>;
  log(event: PluginLogEvent): Promise<void>;
  /** Host lifecycle hook; unregisters all UI and event registrations owned by this plugin. */
  dispose(): Promise<void>;
}

/** Runtime adapter contract. It deliberately exposes no Tauri or editor internals. */
export interface PluginRuntime {
  start(manifest: PluginManifest, host: PluginHostApi): Promise<void>;
  stop(pluginId: PluginId): Promise<void>;
}
