import { useCallback, useEffect, useRef, useState } from 'react';
import { EditorView } from 'prosemirror-view';
import { Editor } from './components/Editor';
import { Toolbar } from './components/Toolbar';
import { CollaborationPanel } from './components/CollaborationPanel';
import { StatusBar } from './components/StatusBar';
import { applyFormat, createEditorState } from './lib/prosemirror/editor';
import { bumpDocVersion } from './lib/mcp/docVersion';
import { baseName, dirName, stem as stemOfPath } from './lib/path';
import { ipc } from './lib/ipc';
import { useAutosave } from './hooks/useAutosave';
import { useCollabSession } from './hooks/useCollabSession';
import { useDocumentActions, useStartupFile, UNTITLED } from './hooks/useDocumentActions';
import { useMcpBridge } from './hooks/useMcpBridge';
import { AiSettingsPanel } from './components/AiSettingsPanel';
import { SettingsPanel } from './components/SettingsPanel';

function App() {
  const [showCollab, setShowCollab] = useState(false);
  const [showComments, setShowComments] = useState(false);
  const [showAi, setShowAi] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [suggestedRoom, setSuggestedRoom] = useState<string | undefined>(undefined);
  // 前回保存していない内容の復元機能 (既定: 無効)
  const [restoreEnabled, setRestoreEnabled] = useState(false);
  const restoreEnabledRef = useRef(false);
  const getRestoreEnabled = useCallback(() => restoreEnabledRef.current, []);

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

  const autosave = useAutosave({ getView, getRoomName, getDocPath, getRestoreEnabled });

  // 復元機能の設定を読み込む。Editor の準備より遅れる場合があるため、
  // 有効だった場合はここで復元候補を読み直す (handleReady 時の読み込みは無効扱いで素通りする)
  // (autosave オブジェクトは毎レンダーで変わるため、安定な関数のみ依存する)
  const { loadRestoreCandidate, clearRestoreCandidate } = autosave;
  useEffect(() => {
    let cancelled = false;
    void ipc
      .mcpGetSettings()
      .then((s) => {
        if (cancelled) return;
        restoreEnabledRef.current = s.restoreEnabled;
        setRestoreEnabled(s.restoreEnabled);
        if (s.restoreEnabled) void loadRestoreCandidate();
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [loadRestoreCandidate]);

  // 復元機能の切り替え。無効化時は候補を破棄し、残っている自動保存データも消す
  const handleRestoreEnabledChange = useCallback(
    (enabled: boolean) => {
      void (async () => {
        await ipc.setRestoreEnabled(enabled);
        restoreEnabledRef.current = enabled;
        setRestoreEnabled(enabled);
        if (!enabled) {
          clearRestoreCandidate();
          await ipc.deleteAutosave().catch(() => {});
        } else {
          await loadRestoreCandidate();
        }
      })().catch(() => window.alert('設定の保存に失敗しました'));
    },
    [clearRestoreCandidate, loadRestoreCandidate]
  );

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

  // AI共同編集 (MCP): Rust gateway からのツール実行要求を受ける
  const getMcpTitle = useCallback(() => docRef.current?.title ?? UNTITLED, []);
  const getMcpDirty = useCallback(() => autosave.isDirty(), [autosave]);
  const getMcpAutoSave = useCallback(() => ipc.mcpGetAiAutoSave(), []);
  const saveMcpDocument = useCallback(
    () =>
      new Promise<{ path: string }>((resolve, reject) => {
        const docApi = docRef.current;
        const currentPath = pathRef.current;
        if (!docApi) {
          reject(new Error('文書操作が準備できていません'));
          return;
        }
        if (!currentPath) {
          reject(
            new Error('まだファイルに保存されていない文書です。人間が「保存」で保存してから実行してください')
          );
          return;
        }
        docApi.saveCurrent(() => resolve({ path: currentPath }));
      }),
    []
  );
  const [aiConfirm, setAiConfirm] = useState<{ summary: string; resolve: (ok: boolean) => void } | null>(
    null
  );
  const confirmMcpReplace = useCallback(
    (summary: string) =>
      new Promise<boolean>((resolve) => {
        setAiConfirm({
          summary,
          resolve: (ok) => {
            setAiConfirm(null);
            resolve(ok);
          }
        });
      }),
    []
  );
  // AIからの人間向け通知 (トースト表示・6秒で自動消去)
  const [aiNotice, setAiNotice] = useState<{ id: number; message: string } | null>(null);
  useEffect(() => {
    if (!aiNotice) return;
    const timer = setTimeout(() => setAiNotice(null), 6000);
    return () => clearTimeout(timer);
  }, [aiNotice]);
  const notifyMcpHuman = useCallback(
    (message: string) => setAiNotice({ id: Date.now(), message }),
    []
  );
  const mcp = useMcpBridge({
    getView,
    getTitle: getMcpTitle,
    getPath: getDocPath,
    isDirty: getMcpDirty,
    saveDocument: saveMcpDocument,
    confirmFullReplace: confirmMcpReplace,
    aiAutoSaveEnabled: getMcpAutoSave,
    notifyHuman: notifyMcpHuman
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

      {aiConfirm && (
        <div className="restore-overlay" role="dialog" aria-modal="true" aria-labelledby="ai-confirm-title">
          <div className="restore-dialog">
            <h2 id="ai-confirm-title" className="restore-title">AIからの置換要求</h2>
            <p className="restore-message">{aiConfirm.summary}</p>
            <div className="restore-actions">
              <button className="btn btn-primary" onClick={() => aiConfirm.resolve(true)}>
                許可する
              </button>
              <button className="btn" onClick={() => aiConfirm.resolve(false)}>
                拒否する
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
          <button className="btn" onClick={() => setShowAi((v) => !v)}>AI接続</button>
          <button className="btn" onClick={() => setShowSettings((v) => !v)}>設定</button>
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
          peers={
            mcp.aiName
              ? [...collab.peers, { clientID: -1, name: mcp.aiName, color: '#7c3aed', ai: true }]
              : collab.peers
          }
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
                // 結合結果で文書を置換するため、版を明示的に進める
                view.updateState(createEditorState(markdown));
                bumpDocVersion('human');
              }
            });
          }}
        />
      )}

      {showAi && <AiSettingsPanel onClose={() => setShowAi(false)} />}

      {showSettings && (
        <SettingsPanel
          restoreEnabled={restoreEnabled}
          onRestoreEnabledChange={handleRestoreEnabledChange}
          onClose={() => setShowSettings(false)}
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
        aiName={mcp.aiName}
      />

      {aiNotice && (
        <div className="ai-toast" role="status" key={aiNotice.id}>
          <span className="ai-toast-name">AI</span>
          <span>{aiNotice.message}</span>
        </div>
      )}
    </div>
  );
}

export default App;
