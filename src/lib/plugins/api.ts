/** Public, runtime-independent contracts for markink extensions. */

export const EXTENSION_API_VERSION = 1 as const;

export type PluginId = string;
export type PluginPermission =
  | 'document.read'
  | 'document.edit'
  | 'ui.register'
  | 'ui.notify'
  | 'ui.dialog'
  | 'log.write'
  | 'settings.read'
  | 'settings.write'
  | 'network.request'
  | 'secrets.use'
  | 'package.read'
  | 'clipboard.write'
  | 'office.copy';

export interface DocumentSnapshot {
  title: string;
  markdown: string;
  selection: { from: number; to: number } | null;
  revision: number;
  size: number;
  selectedText: string;
  textBeforeCursor: string;
  selectedImage: { src: string; alt: string; from: number; to: number } | null;
  selectedCodeBlock: { params: string; text: string; from: number; to: number } | null;
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
  shortcut?: string;
  contextMenu?: boolean;
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
  networkOrigins?: string[];
  settingsFields?: PluginSettingField[];
  fileHashes?: Record<string, string>;
}

export interface PluginSettingField {
  key: string;
  label: string;
  type: 'text' | 'number' | 'choice';
  defaultValue?: string;
  options?: string[];
}

export interface NetworkResponse {
  status: number;
  body: string;
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
  /** Renders code blocks with the given language in a sandboxed iframe. */
  registerCodeBlockRenderer(language: string, html: string): Promise<() => void>;
  notify(message: string): Promise<void>;
  log(event: PluginLogEvent): Promise<void>;
  /** Non-secret, plugin-scoped string setting. */
  getSetting(key: string): Promise<string | null>;
  setSetting(key: string, value: string): Promise<void>;
  /** Sends JSON to a manifest-approved origin. No redirects or custom headers. */
  requestJson(url: string, body: string, useApiKey?: boolean, timeoutSecs?: number): Promise<NetworkResponse>;
  prompt(label: string, initialValue?: string): Promise<string | null>;
  showResult(title: string, text: string, canReplace: boolean): Promise<'insert' | 'replace' | 'cancel'>;
  /** Reads a UTF-8 resource declared in this plugin's fileHashes. */
  readPackageText(path: string): Promise<string>;
  /** Opens plugin-provided HTML in an isolated iframe. The iframe posts a string result to its parent. */
  openEditor(title: string, html: string): Promise<string | null>;
  /** Host lifecycle hook; unregisters all UI and event registrations owned by this plugin. */
  dispose(): Promise<void>;
}

/** Runtime adapter contract. It deliberately exposes no Tauri or editor internals. */
export interface PluginRuntime {
  start(manifest: PluginManifest, host: PluginHostApi): Promise<void>;
  stop(pluginId: PluginId): Promise<void>;
}
