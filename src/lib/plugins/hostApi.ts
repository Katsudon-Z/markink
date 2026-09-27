import type {
  EditProposal,
  PluginHostApi,
  PluginId,
  PluginLogEvent,
  PluginPermission,
  PluginCommand
} from './api';
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
  notify: (message: string) => void | Promise<void>;
  log: (pluginId: PluginId, event: PluginLogEvent) => void | Promise<void>;
}

/** Builds the capability-limited API passed to a plugin runtime. */
export function createPluginHostApi(options: PluginHostApiOptions): PluginHostApi {
  const messageLimit = 4096;
  const permissions = new Set(options.permissions);
  const registrations = new Set<() => void | Promise<void>>();
  const requirePermission = (permission: PluginPermission) => {
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
      return options.document.applyEdit(proposal);
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
      const unregister = await options.registerCommand(options.pluginId, command, handler);
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
    dispose: async () => {
      const cleanup = [...registrations];
      registrations.clear();
      await Promise.allSettled(cleanup.map((unregister) => unregister()));
    }
  });
}
