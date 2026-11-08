import type { Node as ProseMirrorNode } from 'prosemirror-model';
import { NodeSelection, TextSelection } from 'prosemirror-state';
import type { EditorView, NodeView } from 'prosemirror-view';
import { ipc } from '../ipc';

interface Renderer { pluginId: string; html: string; clipboard: boolean; office: boolean }
const renderers = new Map<string, Renderer[]>();
const activeRenderer = (language: string) => {
  const candidates = renderers.get(language);
  return candidates?.[candidates.length - 1];
};
const listeners = new Set<() => void>();
interface Exporter { position: () => number | undefined; request: (format: 'office-drawing' | 'png') => Promise<string> }
const exporters = new WeakMap<EditorView, Set<Exporter>>();
export function hasCodeBlockRenderer(node: ProseMirrorNode): boolean {
  return node.type.name === 'code_block' && Boolean(activeRenderer(String(node.attrs.params ?? '').trim().toLowerCase()));
}
export function exportCodeBlock(view: EditorView, pos: number, format: 'office-drawing' | 'png'): Promise<string> {
  const exporter = [...(exporters.get(view) ?? [])].find(item => item.position() === pos);
  if (!exporter) return Promise.reject(new Error('図形の描画が完了していません'));
  return exporter.request(format);
}

export function registerCodeBlockRenderer(pluginId: string, language: string, html: string, clipboard: boolean, office: boolean): () => void {
  const key = language.toLowerCase();
  const candidates = renderers.get(key) ?? [];
  if (candidates.some((item) => item.pluginId === pluginId)) throw new Error(`${language} の描画はこのプラグインで既に登録されています。`);
  const renderer = { pluginId, html, clipboard, office };
  renderers.set(key, [...candidates, renderer]);
  for (const listener of listeners) listener();
  return () => {
    const current = renderers.get(key);
    if (!current?.includes(renderer)) return;
    const remaining = current.filter((item) => item !== renderer);
    if (remaining.length) renderers.set(key, remaining);
    else renderers.delete(key);
    for (const listener of listeners) listener();
  };
}

const CSP = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' blob:; style-src 'unsafe-inline' blob:; img-src data: blob:; connect-src 'none'; form-action 'none'">`;

