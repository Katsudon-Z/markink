import { describe, expect, it, vi } from 'vitest';
import type { EditorView } from 'prosemirror-view';
import { DocumentFacade } from './documentFacade';
import { createPluginHostApi } from './hostApi';
import { PluginManager } from './manager';
import type { PluginHostApi, PluginManifest } from './api';

describe('plugin lifecycle', () => {
  it('refuses an edit after the plugin stops during host confirmation', async () => {
    let approve!: (value: boolean) => void;
    let active = true;
    const dispatch = vi.fn();
    const view = {
      isDestroyed: false,
      state: { doc: { content: { size: 0 } } },
      dispatch
    } as unknown as EditorView;
    const facade = new DocumentFacade({
      getView: () => view,
      getTitle: () => 'test',
      getRevision: () => 1,
      confirmEdit: () => new Promise<boolean>((resolve) => { approve = resolve; })
    });

    const edit = facade.applyEdit({ baseRevision: 1, from: 0, to: 0, markdown: 'updated' }, () => active);
    active = false;
    approve(true);

    await expect(edit).rejects.toThrow('停止');
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('unregisters a command if disposal races with registration', async () => {
    let finishRegistration!: (unregister: () => void) => void;
    const unregister = vi.fn();
    const api = createPluginHostApi({
      pluginId: 'markink.test-plugin',
      permissions: new Set(['ui.register']),
      document: {} as DocumentFacade,
      registerCommand: () => new Promise((resolve) => { finishRegistration = resolve; }),
      registerCodeBlockRenderer: () => () => {},
      notify: () => {},
      log: () => {},
      getSetting: async () => null,
      setSetting: async () => {},
      requestJson: async () => ({ status: 200, body: '' }),
      prompt: async () => null,
      showResult: async () => 'cancel',
      openEditor: async () => null,
      readPackageText: async () => ''
    });

    const registration = api.registerCommand({ id: 'hello', title: 'Hello', placement: 'menu' }, () => {});
    await api.dispose();
    finishRegistration(unregister);

    await expect(registration).rejects.toThrow('停止');
    expect(unregister).toHaveBeenCalledOnce();
  });

  it('revokes host capabilities before stopping the worker', async () => {
    const order: string[] = [];
    const manifest: PluginManifest = {
      id: 'markink.test-plugin', name: 'test', version: '1.0.0', apiVersion: 1,
      entry: 'index.js', permissions: []
    };
    const manager = new PluginManager({
      runtime: {
        start: async () => {},
        stop: async () => { order.push('stop'); }
      },
      createHostApi: () => ({
        pluginId: manifest.id,
        dispose: async () => { order.push('dispose'); }
      } as PluginHostApi)
    });

    await manager.enable(manifest, new Set());
    await manager.disable(manifest.id);

    expect(order).toEqual(['dispose', 'stop']);
    expect(manager.list()[0]?.state).toBe('disabled');
  });
});
