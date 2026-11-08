import { beforeEach, describe, expect, it, vi } from 'vitest';

const bridge = vi.hoisted(() => ({ emit: vi.fn(), close: vi.fn() }));
vi.mock('@tauri-apps/api/event', () => ({
  emitTo: bridge.emit,
  listen: vi.fn().mockResolvedValue(() => {})
}));
vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({ close: bridge.close })
}));

describe('plugin editor cancellation', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    bridge.emit.mockResolvedValue(undefined);
    bridge.close.mockResolvedValue(undefined);
    history.replaceState(null, '', '/plugin-editor.html?token=editor-test');
    document.body.innerHTML = '<iframe id="plugin-editor-frame"></iframe><button id="editor-cancel">キャンセル</button>';
  });

  it('notifies the main window and closes its own window on cancel', async () => {
    await import('./plugin-editor');
    document.getElementById('editor-cancel')!.click();
    await vi.waitFor(() => expect(bridge.close).toHaveBeenCalledOnce());
    expect(bridge.emit).toHaveBeenCalledWith('main', 'plugin-editor-result', { token: 'editor-test', value: null });
  });

  it('still closes on cancel when the main window cannot receive events', async () => {
    await import('./plugin-editor');
    bridge.emit.mockRejectedValue(new Error('main window no longer exists'));
    document.getElementById('editor-cancel')!.click();
    await vi.waitFor(() => expect(bridge.close).toHaveBeenCalledOnce());
  });
});