export function codeBlockNodeView(node: ProseMirrorNode, view: EditorView, getPos: () => number | undefined): NodeView {
  const dom = document.createElement('div');
  dom.className = 'markink-code-block';
  const pre = document.createElement('pre');
  const code = document.createElement('code');
  pre.append(code);
  dom.append(pre);
  const beforeZone = document.createElement('div');
  beforeZone.className = 'markink-code-insert-zone';
  beforeZone.contentEditable = 'false';
  beforeZone.title = 'クリックして図の前に入力';
  dom.append(beforeZone);
  const preview = document.createElement('div');
  preview.className = 'markink-code-preview';
  const frame = document.createElement('iframe');
  frame.setAttribute('sandbox', 'allow-scripts');
  frame.setAttribute('title', 'コードブロックの描画');
  frame.setAttribute('scrolling', 'no');
  preview.append(frame);
  dom.append(preview);
  const afterZone = document.createElement('div');
  afterZone.className = 'markink-code-insert-zone';
  afterZone.contentEditable = 'false';
  afterZone.title = 'クリックして図の後に入力';
  dom.append(afterZone);
  let current = node;
  let displayedHtml = '';
  let displayedSource = '';
  let sequence = 0;
  const pending = new Map<string, { resolve: (value: string) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout>; source: string; renderer: Renderer }>();
  const exporter: Exporter = { position: getPos, request(format) {
    const renderer = activeRenderer(String(current.attrs.params ?? '').trim().toLowerCase());
    if (!renderer || !(format === 'png' ? renderer.clipboard : renderer.office)) return Promise.reject(new Error('図形プラグインにこの形式の出力権限がありません'));
    const requestId = String(++sequence);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(requestId); reject(new Error('図形プラグインが出力要求に応答しません。更新したプラグインを導入してください')); }, 15000);
      pending.set(requestId, { resolve, reject, timer, source: current.textContent, renderer });
      frame.contentWindow?.postMessage({ type: 'markink-render-export', requestId, format }, '*');
    });
  } };
  const viewExporters = exporters.get(view) ?? new Set<Exporter>();
  viewExporters.add(exporter); exporters.set(view, viewExporters);
  const onMessage = (event: MessageEvent) => {
    if (event.source !== frame.contentWindow) return;
    if (event.data?.type === 'markink-render-export-result') {
      const request = pending.get(String(event.data.requestId));
      if (!request) return;
      pending.delete(String(event.data.requestId)); clearTimeout(request.timer);
      const renderer = activeRenderer(String(current.attrs.params ?? '').trim().toLowerCase());
      if (renderer !== request.renderer || current.textContent !== request.source) { request.reject(new Error('出力中に図形が変更されました')); return; }
      if (event.data.error) { request.reject(new Error(String(event.data.error))); return; }
      if (typeof event.data.value !== 'string' || new TextEncoder().encode(event.data.value).byteLength > 16 * 1024 * 1024) { request.reject(new Error('図形の出力データが不正です')); return; }
      request.resolve(event.data.value); return;
    }
    if (event.data?.type === 'markink-render-context-menu') {
      const pos = getPos();
      if (pos === undefined) return;
      const selection = view.state.selection;
      if (selection.empty || selection.from > pos + 1 || selection.to < pos + current.nodeSize - 1) view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, pos)));
      const rect = frame.getBoundingClientRect();
      const x = Number(event.data.x), y = Number(event.data.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return;
      dom.dispatchEvent(new CustomEvent('markink-copy-context-menu', { bubbles: true, detail: { x: rect.left + Math.max(0, Math.min(rect.width, x)), y: rect.top + Math.max(0, Math.min(rect.height, y)) } }));
      return;
    }
    if (event.data?.type === 'markink-render-height') {
      const height = Number(event.data.height);
      if (Number.isFinite(height)) {
        const nextHeight = `${Math.min(65536, Math.max(140, height))}px`;
        if (frame.style.height !== nextHeight) frame.style.height = nextHeight;
      }
      return;
    }
    if (event.data?.type === 'markink-render-select') {
      const pos = getPos();
      if (pos !== undefined) {
        const selection = event.data.shiftKey
          ? TextSelection.create(view.state.doc, view.state.selection.anchor, view.state.selection.anchor > pos ? pos + 1 : pos + current.nodeSize - 1)
          : NodeSelection.create(view.state.doc, pos);
        view.dispatch(view.state.tr.setSelection(selection));
        if (event.data.focus !== false) view.focus();
      }
      return;
    }
    if (event.data?.type === 'markink-render-command') {
      const renderer = activeRenderer(String(current.attrs.params ?? '').trim().toLowerCase());
      const commandId = event.data.commandId;
      const pos = getPos();
      if (!renderer || pos === undefined || typeof commandId !== 'string' || !/^[a-z][a-z0-9._-]{0,63}$/.test(commandId)) return;
      view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, pos)));
      dom.dispatchEvent(new CustomEvent('markink-render-command', {
        bubbles: true, detail: { pluginId: renderer.pluginId, commandId }
      }));
      return;
    }
    if (event.data?.type !== 'markink-render-copy') return;
    const renderer = activeRenderer(String(current.attrs.params ?? '').trim().toLowerCase());
    const data = event.data as { format?: unknown; value?: unknown };
    if (!renderer || typeof data.value !== 'string' || data.value.length > 16 * 1024 * 1024) return;
    const value = data.value;
    const sendResult = (error?: unknown) => frame.contentWindow?.postMessage({
      type: 'markink-render-copy-result',
      error: error ? String(error) : null
    }, '*');
    void (async () => {
      if (data.format === 'text' && renderer.clipboard) {
        await ipc.copyClipboardData('text', value);
      } else if (data.format === 'png' && renderer.clipboard && value.startsWith('data:image/png;base64,')) {
        await ipc.copyClipboardData('png', value.slice('data:image/png;base64,'.length));
      } else if (data.format === 'office-drawing' && renderer.office) {
        await ipc.copyOfficeDrawing(value);
      } else {
        throw new Error('この形式のコピーは許可されていません');
      }
      sendResult();
    })().catch(sendResult);
  };
  window.addEventListener('message', onMessage);
  const onClick = (event: MouseEvent) => {
    if (event.target !== preview && event.target !== frame) return;
    const pos = getPos();
    if (pos === undefined) return;
    view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, pos)));
    view.focus();
  };
  preview.addEventListener('click', onClick);
  const insertParagraph = (after: boolean) => {
    const pos = getPos();
    if (pos === undefined) return;
    const insertPos = pos + (after ? current.nodeSize : 0);
    const adjacent = after ? view.state.doc.resolve(insertPos).nodeAfter : view.state.doc.resolve(insertPos).nodeBefore;
    if (adjacent?.type === view.state.schema.nodes.paragraph) {
      const cursor = insertPos + (after ? 1 : -1);
      view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, cursor)).scrollIntoView());
      view.focus();
      return;
    }
    const paragraph = view.state.schema.nodes.paragraph.create();
    const tr = view.state.tr.insert(insertPos, paragraph);
    tr.setSelection(TextSelection.create(tr.doc, insertPos + 1));
    view.dispatch(tr.scrollIntoView());
    view.focus();
  };
  const onBefore = () => insertParagraph(false);
  const onAfter = () => insertParagraph(true);
  const onKeyDown = (event: KeyboardEvent) => {
    const pos = getPos();
    if (pos === undefined || !(view.state.selection instanceof NodeSelection)
      || view.state.selection.from !== pos || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault();
      insertParagraph(event.key === 'ArrowDown');
    }
  };
  beforeZone.addEventListener('click', onBefore);
  afterZone.addEventListener('click', onAfter);
  view.dom.addEventListener('keydown', onKeyDown, true);
  const refresh = () => {
    const language = String(current.attrs.params ?? '').trim().toLowerCase();
    const renderer = activeRenderer(language);
    const source = current.textContent;
    const active = Boolean(renderer);
    if (preview.hidden !== !active) preview.hidden = !active;
    if (pre.hidden !== active) pre.hidden = active;
    if (beforeZone.hidden !== !active) beforeZone.hidden = !active;
    if (afterZone.hidden !== !active) afterZone.hidden = !active;
    if (!renderer) {
      if (!displayedHtml) return;
      displayedHtml = '';
      displayedSource = '';
      frame.removeAttribute('srcdoc');
      return;
    }
    if (renderer.html === displayedHtml && source === displayedSource) return;
    displayedHtml = renderer.html;
    displayedSource = source;
    frame.style.height = '180px';
    const initial = JSON.stringify(source).replace(/</g, '\\u003c');
    frame.srcdoc = `${CSP}<script>window.markinkHostCopyMenu=true;window.markinkCodeBlockSource=${initial}</script>${renderer.html}`;
  };
  const listener = () => refresh();
  listeners.add(listener);
  refresh();
  return {
    dom,
    contentDOM: code,
    update(next) {
      if (next.type !== current.type) return false;
      current = next;
      refresh();
      return true;
    },
    stopEvent(event) {
      return event.target === frame || event.target === beforeZone || event.target === afterZone;
    },
    selectNode() { dom.classList.add('ProseMirror-selectednode'); },
    deselectNode() { dom.classList.remove('ProseMirror-selectednode'); },
    ignoreMutation(mutation) {
      return mutation.type !== 'selection' && !code.contains(mutation.target);
    },
    destroy() {
      viewExporters.delete(exporter);
      for (const request of pending.values()) { clearTimeout(request.timer); request.reject(new Error('図形の表示が終了しました')); }
      pending.clear();
      listeners.delete(listener);
      window.removeEventListener('message', onMessage);
      preview.removeEventListener('click', onClick);
      beforeZone.removeEventListener('click', onBefore);
      afterZone.removeEventListener('click', onAfter);
      view.dom.removeEventListener('keydown', onKeyDown, true);
    }
  };
}
