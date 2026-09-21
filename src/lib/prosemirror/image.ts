import { EditorView } from 'prosemirror-view';
import type { Node as PMNode } from 'prosemirror-model';
import { schema } from './schema';
import { invoke } from '@tauri-apps/api/core';
import { Plugin, PluginKey } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';

export function isImageFile(file: File): boolean {
  return file.type.startsWith('image/');
}

// requirements.md:57 画像は文書フォルダの assets/ に保存し相対パス参照
export async function saveImageAsset(docDir: string | null, file: File): Promise<string | null> {
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const fileName = `${Date.now()}-${file.name}`;
    const rel = await invoke<string>('write_asset', {
      docDir: docDir ?? '',
      fileName,
      bytes: Array.from(bytes)
    });
    return rel;
  } catch (e) {
    console.warn('write_asset failed', e);
    return null;
  }
}

export function insertImageAt(view: EditorView, pos: number | null, src: string): void {
  const node = schema.nodes.image.create({ src });
  const tr = view.state.tr;
  if (pos == null) {
    tr.replaceSelectionWith(node, false);
  } else {
    tr.insert(pos, node);
  }
  view.dispatch(tr);
}

/**
 * file:// URI を Windows パスに戻す。
 * - `file:///C:/a` → `C:\a` (ドライブ)
 * - `file://NAS/a`, `file:////NAS/a` → `\\NAS\a` (UNC)
 * 不正な場合は null。
 */
export function fileUriToPath(uri: string): string | null {
  try {
    const rest = decodeURI(uri.replace(/^file:\/\//i, '')).replace(/\//g, '\\');
    if (!rest) return null;
    if (rest.startsWith('\\\\')) return rest;
    if (rest.startsWith('\\')) {
      const t = rest.slice(1);
      if (/^[A-Za-z]:/.test(t)) return t;
      return '\\' + rest;
    }
    if (/^[A-Za-z]:/.test(rest)) return rest;
    return '\\\\' + rest;
  } catch {
    return null;
  }
}

/**
 * 画像 src をローカル絶対パスに解決する (プレビュー表示用。保存形式は変えない)。
 * リモート/data/blob はそのまま。file:/// はパスに戻す。相対は文書フォルダ基準。
 * 解決できない場合は null (呼び出し側でフォールバックする)。
 */
export function resolveImageAbsolute(src: string, docDir: string | null): string | null {
  const s = (src ?? '').trim();
  if (!s) return null;
  if (/^(https?:|data:|blob:|asset:)/i.test(s)) return null;
  if (/^file:\/\//i.test(s)) {
    return fileUriToPath(s);
  }
  if (!docDir) return null;
  const base = docDir.replace(/[\\/]+$/, '');
  return `${base}\\${s.replace(/\//g, '\\')}`;
}

function guessMime(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  switch (ext) {
    case 'png':
      return 'image/png';
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'gif':
      return 'image/gif';
    case 'webp':
      return 'image/webp';
    case 'bmp':
      return 'image/bmp';
    case 'svg':
      return 'image/svg+xml';
    default:
      return 'application/octet-stream';
  }
}

/**
 * 画像ノードの描画 (nodeView)。保存形式 (相対/file/リモート) に関わらず、
 * ローカル画像はバイトを読んで blob URL で表示する (Tauri WebView で確実に描画)。
 * リモート・data URL はそのまま表示する。
 */
export function imageNodeView(getDocDir: () => string | null) {
  return (node: PMNode) => {
    const img = document.createElement('img');
    if (node.attrs.alt) img.alt = String(node.attrs.alt);
    if (node.attrs.title) img.title = String(node.attrs.title);
    img.style.maxWidth = '100%';
    let url: string | null = null;
    let cancelled = false;
    let currentSrc: string = node.attrs.src ?? '';

    const release = () => {
      if (url) {
        try {
          URL.revokeObjectURL?.(url);
        } catch {
          // ignore
        }
        url = null;
      }
    };

    const load = (src: string) => {
      currentSrc = src;
      // リモート・data はそのまま
      if (/^(https?:|data:|blob:|asset:)/i.test(src.trim())) {
        release();
        img.src = src;
        return;
      }
      const abs = resolveImageAbsolute(src, getDocDir());
      if (!abs) {
        // 解決できない (未保存文書の相対参照など) は元の src のまま (従来通り)
        img.src = src;
        return;
      }
      void invoke<number[]>('read_file_bytes', { path: abs })
        .then((bytes) => {
          if (cancelled) return;
          release();
          if (typeof URL.createObjectURL !== 'function') return;
          const blob = new Blob([new Uint8Array(bytes)], { type: guessMime(abs) });
          url = URL.createObjectURL(blob);
          if (!cancelled) img.src = url;
          else release();
        })
        .catch(() => {
          // 読めない (削除・移動) は壊れたままにする
        });
    };

    load(currentSrc);

    return {
      dom: img,
      update(updated: PMNode) {
        if (updated.type.name !== 'image') return false;
        const nextSrc: string = updated.attrs.src ?? '';
        if (nextSrc !== currentSrc) load(nextSrc);
        const nextAlt = updated.attrs.alt ? String(updated.attrs.alt) : '';
        if (img.alt !== nextAlt) img.alt = nextAlt;
        return true;
      },
      destroy() {
        cancelled = true;
        release();
      }
    };
  };
}

export function handleImageDropPasteFactory(getDocDir: () => string | null) {
  return async (file: File, view: EditorView, pos: number | null): Promise<boolean> => {
    if (!isImageFile(file)) return false;
    const rel = await saveImageAsset(getDocDir(), file);
    if (!rel) {
      window.alert('画像を保存できませんでした。文書の保存先と権限を確認してください。');
      return true;
    }
    insertImageAt(view, pos, rel);
    return true;
  };
}

// 空文書の入力例表示 (requirements.md:32)
export function placeholderPlugin(hint: string): Plugin {
  return new Plugin({
    key: new PluginKey('mdn-placeholder'),
    props: {
      decorations(state) {
        const child = state.doc.firstChild;
        if (state.doc.childCount === 1 && child && child.isTextblock && child.content.size === 0) {
          const span = document.createElement('span');
          span.className = 'mdn-placeholder';
          span.textContent = hint;
          return DecorationSet.create(state.doc, [Decoration.widget(1, span, { marks: [] })]);
        }
        return null;
      }
    }
  });
}
