import { useCallback, useEffect, useRef, useState } from 'react';
import { EditorView } from 'prosemirror-view';
import { Editor } from './components/Editor';
import { Toolbar } from './components/Toolbar';
import { CollaborationPanel } from './components/CollaborationPanel';
import { StatusBar } from './components/StatusBar';
import { applyFormat, createEditorState } from './lib/prosemirror/editor';
import { baseName, dirName, stem as stemOfPath } from './lib/path';
import { ipc } from './lib/ipc';
import { useAutosave } from './hooks/useAutosave';
import { useCollabSession } from './hooks/useCollabSession';
import { useDocumentActions, useStartupFile } from './hooks/useDocumentActions';

function App() {
  const [showCollab, setShowCollab] = useState(false);
  const [showComments, setShowComments] = useState(false);
  const [suggestedRoom, setSuggestedRoom] = useState<string | undefined>(undefined);

  const viewRef = useRef<EditorView | null>(null);
  const dirRef = useRef<string | null>(null);
  const pathRef = useRef<string | null>(null);
  const getView = useCallback(() => viewRef.current, []);
  // React.memo を維持するため prop の同一性を保つ
  const getDocDir = useCallback(() => dirRef.current, []);

  // 共同編集セッションの参照 (自動保存でルーム名を記録するため先に用意)
  const collabRef = useRef<ReturnType<typeof useCollabSession> | null>(null);
  const suggestedRoomRef = useRef<string | null>(null);
  suggestedRoomRef.current = suggestedRoom ?? null;
  // 保存するルーム名: 進行中のセッション → 開いている文書から決まる候補
  const getRoomName = useCallback(
    () => collabRef.current?.roomName || suggestedRoomRef.current,
    []
  );
  const getDocPath = useCallback(() => pathRef.current, []);

  // 文書のフォルダでシグナリングサーバを探し、あれば自動参加・なければルーム名を提案する
  const joinOrSuggest = useCallback(
    async (path: string, dir: string, preferredRoom?: string | null) => {
      const room = preferredRoom || stemOfPath(path);
      const found = await ipc.probeSignal(dir);
      if (found) {
        setShowCollab(true);
        await collabRef.current?.ensure(room, found.url, false);
        collabRef.current?.setRoleLabel('既存ホストに参加');
      } else {
        setSuggestedRoom(room);
      }
    },
    []
  );

  const autosave = useAutosave({ getView, getRoomName, getDocPath });

  // 共同編集 (セッションのライフサイクルと診断表示)
  const collab = useCollabSession({
    getView,
    getDocDir,
    onDocumentChanged: autosave.markDirty
  });
  collabRef.current = collab;

  // 文書操作 (新規/開く/保存/HTML出力/起動引数)
  const docRef = useRef<ReturnType<typeof useDocumentActions> | null>(null);
  const doc = useDocumentActions({
    getView,
    dirRef,
    pathRef,
    onBeforeOpen: () => collabRef.current?.stop(),
    onAfterOpen: (path, dir) => joinOrSuggest(path, dir)
  });
  docRef.current = doc;

  useStartupFile((path) => {
    void docRef.current?.openByPath(path);
  });

  const handleReady = useCallback(
    (view: EditorView) => {
      viewRef.current = view;
      void autosave.loadRestoreCandidate();
    },
    [autosave]
  );

  const handleFormat = useCallback((format: string, payload?: { href?: string }) => {
    if (viewRef.current) applyFormat(viewRef.current, format, payload);
  }, []);

  const handleToggleComments = useCallback(() => setShowComments((v) => !v), []);

  // ファイル名はウィンドウ枠 (タイトルバー) に表示する
  useEffect(() => {
    let cancelled = false;
    void import('@tauri-apps/api/window').then(({ getCurrentWindow }) => {
      if (cancelled) return;
      getCurrentWindow().setTitle(`${doc.title} - MDNotepad`).catch(() => {});
    });
    return () => {
      cancelled = true;
    };
  }, [doc.title]);

  return (
    <div className="app">
      {autosave.restoreCandidate != null && (
        <div className="restore-overlay" role="dialog" aria-modal="true" aria-labelledby="restore-title">
          <div className="restore-dialog">
            <h2 id="restore-title" className="restore-title">復元のお知らせ</h2>
            <p className="restore-message">
              前回、アプリが異常終了した際に編集中の内容が自動保存されています。
              復元しますか?
            </p>
            <pre className="restore-preview">{autosave.restoreCandidate.content.slice(0, 400)}</pre>
            {autosave.restoreCandidate.room && (
              <p className="restore-message">
                共同編集のルーム「{autosave.restoreCandidate.room}」も復元します。
              </p>
            )}
            <div className="restore-actions">
              <button
                className="btn btn-primary"
                onClick={() => {
                  const data = autosave.restoreCandidate;
                  if (!data) return;
                  autosave.clearRestoreCandidate();
                  autosave.discardServerAutosave();
                  void (async () => {
                    if (data.path) {
                      // 元のファイルとして復元し、共同編集のフォルダ情報も引き継ぐ
                      doc.loadMarkdown(data.content, baseName(data.path), data.path);
                      await joinOrSuggest(data.path, dirName(data.path) ?? '', data.room);
                      return;
                    }
                    doc.loadMarkdown(data.content, '復元した文書', null);
                    if (data.room) {
                      setSuggestedRoom(data.room);
                      setShowCollab(true);
                    }
                  })();
                }}
              >
                復元する
              </button>
              <button
                className="btn"
                onClick={() => {
                  autosave.clearRestoreCandidate();
                  autosave.discardServerAutosave();
                }}
              >
                破棄する
              </button>
            </div>
          </div>
        </div>
      )}

      <header className="app-header">
        <div className="app-actions">
          <button className="btn" onClick={() => doc.newDocument(autosave.discardServerAutosave)}>
            新規作成
          </button>
          <button className="btn" onClick={() => void doc.openDialog()}>開く</button>
          <button className="btn" onClick={() => doc.saveCurrent(autosave.discardServerAutosave)}>
            保存
          </button>
          <button className="btn" onClick={() => void doc.exportHtml()}>HTML出力</button>
          <button className="btn" onClick={() => setShowCollab((v) => !v)}>共同編集</button>
        </div>
      </header>

      <Toolbar
        onFormat={handleFormat}
        showComments={showComments}
        onToggleComments={handleToggleComments}
      />

      {showCollab && (
        <CollaborationPanel
          active={collab.active}
          roomName={collab.roomName}
          suggestedRoom={suggestedRoom}
          positionLabel={collab.roleLabel ?? undefined}
          peers={collab.peers}
          diagnostics={collab.diagnostics}
          showCursors={collab.showCursors}
          onShowCursorsChange={collab.setShowCursors}
          onStart={(opts) => {
            void collab.ensure(opts.roomName, opts.signalingUrl).catch((e) => window.alert(String(e)));
          }}
          onStop={() => {
            const view = viewRef.current;
            void collab.stopAndExtractMarkdown().then((markdown) => {
              if (view && markdown != null) {
                view.updateState(createEditorState(markdown));
              }
            });
          }}
        />
      )}

      <main className="app-main">
        <Editor
          onReady={handleReady}
          onChange={autosave.markDirty}
          getDocDir={getDocDir}
          showComments={showComments}
        />
      </main>

      <StatusBar
        path={doc.path}
        collabActive={collab.active}
        peersCount={collab.peers.length}
        diagnostics={collab.diagnostics}
      />
    </div>
  );
}

export default App;
