import { EditorState } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { schema } from './schema';
import { markdownParser, markdownSerializer } from './markdown';
import { createBasePlugins } from './plugins';
import { imageNodeView } from './image';
import { codeBlockNodeView } from './codeBlockRenderers';

export { undo, redo } from 'prosemirror-history';
export { schema, markdownParser, markdownSerializer };
export { applyFormat, getFormat, FORMATS, type FormatSpec, type FormatPayload } from './commands';

export function createEditorState(initialMarkdown?: string) {
  const doc = initialMarkdown ? markdownParser.parse(initialMarkdown) : undefined;
  return EditorState.create({
    doc,
    schema,
    plugins: createBasePlugins({ historyMode: 'local' })
  });
}

export function createEditorView(
  element: HTMLElement,
  state?: EditorState,
  onUpdate?: () => void,
  getDocDir?: () => string | null
): EditorView {
  const editorState = state || createEditorState();
  const view = new EditorView(element, {
    state: editorState,
    // スペルチェックは日本語入力の速度と変換候補の挙動に影響するため無効化する
    attributes: { spellcheck: 'false' },
    // 画像は保存形式に関わらずローカル解決して描画する (相対/file/リモート対応)
    nodeViews: {
      image: imageNodeView(() => getDocDir?.() ?? null),
      code_block: codeBlockNodeView
    },
    dispatchTransaction(tr) {
      const newState = view.state.apply(tr);
      view.updateState(newState);
      if (tr.docChanged) onUpdate?.();
    }
  });
  return view;
}

