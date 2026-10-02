import type {
  EditProposal,
  PluginHostApi,
  PluginId,
  PluginLogEvent,
  PluginPermission,
  PluginCommand
} from './api';
import type { NetworkResponse } from './api';
import type { DocumentFacade } from './documentFacade';

export interface PluginHostApiOptions {
  pluginId: PluginId;
  permissions: ReadonlySet<PluginPermission>;
  document: DocumentFacade;
  registerCommand: (
    pluginId: PluginId,
    command: PluginCommand,
    handler: () => void | Promise<void>
  ) => Promise<() => void>;
  registerCodeBlockRenderer: (pluginId: PluginId, language: string, html: string, clipboard: boolean, office: boolean) => () => void;
  notify: (message: string) => void | Promise<void>;
  log: (pluginId: PluginId, event: PluginLogEvent) => void | Promise<void>;
  getSetting: (pluginId: PluginId, key: string) => Promise<string | null>;
  setSetting: (pluginId: PluginId, key: string, value: string) => Promise<void>;
  requestJson: (pluginId: PluginId, url: string, body: string, useApiKey: boolean, timeoutSecs: number) => Promise<NetworkResponse>;
  prompt: (pluginId: PluginId, label: string, initialValue: string) => Promise<string | null>;
  showResult: (pluginId: PluginId, title: string, text: string, canReplace: boolean) => Promise<'insert' | 'replace' | 'cancel'>;
  openEditor: (pluginId: PluginId, title: string, html: string, onApply?: (value: string) => Promise<void>) => Promise<string | null>;
  readPackageText: (pluginId: PluginId, path: string) => Promise<string>;
  cancelDialogs?: (pluginId: PluginId) => void;
}

/** Builds the capability-limited API passed to a plugin runtime. */
export function createPluginHostApi(options: PluginHostApiOptions): PluginHostApi {
  const messageLimit = 4096;
  const permissions = new Set(options.permissions);
  const registrations = new Set<() => void | Promise<void>>();
  let disposed = false;
  const requireActive = () => {
    if (disposed) throw new Error(`プラグイン ${options.pluginId} は停止しました。`);
  };
  const requirePermission = (permission: PluginPermission) => {
    requireActive();
    if (!permissions.has(permission)) {
      throw new Error(`プラグイン ${options.pluginId} に ${permission} 権限がありません。`);
    }
  };
  return Object.freeze({
    pluginId: options.pluginId,
    readDocument: async () => {
      requirePermission('document.read');
      return options.document.read();
    },
    applyEdit: async (proposal: EditProposal) => {
      requirePermission('document.edit');
      return options.document.applyEdit(proposal, () => !disposed);
    },
    registerCommand: async (command: PluginCommand, handler: () => void | Promise<void>) => {
      requirePermission('ui.register');
      if (!/^[a-z0-9][a-z0-9._-]{0,63}$/.test(command.id)) {
        throw new Error('コマンドIDの形式が不正です。');
      }
      if (!command.title.trim() || command.title.length > 120) {
        throw new Error('コマンド名が不正です。');
      }
      if (command.placement !== 'menu') {
        throw new Error('コマンドの表示場所が不正です。');
      }
      if (command.shortcut && (command.shortcut.length > 80 || !/^Mod-(?:Shift-)?(?:Space|Key[A-Z])$/.test(command.shortcut))) {
        throw new Error('ショートカットが不正です。');
      }
      const unregister = await options.registerCommand(options.pluginId, command, handler);
      if (disposed) {
        await unregister();
        throw new Error(`プラグイン ${options.pluginId} は停止しました。`);
      }
      let active = true;
      const dispose = async () => {
        if (!active) return;
        active = false;
        registrations.delete(dispose);
        await unregister();
      };
      registrations.add(dispose);
      return dispose;
    },
    registerCodeBlockRenderer: async (language: string, html: string) => {
      requirePermission('ui.register');
      if (!/^[a-z][a-z0-9_-]{0,31}$/.test(language)) throw new Error('描画言語が不正です。');
      if (!html.trim() || new TextEncoder().encode(html).byteLength > 16 * 1024 * 1024) {
        throw new Error('描画HTMLが不正です。');
      }
      const unregister = options.registerCodeBlockRenderer(
        options.pluginId, language, html, permissions.has('clipboard.write'), permissions.has('office.copy')
      );
      if (disposed) {
        unregister();
        throw new Error(`プラグイン ${options.pluginId} は停止しました。`);
      }
      registrations.add(unregister);
      return () => {
        registrations.delete(unregister);
        unregister();
      };
    },
    notify: async (message: string) => {
      requirePermission('ui.notify');
      if (message.length > messageLimit) throw new Error('通知が長すぎます。');
      await options.notify(message);
    },
    log: async (event: PluginLogEvent) => {
      requirePermission('log.write');
      if (event.message.length > messageLimit) throw new Error('ログメッセージが長すぎます。');
      await options.log(options.pluginId, event);
    },
    getSetting: async (key: string) => {
      requirePermission('settings.read');
      return options.getSetting(options.pluginId, key);
    },
    setSetting: async (key: string, value: string) => {
      requirePermission('settings.write');
      await options.setSetting(options.pluginId, key, value);
    },
    requestJson: async (url: string, body: string, useApiKey = false, timeoutSecs = 120) => {
      requirePermission('network.request');
      if (useApiKey) requirePermission('secrets.use');
      if (url.length > 2048 || new TextEncoder().encode(body).byteLength > 512 * 1024) {
        throw new Error('HTTP要求が大きすぎます。');
      }
      if (!Number.isInteger(timeoutSecs) || timeoutSecs < 5 || timeoutSecs > 120) {
        throw new Error('HTTPタイムアウトは5〜120秒にしてください。');
      }
      return options.requestJson(options.pluginId, url, body, useApiKey, timeoutSecs);
    },
    prompt: async (label: string, initialValue = '') => {
      requirePermission('ui.dialog');
      if (!label.trim() || label.length > 200 || initialValue.length > 4096) {
        throw new Error('入力欄の内容が不正です。');
      }
      return options.prompt(options.pluginId, label, initialValue);
    },
    showResult: async (title: string, content: string, canReplace: boolean) => {
      requirePermission('ui.dialog');
      if (!title.trim() || title.length > 120 || content.length > 256 * 1024) {
        throw new Error('結果表示の内容が不正です。');
      }
      return options.showResult(options.pluginId, title, content, canReplace);
    },
    openEditor: async (title: string, html: string, onApply?: (value: string) => Promise<void>) => {
      requirePermission('ui.dialog');
      if (!title.trim() || title.length > 120 || new TextEncoder().encode(html).byteLength > 16 * 1024 * 1024) {
        throw new Error('編集画面の内容が不正です。');
      }
      return options.openEditor(options.pluginId, title, html, onApply);
    },
    readPackageText: async (path: string) => {
      requirePermission('package.read');
      if (!path || path.length > 240 || path.includes('\\') || path.startsWith('/')
        || path.split('/').some((part) => !part || part === '.' || part === '..')) {
        throw new Error('プラグイン資源のパスが不正です。');
      }
      return options.readPackageText(options.pluginId, path);
    },
    dispose: async () => {
      disposed = true;
      options.cancelDialogs?.(options.pluginId);
      const cleanup = [...registrations];
      registrations.clear();
      await Promise.allSettled(cleanup.map((unregister) => unregister()));
    }
  });
}
