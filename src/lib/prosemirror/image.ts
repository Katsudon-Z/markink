import { EditorView } from 'prosemirror-view';
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
