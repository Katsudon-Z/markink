import { listen, emitTo, type UnlistenFn } from '@tauri-apps/api/event';
import { WebviewWindow } from '@tauri-apps/api/webviewWindow';

const LABEL = 'plugin-editor';

export function openPluginEditorWindow(title: string, html: string): {
  result: Promise<string | null>;
  cancel: () => void;
} {
  const token = crypto.randomUUID();
  let window: WebviewWindow | null = null;
  let finished = false;
  const unlisteners: UnlistenFn[] = [];
  let resolveResult!: (value: string | null) => void;
  let rejectResult!: (reason: unknown) => void;
  const result = new Promise<string | null>((resolve, reject) => {
    resolveResult = resolve;
    rejectResult = reject;
  });
  const track = (unlisten: UnlistenFn) => {
    if (finished) unlisten();
    else unlisteners.push(unlisten);
  };
  const finish = (value: string | null, error?: unknown) => {
    if (finished) return;
    finished = true;
    for (const unlisten of unlisteners) unlisten();
    if (window) void window.close().catch(() => {});
    if (error) rejectResult(error);
    else resolveResult(value);
  };
  void (async () => {
    track(await listen<{ token: string }>('plugin-editor-ready', (event) => {
      if (event.payload?.token !== token) return;
      void emitTo(LABEL, 'plugin-editor-content', { token, html }).catch((error) => finish(null, error));
    }));
    track(await listen<{ token: string; value: string | null }>('plugin-editor-result', (event) => {
      if (event.payload?.token !== token) return;
      const value = event.payload.value;
      if (value !== null && (typeof value !== 'string' || new TextEncoder().encode(value).byteLength > 2 * 1024 * 1024)) return;
      finish(value);
    }));
    if (finished) return;
    window = new WebviewWindow(LABEL, {
      url: `/plugin-editor.html?token=${encodeURIComponent(token)}`,
      title,
      width: 960,
      height: 720,
      minWidth: 520,
      minHeight: 360,
      resizable: true,
      center: true
    });
    track(await window.onCloseRequested(() => finish(null)));
    track(await window.once('tauri://error', (event) => finish(null, event.payload)));
  })().catch((error) => finish(null, error));
  return { result, cancel: () => finish(null) };
}
