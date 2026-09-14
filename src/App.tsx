import { useState, useCallback, useRef } from 'react';
import { EditorView } from 'prosemirror-view';
import { open, save } from '@tauri-apps/plugin-dialog';
import { invoke } from '@tauri-apps/api/core';
import { Editor } from './components/Editor';
import { Toolbar } from './components/Toolbar';
import { CollaborationPanel } from './components/CollaborationPanel';
import { applyFormat, createEditorState, createCollabEditorState, seedFragmentFromProseMirror, fragmentToMarkdown, defaultMarkdownSerializer } from './lib/prosemirror/editor';
import { startCollabSession, stopCollabSession, type CollabSession } from './lib/collaboration/session';
import './App.css';

const AUTOSAVE_DEBOUNCE_MS = 1000;

function App() {
  const [documentTitle, setDocumentTitle] = useState('無題');
  const [showCollab, setShowCollab] = useState(false);
  const [collabActive, setCollabActive] = useState(false);
  const [collabRoom, setCollabRoom] = useState('');
  const [collabRole, setCollabRole] = useState<string | null>(null);
  const [suggestedRoom, setSuggestedRoom] = useState<string | undefined>(undefined);
  const [currentPath, setCurrentPath] = useState<string | null>(null);
  const [currentDir, setCurrentDir] = useState<string | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const sessionRef = useRef<CollabSession | null>(null);
  const autosaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [restoreCandidate, setRestoreCandidate] = useState<string | null>(null);

  const serialize = useCallback(() => {
    const view = viewRef.current;
    if (!view) return null;
    return defaultMarkdownSerializer.serialize(view.state.doc);
  }, []);

  const scheduleAutosave = useCallback(() => {
    if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    autosaveTimer.current = setTimeout(() => {
      const content = serialize();
      if (content != null) void invoke('autosave', { content }).catch(() => {});
    }, AUTOSAVE_DEBOUNCE_MS);
  }, [serialize]);

  const loadMarkdown = useCallback((content: string, title: string, path: string | null) => {
    const view = viewRef.current;
    if (!view) return;
    view.updateState(createEditorState(content));
    setCurrentPath(path);
    setCurrentDir(path ? path.replace(/[\\/][^\\/]*$/, '') : null);
    setDocumentTitle(title);
  }, []);

  const handleReady = useCallback((view: EditorView) => {
    viewRef.current = view;

    // 編集ごとに自動保存 (requirements.md:48)
    view.dom.addEventListener('input', scheduleAutosave);

    // 起動時: 前回異常終了時の自動保存データの復元を提案 (requirements.md:48)
    void (async () => {
      try {
        const saved = await invoke<string | null>('read_autosave');
        if (saved) setRestoreCandidate(saved);
      } catch {
        window.alert('復元データの確認でエラーが発生しました。続行できますが、前回の内容は利用できません。');
      }
    })();
  }, [scheduleAutosave]);

  const stopSession = useCallback(() => {
    const session = sessionRef.current;
    if (!session) return null;
    sessionRef.current = null;
    setCollabActive(false);
    setCollabRoom('');
    setCollabRole(null);
    void invoke('collab_release_signal').catch(() => {});
    stopCollabSession(session);
    return session;
  }, []);

  const ensureCollabSession = useCallback(async (roomName: string, signalingUrl: string | null) => {
    const view = viewRef.current;
    if (!view || sessionRef.current) return false;
    let url = signalingUrl;
    let roleLabel: string | null = null;
    if (!url) {
      // C案: 保存済み文書フォルダ上でホスト発見/サーバ起動
      const info = await invoke<{ role: string; url: string }>('collab_resolve_signal', {
        docDir: currentDir ?? '',
        room: roomName
      });
      url = info.url;
      roleLabel = info.role === 'host' ? 'この端末がシグナリングサーバです (ホスト)' : '既存ホストに参加';
    }
    const session = startCollabSession({ roomName, signalingUrl: url as string });
    sessionRef.current = session;
    // ルームの最初の参加者なら現行の内容を共有
    seedFragmentFromProseMirror(view.state.doc, session.doc, session.fragment);
    view.updateState(createCollabEditorState(session));
    setCollabActive(true);
    setCollabRoom(roomName);
    setCollabRole(roleLabel);
    return true;
  }, [currentDir]);

  const handleCollabStart = useCallback(({ roomName, signalingUrl }: { roomName: string; signalingUrl: string | null }) => {
    void ensureCollabSession(roomName, signalingUrl).catch((e) => window.alert(String(e)));
  }, [ensureCollabSession]);

  const handleCollabStop = useCallback(() => {
    const view = viewRef.current;
    const session = sessionRef.current;
    if (!view || !session) return;
    // Yjs 上の内容を Markdown 化して通常編集モードへ戻す
    const content = fragmentToMarkdown(session.fragment);
    stopSession();
    view.updateState(createEditorState(content));
  }, [stopSession]);

  const handleRestore = useCallback(() => {
    const content = restoreCandidate;
    if (content != null) loadMarkdown(content, '復元した文書', null);
    setRestoreCandidate(null);
    void invoke('delete_autosave').catch(() => {});
  }, [restoreCandidate, loadMarkdown]);

  const handleDiscardAutosave = useCallback(() => {
    setRestoreCandidate(null);
    void invoke('delete_autosave').catch(() => {});
  }, []);

  const handleFormat = useCallback((format: string) => {
    if (viewRef.current) applyFormat(viewRef.current, format);
  }, []);

  const handleNew = useCallback(() => {
    stopSession();
    loadMarkdown('', '無題', null);
    void invoke('delete_autosave').catch(() => {});
  }, [loadMarkdown, stopSession]);

  const handleOpen = useCallback(async () => {
    stopSession();
    const path = await open({ filters: [{ name: 'Markdown', extensions: ['md', 'markdown'] }] });
    if (!path) return;
    try {
      const content = await invoke<string>('read_markdown', { path });
      loadMarkdown(content, path.split(/[\\/]/).pop() || path, path);
      // 既存シグナリングサーバがあれば共同編集を自動開始
      const found = await invoke<{ role: string; url: string } | null>('collab_probe_signal', {
        docDir: path ? path.replace(/[\\/][^\\/]*$/, '') : ''
      });
      if (found) {
        const stem = (path.split(/[\\/]/).pop() || '文書').replace(/\.(md|markdown)$/i, '');
        setCollabRole('既存ホストに参加');
        setShowCollab(true);
        await ensureCollabSession(stem, found.url);
      } else {
        setSuggestedRoom((path.split(/[\\/]/).pop() || '文書').replace(/\.(md|markdown)$/i, ''));
      }
    } catch (e) {
      window.alert(String(e));
    }
  }, [loadMarkdown, stopSession]);

  const saveAs = useCallback(async () => {
    const view = viewRef.current;
    if (!view) return;
    const path = await save({
      filters: [{ name: 'Markdown', extensions: ['md'] }],
      defaultPath: currentPath?.split(/[\\/]/).pop() || '無題.md'
    });
    if (!path) return;
    try {
      const content = serialize();
      if (content == null) return;
      await invoke('write_markdown', { path, content });
      await invoke('delete_autosave').catch(() => {});
      loadMarkdown(content, path.split(/[\\/]/).pop() || path, path);
    } catch (e) {
      window.alert(String(e));
    }
  }, [currentPath, serialize, loadMarkdown]);

  const handleSave = useCallback(() => {
    if (currentPath) {
      const content = serialize();
      if (content == null) return;
      invoke('write_markdown', { path: currentPath, content })
        .then(() => invoke('delete_autosave'))
        .catch((e) => window.alert(String(e)));
    } else {
      void saveAs();
    }
  }, [currentPath, serialize, saveAs]);

  return (
    <div className="app">
      {restoreCandidate != null && (
        <div className="restore-overlay" role="dialog" aria-modal="true" aria-labelledby="restore-title">
          <div className="restore-dialog">
            <h2 id="restore-title" className="restore-title">復元のお知らせ</h2>
            <p className="restore-message">
              前回、アプリが異常終了した際に編集中の内容が自動保存されています。
              復元しますか?
            </p>
            <pre className="restore-preview">{restoreCandidate.slice(0, 400)}</pre>
            <div className="restore-actions">
              <button className="btn btn-primary" onClick={handleRestore}>復元する</button>
              <button className="btn" onClick={handleDiscardAutosave}>破棄する</button>
            </div>
          </div>
        </div>
      )}
      <header className="app-header">
        <h1 className="app-title">{documentTitle}</h1>
        <div className="app-actions">
          <button className="btn" onClick={handleNew}>新規作成</button>
          <button className="btn" onClick={() => void handleOpen()}>開く</button>
          <button className="btn" onClick={handleSave}>保存</button>
          <button className="btn" onClick={() => setShowCollab((v) => !v)}>共同編集</button>
        </div>
      </header>

      <Toolbar onFormat={handleFormat} />

      {showCollab && (
        <CollaborationPanel
          active={collabActive}
          roomName={collabRoom}
          suggestedRoom={suggestedRoom}
          positionLabel={collabRole ?? undefined}
          onStart={(opts) => void handleCollabStart(opts)}
          onStop={handleCollabStop}
        />
      )}

      <main className="app-main">
        <Editor onReady={handleReady} />
      </main>
    </div>
  );
}

export default App;
