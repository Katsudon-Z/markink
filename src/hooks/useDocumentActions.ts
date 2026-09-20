import { useCallback, useEffect, useRef, useState } from 'react';
import { EditorView } from 'prosemirror-view';
import { open, save } from '@tauri-apps/plugin-dialog';
import { createEditorState } from '../lib/prosemirror/editor';
import { bumpDocVersion } from '../lib/mcp/docVersion';
import { documentToHtml } from '../lib/markdown/htmlExport';
import { ipc } from '../lib/ipc';
import { baseName, dirName, stem } from '../lib/path';
import { serializeView } from './useAutosave';

export const UNTITLED = '無題';

interface UseDocumentActionsOptions {
  getView: () => EditorView | null;
  /** 現在のフォルダ (同期参照・画像保存やシグナリング検出に使用) */
  dirRef: React.MutableRefObject<string | null>;
  /** 現在のファイルパス (同期参照) */
  pathRef: React.MutableRefObject<string | null>;
  /** ファイル切替の直前に呼ぶ (共同編集の終了など) */
  onBeforeOpen: () => void;
  /** ファイル読込後に呼ぶ (シグナリングサーバ検出と自動参加など) */
  onAfterOpen: (path: string, dir: string) => Promise<void>;
}

export function useDocumentActions({
  getView,
  dirRef,
  pathRef,
  onBeforeOpen,
  onAfterOpen
}: UseDocumentActionsOptions) {
  const [title, setTitle] = useState(UNTITLED);
  const [path, setPath] = useState<string | null>(null);

  const adopt = useCallback(
    (nextPath: string | null, nextTitle: string, dir: string | null) => {
      pathRef.current = nextPath;
      dirRef.current = dir;
      setPath(nextPath);
      setTitle(nextTitle);
    },
    [dirRef, pathRef]
  );

  /** Markdown を読み込んでエディタに反映する */
  const loadMarkdown = useCallback(
    (content: string, nextTitle: string, nextPath: string | null) => {
      const view = getView();
      if (!view) return;
      // 先にフォルダを確定させる (画像 nodeView が解決時に最新の dir を読むため)。
      // updateState は dispatch を経由しないため、版を明示的に進める
      adopt(nextPath, nextTitle, dirName(nextPath));
      view.updateState(createEditorState(content));
      bumpDocVersion('human');
    },
    [getView, adopt]
  );

  const newDocument = useCallback(
    (afterDiscard: () => void) => {
      onBeforeOpen();
      loadMarkdown('', UNTITLED, null);
      afterDiscard();
    },
    [onBeforeOpen, loadMarkdown]
  );

  /** パス指定で開く (.md 関連付け・二重起動の受け渡しでも使用) */
  const openByPath = useCallback(
    async (filePath: string) => {
      onBeforeOpen();
      try {
        const content = await ipc.readMarkdown(filePath);
        loadMarkdown(content, baseName(filePath), filePath);
        await onAfterOpen(filePath, dirName(filePath) ?? '');
      } catch (e) {
        window.alert(String(e));
      }
    },
    [onBeforeOpen, loadMarkdown, onAfterOpen]
  );

  const openDialog = useCallback(async () => {
    const selected = await open({
      filters: [{ name: 'Markdown', extensions: ['md', 'markdown'] }]
    });
    if (!selected) return;
    await openByPath(selected);
  }, [openByPath]);

  const saveAs = useCallback(
    async (afterSave: () => void) => {
      const view = getView();
      if (!view) return;
      const selected = await save({
        filters: [{ name: 'Markdown', extensions: ['md'] }],
        defaultPath: pathRef.current ? baseName(pathRef.current) : `${UNTITLED}.md`
      });
      if (!selected) return;
      try {
        const content = serializeView(view);
        if (content == null) return;
        await ipc.writeMarkdown(selected, content);
        adopt(selected, baseName(selected), dirName(selected));
        afterSave();
      } catch (e) {
        window.alert(String(e));
      }
    },
    [getView, adopt]
  );

  const saveCurrent = useCallback(
    (afterSave: () => void) => {
      const currentPath = pathRef.current;
      if (!currentPath) {
        void saveAs(afterSave);
        return;
      }
      const content = serializeView(getView());
      if (content == null) return;
      ipc
        .writeMarkdown(currentPath, content)
        .then(() => afterSave())
        .catch((e) => window.alert(String(e)));
    },
    [getView, saveAs]
  );

  const exportHtml = useCallback(async () => {
    const view = getView();
    if (!view) return;
    const selected = await save({
      filters: [{ name: 'HTML', extensions: ['html'] }],
      defaultPath: `${stem(title) || UNTITLED}.html`
    });
    if (!selected) return;
    try {
      await ipc.writeTextFile(selected, documentToHtml(view.state.doc, title));
      window.alert('HTML を書き出しました。');
    } catch (e) {
      window.alert(String(e));
    }
  }, [getView, title]);

  return {
    title,
    path,
    loadMarkdown,
    newDocument,
    openByPath,
    openDialog,
    saveCurrent,
    saveAs,
    exportHtml
  };
}

/** .md ダブルクリック起動時のファイル受け渡し (各プロセスが自分の引数を開く) */
export function useStartupFile(onOpen: (path: string) => void) {
  const onOpenRef = useRef(onOpen);
  onOpenRef.current = onOpen;

  useEffect(() => {
    let alive = true;

    void (async () => {
      const startup = await ipc.takeStartupFile().catch(() => null);
      if (!alive) return;
      if (startup) onOpenRef.current(startup);
    })();

    return () => {
      alive = false;
    };
  }, []);
}
