import type {
  PluginHostApi,
  PluginManifest,
  PluginPermission,
  PluginLogEvent
} from './api';
import type { NetworkResponse } from './api';
import { PluginCommandRegistry } from './commands';
import { DocumentFacade } from './documentFacade';
import { createPluginHostApi } from './hostApi';

export interface ExtensionHostOptions {
  getView: ConstructorParameters<typeof DocumentFacade>[0]['getView'];
  getTitle: ConstructorParameters<typeof DocumentFacade>[0]['getTitle'];
  confirmEdit: ConstructorParameters<typeof DocumentFacade>[0]['confirmEdit'];
  notify: (pluginId: string, message: string) => void | Promise<void>;
  log: (pluginId: string, event: PluginLogEvent) => void | Promise<void>;
  getSetting: (pluginId: string, key: string) => Promise<string | null>;
  setSetting: (pluginId: string, key: string, value: string) => Promise<void>;
  requestJson: (pluginId: string, url: string, body: string, useApiKey: boolean, timeoutSecs: number) => Promise<NetworkResponse>;
  prompt: (pluginId: string, label: string, initialValue: string) => Promise<string | null>;
  showResult: (pluginId: string, title: string, text: string, canReplace: boolean) => Promise<'insert' | 'replace' | 'cancel'>;
  cancelDialogs?: (pluginId: string) => void;
}

/** Connects the stable document API and host-owned UI/platform capabilities. */
export class ExtensionHost {
  readonly commands = new PluginCommandRegistry();
  private readonly document: DocumentFacade;

  constructor(private readonly options: ExtensionHostOptions) {
    this.document = new DocumentFacade({
      getView: options.getView,
      getTitle: options.getTitle,
      confirmEdit: options.confirmEdit
    });
  }

  createApi(manifest: PluginManifest, permissions: ReadonlySet<PluginPermission>): PluginHostApi {
    return createPluginHostApi({
      pluginId: manifest.id,
      permissions,
      document: this.document,
      notify: (message) => this.options.notify(manifest.id, message),
      log: this.options.log,
      getSetting: this.options.getSetting,
      setSetting: this.options.setSetting,
      requestJson: this.options.requestJson,
      prompt: this.options.prompt,
      showResult: this.options.showResult,
      cancelDialogs: this.options.cancelDialogs,
      registerCommand: (pluginId, command, handler) =>
        Promise.resolve(this.commands.register(pluginId, command, handler))
    });
  }
}
