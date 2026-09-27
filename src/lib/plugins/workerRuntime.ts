import { ipc } from '../ipc';
import type { PluginHostApi, PluginId, PluginManifest, PluginRuntime, PluginCommand, EditProposal, PluginLogEvent } from './api';

const START_TIMEOUT_MS = 10_000;
const CALL_TIMEOUT_MS = 15 * 60_000;

const WORKER_BOOTSTRAP = `
const pending = new Map();
const handlers = new Map();
let nextRequest = 0;
function call(method, args) {
  const requestId = ++nextRequest;
  return new Promise((resolve, reject) => {
    const timeout = method === 'prompt' || method === 'showResult' ? 15 * 60_000 : 135000;
    const timer = setTimeout(() => { pending.delete(requestId); reject(new Error('ホスト応答がタイムアウトしました')); }, timeout);
    pending.set(requestId, { resolve, reject, timer });
    self.postMessage({ type: 'request', requestId, method, args });
  });
}
const api = Object.freeze({
  readDocument: () => call('readDocument', null),
  applyEdit: (proposal) => call('applyEdit', proposal),
  notify: (message) => call('notify', message),
  log: (event) => call('log', event),
  getSetting: (key) => call('getSetting', key),
  setSetting: (key, value) => call('setSetting', { key, value }),
  requestJson: (url, body, useApiKey = false, timeoutSecs = 120) => call('requestJson', { url, body, useApiKey, timeoutSecs }),
  prompt: (label, initialValue = '') => call('prompt', { label, initialValue }),
  showResult: (title, text, canReplace = false) => call('showResult', { title, text, canReplace }),
  registerCommand: async (command, handler) => {
    if (typeof handler !== 'function') throw new Error('コマンドhandlerが不正です');
    if (handlers.has(command.id)) throw new Error('コマンドIDが重複しています');
    handlers.set(command.id, handler);
    try { await call('registerCommand', command); }
    catch (error) { handlers.delete(command.id); throw error; }
    return async () => { handlers.delete(command.id); await call('unregisterCommand', command.id); };
  }
});
self.onmessage = async (event) => {
  const message = event.data;
  if (!message || typeof message !== 'object') return;
  if (message.type === 'response') {
    const request = pending.get(message.requestId);
    if (!request) return;
    pending.delete(message.requestId);
    clearTimeout(request.timer);
    if (message.ok) request.resolve(message.value);
    else request.reject(new Error(String(message.error || 'ホスト呼出しに失敗しました')));
  } else if (message.type === 'start') {
    try {
      if (!self.markinkPlugin || typeof self.markinkPlugin.activate !== 'function') {
        throw new Error('self.markinkPlugin.activate(api) がありません');
      }
      await self.markinkPlugin.activate(api);
      self.postMessage({ type: 'started' });
    } catch (error) {
      self.postMessage({ type: 'startFailed', error: String(error) });
    }
  } else if (message.type === 'invoke') {
    try {
      const handler = handlers.get(message.commandId);
      if (!handler) throw new Error('コマンドが見つかりません');
      await handler();
      self.postMessage({ type: 'invokeResult', invocationId: message.invocationId, ok: true });
    } catch (error) {
      self.postMessage({ type: 'invokeResult', invocationId: message.invocationId, ok: false, error: String(error) });
    }
  } else if (message.type === 'stop') {
    try { await self.markinkPlugin?.deactivate?.(); } finally { self.postMessage({ type: 'stopped' }); }
  }
};
`;

interface PendingInvocation {
  resolve: () => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

interface RunningWorker {
  worker: Worker;
  url: string;
  host: PluginHostApi;
  registrations: Map<string, () => void>;
  invocations: Map<number, PendingInvocation>;
  nextInvocation: number;
  stopping: boolean;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Runs a user-trusted, single-file plugin bundle in a disposable Worker. */
export class WorkerRuntime implements PluginRuntime {
  private readonly running = new Map<PluginId, RunningWorker>();

