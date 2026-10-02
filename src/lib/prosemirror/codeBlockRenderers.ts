import type { Node as ProseMirrorNode } from 'prosemirror-model';
import { NodeSelection, TextSelection } from 'prosemirror-state';
import type { EditorView, NodeView } from 'prosemirror-view';
import { ipc } from '../ipc';

interface Renderer { pluginId: string; html: string; clipboard: boolean; office: boolean }
const renderers = new Map<string, Renderer>();
const listeners = new Set<() => void>();

export function registerCodeBlockRenderer(pluginId: string, language: string, html: string, clipboard: boolean, office: boolean): () => void {
  const key = language.toLowerCase();
  if (renderers.has(key)) throw new Error(`${language} の描画は既に登録されています。`);
  const renderer = { pluginId, html, clipboard, office };
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
  const onMessage = (event: MessageEvent) => {
    if (event.source !== frame.contentWindow) return;
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
        view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, pos)));
        if (event.data.focus !== false) view.focus();
      }
      return;
    }
    if (event.data?.type === 'markink-render-command') {
      const renderer = renderers.get(String(current.attrs.params ?? '').trim().toLowerCase());
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
    const renderer = renderers.get(String(current.attrs.params ?? '').trim().toLowerCase());
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
    const renderer = renderers.get(language);
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
      return event.target === frame || event.target === beforeZone || event.target === afterZone;
    },
    selectNode() { dom.classList.add('ProseMirror-selectednode'); },
    deselectNode() { dom.classList.remove('ProseMirror-selectednode'); },
    ignoreMutation(mutation) {
      return mutation.type !== 'selection' && !code.contains(mutation.target);
    },
    destroy() {
      listeners.delete(listener);
      window.removeEventListener('message', onMessage);
      preview.removeEventListener('click', onClick);
      beforeZone.removeEventListener('click', onBefore);
      afterZone.removeEventListener('click', onAfter);
      view.dom.removeEventListener('keydown', onKeyDown, true);
    }
  };
}
