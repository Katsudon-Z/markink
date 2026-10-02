import { emitTo, listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import './plugin-editor.css';

const token = new URLSearchParams(location.search).get('token');
const frame = document.getElementById('plugin-editor-frame') as HTMLIFrameElement;
const cancel = document.getElementById('editor-cancel') as HTMLButtonElement;
const csp = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' blob:; style-src 'unsafe-inline' blob:; img-src data: blob:; connect-src 'none'; form-action 'none'">`;
let submitted = false;

async function submit(value: string | null) {
  if (submitted || !token) return;
  submitted = true;
  try {
    try {
      await emitTo('main', 'plugin-editor-result', { token, value });
    } catch (error) {
      if (value !== null) throw error;
    }
    await getCurrentWindow().close();
  } catch (error) {
    submitted = false;
    console.error('編集ウィンドウを終了できません', error);
  }
}

cancel.addEventListener('click', () => { void submit(null); });
window.addEventListener('message', (event) => {
  if (event.source !== frame.contentWindow) return;
  if (!['markink-editor-result', 'markink-editor-apply'].includes(event.data?.type) || typeof event.data.value !== 'string') return;
  if (new TextEncoder().encode(event.data.value).byteLength > 2 * 1024 * 1024) return;
  if (event.data.type === 'markink-editor-apply') {
    if (token) void emitTo('main', 'plugin-editor-apply', { token, value: event.data.value }).catch((error) => {
      frame.contentWindow?.postMessage({ type: 'markink-editor-apply-result', error: String(error) }, '*');
    });
    return;
  }
  void submit(event.data.value);
});

if (token) {
  void listen<{ token: string; error: string | null }>('plugin-editor-apply-result', (event) => {
    if (event.payload?.token !== token) return;
    frame.contentWindow?.postMessage({ type: 'markink-editor-apply-result', error: event.payload.error }, '*');
  });
  void listen<{ token: string; html: string }>('plugin-editor-content', (event) => {
    if (event.payload?.token !== token || typeof event.payload.html !== 'string') return;
    frame.srcdoc = csp + event.payload.html;
  }).then(() => emitTo('main', 'plugin-editor-ready', { token }));
}