  constructor(private readonly onFailure: (id: PluginId, error: string) => void) {}

  async start(manifest: PluginManifest, host: PluginHostApi): Promise<void> {
    if (this.running.has(manifest.id)) throw new Error('プラグインは既に実行中です');
    const source = await ipc.pluginReadEntry(manifest.id);
    const url = URL.createObjectURL(new Blob([WORKER_BOOTSTRAP, '\n', source], { type: 'text/javascript' }));
    let worker: Worker;
    try {
      worker = new Worker(url, { name: `markink-plugin-${manifest.id}` });
    } catch (error) {
      URL.revokeObjectURL(url);
      throw error;
    }
    const running: RunningWorker = {
      worker, url, host, registrations: new Map(), invocations: new Map(),
      nextInvocation: 0, stopping: false
    };
    this.running.set(manifest.id, running);

    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('プラグイン起動がタイムアウトしました')), START_TIMEOUT_MS);
        worker.onmessage = (event: MessageEvent<unknown>) => {
          const message = event.data as Record<string, unknown> | null;
          if (!message || typeof message !== 'object') return;
          if (message.type === 'started') {
            clearTimeout(timer);
            resolve();
          } else if (message.type === 'startFailed') {
            clearTimeout(timer);
            reject(new Error(String(message.error)));
          } else {
            void this.handleMessage(manifest.id, running, message);
          }
        };
        worker.onerror = (event) => {
          const error = event.message || 'Workerの実行に失敗しました';
          clearTimeout(timer);
          reject(new Error(error));
          if (!running.stopping && this.running.get(manifest.id) === running) {
            this.cleanup(manifest.id, running);
            void host.dispose();
            this.onFailure(manifest.id, error);
          }
        };
        worker.postMessage({ type: 'start' });
      });
    } catch (error) {
      this.cleanup(manifest.id, running);
      throw error;
    }
  }

  async stop(id: PluginId): Promise<void> {
    const running = this.running.get(id);
    if (!running) return;
    running.stopping = true;
    try {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 1000);
        const oldHandler = running.worker.onmessage;
        running.worker.onmessage = (event) => {
          if (event.data?.type === 'stopped') {
            clearTimeout(timer);
            resolve();
          } else {
            oldHandler?.call(running.worker, event);
          }
        };
        running.worker.postMessage({ type: 'stop' });
      });
    } finally {
      this.cleanup(id, running);
    }
  }

  private cleanup(id: PluginId, running: RunningWorker): void {
    if (this.running.get(id) !== running) return;
    this.running.delete(id);
    running.worker.terminate();
    URL.revokeObjectURL(running.url);
    for (const invocation of running.invocations.values()) {
      clearTimeout(invocation.timer);
      invocation.reject(new Error('プラグインは停止しました'));
    }
    running.invocations.clear();
    running.registrations.clear();
  }

  private async handleMessage(id: PluginId, running: RunningWorker, message: Record<string, unknown>): Promise<void> {
    if (this.running.get(id) !== running) return;
    if (message.type === 'invokeResult') {
      const invocation = running.invocations.get(Number(message.invocationId));
      if (!invocation) return;
      running.invocations.delete(Number(message.invocationId));
      clearTimeout(invocation.timer);
      if (message.ok === true) invocation.resolve();
      else invocation.reject(new Error(String(message.error || 'コマンドが失敗しました')));
      return;
    }
    if (running.stopping || message.type !== 'request' || !Number.isSafeInteger(message.requestId)) return;
    const requestId = message.requestId as number;
    try {
      if (JSON.stringify(message).length > 1_200_000) throw new Error('要求が大きすぎます');
      let value: unknown;
      switch (message.method) {
        case 'readDocument': value = await running.host.readDocument(); break;
        case 'applyEdit': {
          if (!message.args || typeof message.args !== 'object') throw new Error('編集要求が不正です');
          value = await running.host.applyEdit(message.args as EditProposal);
          break;
        }
        case 'notify': {
          if (typeof message.args !== 'string') throw new Error('通知が不正です');
          value = await running.host.notify(message.args);
          break;
        }
        case 'log': {
          if (!message.args || typeof message.args !== 'object'
            || typeof (message.args as PluginLogEvent).message !== 'string') {
            throw new Error('ログイベントが不正です');
          }
          value = await running.host.log(message.args as PluginLogEvent);
          break;
        }
        case 'getSetting': {
          if (typeof message.args !== 'string') throw new Error('設定キーが不正です');
          value = await running.host.getSetting(message.args);
          break;
        }
        case 'setSetting': {
          const args = message.args as { key?: unknown; value?: unknown } | null;
          if (!args || typeof args.key !== 'string' || typeof args.value !== 'string') {
            throw new Error('設定値が不正です');
          }
          value = await running.host.setSetting(args.key, args.value);
          break;
        }
        case 'requestJson': {
          const args = message.args as { url?: unknown; body?: unknown; useApiKey?: unknown; timeoutSecs?: unknown } | null;
          if (!args || typeof args.url !== 'string' || typeof args.body !== 'string'
            || (args.useApiKey !== undefined && typeof args.useApiKey !== 'boolean')
            || (args.timeoutSecs !== undefined && typeof args.timeoutSecs !== 'number')) {
            throw new Error('HTTP要求が不正です');
          }
          value = await running.host.requestJson(args.url, args.body, args.useApiKey === true, args.timeoutSecs ?? 120);
          break;
        }
        case 'prompt': {
          const args = message.args as { label?: unknown; initialValue?: unknown } | null;
          if (!args || typeof args.label !== 'string' || typeof args.initialValue !== 'string') {
            throw new Error('入力欄の要求が不正です');
          }
          value = await running.host.prompt(args.label, args.initialValue);
          break;
        }
        case 'showResult': {
          const args = message.args as { title?: unknown; text?: unknown; canReplace?: unknown } | null;
          if (!args || typeof args.title !== 'string' || typeof args.text !== 'string'
            || typeof args.canReplace !== 'boolean') {
            throw new Error('結果表示の要求が不正です');
          }
          value = await running.host.showResult(args.title, args.text, args.canReplace);
          break;
        }
        case 'registerCommand': {
          const command = message.args as PluginCommand;
          if (!command || typeof command !== 'object' || typeof command.id !== 'string'
            || typeof command.title !== 'string') throw new Error('コマンドが不正です');
          const unregister = await running.host.registerCommand(command, () => this.invoke(running, command.id));
          running.registrations.set(command.id, unregister);
          break;
        }
        case 'unregisterCommand': {
          if (typeof message.args !== 'string') throw new Error('コマンドIDが不正です');
          const commandId = message.args;
          running.registrations.get(commandId)?.();
          running.registrations.delete(commandId);
          break;
        }
        default: throw new Error('未対応のホストAPIです');
      }
      if (this.running.get(id) === running && !running.stopping) {
        running.worker.postMessage({ type: 'response', requestId, ok: true, value });
      }
    } catch (error) {
      if (this.running.get(id) === running && !running.stopping) {
        running.worker.postMessage({ type: 'response', requestId, ok: false, error: errorText(error) });
      }
    }
  }

  private invoke(running: RunningWorker, commandId: string): Promise<void> {
    if (running.stopping) return Promise.reject(new Error('プラグインは停止中です'));
    const invocationId = ++running.nextInvocation;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        running.invocations.delete(invocationId);
        reject(new Error('プラグインコマンドがタイムアウトしました'));
      }, CALL_TIMEOUT_MS);
      running.invocations.set(invocationId, { resolve, reject, timer });
      running.worker.postMessage({ type: 'invoke', invocationId, commandId });
    });
  }
}
