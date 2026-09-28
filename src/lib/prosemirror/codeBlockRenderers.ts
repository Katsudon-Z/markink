import type { Node as ProseMirrorNode } from 'prosemirror-model';
import { NodeSelection } from 'prosemirror-state';
import type { EditorView, NodeView } from 'prosemirror-view';

interface Renderer { pluginId: string; html: string }
const renderers = new Map<string, Renderer>();
const listeners = new Set<() => void>();

export function registerCodeBlockRenderer(pluginId: string, language: string, html: string): () => void {
  const key = language.toLowerCase();
  if (renderers.has(key)) throw new Error(`${language} の描画は既に登録されています。`);
  const renderer = { pluginId, html };
  renderers.set(key, renderer);
  for (const listener of listeners) listener();
  return () => {
    if (renderers.get(key) !== renderer) return;
    renderers.delete(key);
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
  const preview = document.createElement('div');
  preview.className = 'markink-code-preview';
  const frame = document.createElement('iframe');
  frame.setAttribute('sandbox', 'allow-scripts');
  frame.setAttribute('title', 'コードブロックの描画');
  frame.setAttribute('scrolling', 'no');
  preview.append(frame);
  dom.append(preview);
  let current = node;
  let displayedHtml = '';
  let displayedSource = '';
  const onMessage = (event: MessageEvent) => {
    if (event.source !== frame.contentWindow || event.data?.type !== 'markink-render-height') return;
    const height = Number(event.data.height);
    if (Number.isFinite(height)) {
      const nextHeight = `${Math.min(4000, Math.max(80, height))}px`;
      if (frame.style.height !== nextHeight) frame.style.height = nextHeight;
    }
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
  const refresh = () => {
    const language = String(current.attrs.params ?? '').trim().toLowerCase();
    const renderer = renderers.get(language);
    const source = current.textContent;
    const active = Boolean(renderer);
    if (preview.hidden !== !active) preview.hidden = !active;
    if (pre.hidden !== active) pre.hidden = active;
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
    frame.srcdoc = `${CSP}<script>window.markinkCodeBlockSource=${initial}</script>${renderer.html}`;
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
      return event.target === frame;
    },
    ignoreMutation(mutation) {
      return mutation.type !== 'selection' && !code.contains(mutation.target);
    },
    destroy() {
      listeners.delete(listener);
      window.removeEventListener('message', onMessage);
      preview.removeEventListener('click', onClick);
    }
  };
}
