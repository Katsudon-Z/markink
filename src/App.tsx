import { useState, useCallback, useEffect, useRef } from 'react';
import { EditorView } from 'prosemirror-view';
import { DOMSerializer } from 'prosemirror-model';
import { open, save } from '@tauri-apps/plugin-dialog';
import { invoke } from '@tauri-apps/api/core';
import { Editor } from './components/Editor';
import { Toolbar } from './components/Toolbar';
import { CollaborationPanel } from './components/CollaborationPanel';
import { applyFormat, createEditorState, createCollabEditorState, seedFragmentFromProseMirror, fragmentToMarkdown, defaultMarkdownSerializer, schema } from './lib/prosemirror/editor';
import { startCollabSession, stopCollabSession, listPeers, stemOfPath, type CollabSession, type PeerInfo } from './lib/collaboration/session';
import './App.css';

const AUTOSAVE_DEBOUNCE_MS = 1000;

function App() {
  const [documentTitle, setDocumentTitle] = useState('無題');
  const [showCollab, setShowCollab] = useState(false);
  const [collabActive, setCollabActive] = useState(false);
  const [collabRoom, setCollabRoom] = useState('');
  const [collabRole, setCollabRole] = useState<string | null>(null);
  const [suggestedRoom, setSuggestedRoom] = useState<string | undefined>(undefined);
  const [peers, setPeers] = useState<PeerInfo[]>([]);
  const [webrtcPeerCount, setWebrtcPeerCount] = useState<number | null>(null);
  const [ydocUpdates, setYdocUpdates] = useState(0);
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);
  const [syncedFlag, setSyncedFlag] = useState<boolean | null>(null);
  const [relayStatus, setRelayStatus] = useState<string | null>(null);
  const [relaySynced, setRelaySynced] = useState<boolean | null>(null);
  const [relayStats, setRelayStats] = useState<{ rx: number; tx: number; subs: number } | null>(null);
  const connTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const updateCountRef = useRef(0);
  const lastUpdateTimeRef = useRef<string | null>(null);
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
    if (connTimer.current) {
      clearInterval(connTimer.current);
      connTimer.current = null;
    }
    setWebrtcPeerCount(null);
    setYdocUpdates(0);
    setLastSyncAt(null);
    setSyncedFlag(null);
    setRelayStatus(null);
    setRelaySynced(null);
    setRelayStats(null);
    updateCountRef.current = 0;
    lastUpdateTimeRef.current = null;
    setPeers([]);
    setCollabActive(false);
    setCollabRoom('');
    setCollabRole(null);
    void invoke('collab_release_signal').catch(() => {});
    stopCollabSession(session);
    return session;
  }, []);

  const ensureCollabSession = useCallback(async (roomName: string, signalingUrl: string | null, seedIfHost = true) => {
    const view = viewRef.current;
    if (!view || sessionRef.current) return false;
    let url = signalingUrl;
    let roleLabel: string | null = null;
    // ホストだけが現行文書を共有シードする。参加側は同期到着を待つ
    // (両方がシードすると重複マージの原因になる)
    let shouldSeed = seedIfHost;
    if (!url) {
      // C案: 保存済み文書フォルダ上でホスト発見/サーバ起動
      const info = await invoke<{ role: string; url: string }>('collab_resolve_signal', {
        docDir: currentDir ?? '',
        room: roomName
      });
      url = info.url;
      roleLabel = info.role === 'host' ? 'この端末がシグナリングサーバです (ホスト)' : '既存ホストに参加';
      if (seedIfHost) shouldSeed = info.role === 'host';
    }
    const session = startCollabSession({ roomName, signalingUrl: url as string });
    sessionRef.current = session;
    // 参加者リストの監視 (Phase 5: 参加者表示)
    const awareness = session.awareness;
    const updatePeers = () => setPeers(listPeers(awareness, session.doc.clientID));
    updatePeers();
    awareness.on('change', updatePeers);
    // 同期診断: Yjs 更新カウンタ (1秒ごとに反映)
    updateCountRef.current = 0;
    lastUpdateTimeRef.current = null;
    session.doc.on('update', () => {
      updateCountRef.current += 1;
      lastUpdateTimeRef.current = new Date().toLocaleTimeString('ja-JP');
    });
    // TCP 中継の接続状態 (P2P 不通時のフォールバック経路)
    setRelayStatus(session.relay ? '接続中' : '無効');
    setRelaySynced(session.relay ? false : null);
    try {
      session.relay?.on('status', (e: { status: string }) => {
        setRelayStatus(e.status === 'connected' ? '接続済み' : e.status === 'disconnected' ? '切断' : '接続中');
      });
      session.relay?.on('sync', (synced: boolean) => {
        setRelaySynced(synced === true);
      });
    } catch {
      /* ignore */
    }
    // P2P 接続数 + 同期状態の診断表示 (1秒ごとに更新)
    const updateConnCount = () => {
      // 中継サーバ側の転送カウンタ (ホストの場合のみ取得できる)
      void invoke<{ rx: number; tx: number; subs: number } | null>('collab_relay_stats', { room: roomName })
        .then((s) => setRelayStats(s))
        .catch(() => {});      const provider = session.provider as unknown as {
        room: { webrtcConns: Map<string, { connected: boolean }> } | null;
        synced: boolean;
      };
      const room = provider.room;
      if (!room) {
        setWebrtcPeerCount(null);
        setSyncedFlag(null);
        return;
      }
      let n = 1;
      room.webrtcConns.forEach((c) => {
        if (c.connected) n += 1;
      });
      setWebrtcPeerCount(n);
      setSyncedFlag(provider.synced === true);
      setYdocUpdates(updateCountRef.current);
      setLastSyncAt(lastUpdateTimeRef.current);
    };
    updateConnCount();
    if (connTimer.current) clearInterval(connTimer.current);
    connTimer.current = setInterval(updateConnCount, 1000);
    if (shouldSeed) {
      // ホスト(ルームの最初の参加者)が現行の内容を共有
      seedFragmentFromProseMirror(view.state.doc, session.doc, session.fragment);
    }
    view.updateState(createCollabEditorState(session, view.state.doc));
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

  const openFileByPath = useCallback(async (path: string) => {
    stopSession();
    try {
      const content = await invoke<string>('read_markdown', { path });
      loadMarkdown(content, path.split(/[\\/]/).pop() || path, path);
      // 既存シグナリングサーバがあれば共同編集を自動開始
      const found = await invoke<{ role: string; url: string } | null>('collab_probe_signal', {
        docDir: path ? path.replace(/[\\/][^\\/]*$/, '') : ''
      });
      if (found) {
        const stem = stemOfPath(path);
        setCollabRole('既存ホストに参加');
        setShowCollab(true);
        await ensureCollabSession(stem, found.url);
      } else {
        setSuggestedRoom(stemOfPath(path));
      }
    } catch (e) {
      window.alert(String(e));
    }
  }, [loadMarkdown, stopSession, ensureCollabSession]);

  const handleOpen = useCallback(async () => {
    const path = await open({ filters: [{ name: 'Markdown', extensions: ['md', 'markdown'] }] });
    if (!path) return;
    await openFileByPath(path);
  }, [openFileByPath]);

  // 起動引数の最新参照 (マウント時エフェクト用)
  const openFileByPathRef = useRef(openFileByPath);
  openFileByPathRef.current = openFileByPath;

  // .md 関連付けのダブルクリック起動・2重起動時のファイル受け渡し
  useEffect(() => {
    let alive = true;
    void invoke<string | null>('take_startup_file').then((p) => {
      if (alive && p) void openFileByPathRef.current(p).catch((e) => window.alert(String(e)));
    });
    let unlisten: Promise<() => void> | undefined;
    void import('@tauri-apps/api/event').then(({ listen }) => {
      if (!alive) return;
      unlisten = listen<string>('open-file', (e) => {
        void openFileByPathRef.current(e.payload).catch((err) => window.alert(String(err)));
      });
    });
    return () => {
      alive = false;
      unlisten?.then((f) => f());
    };
  }, []);

  const handleExportHtml = useCallback(async () => {
    const view = viewRef.current;
    if (!view) return;
    const path = await save({
      filters: [{ name: 'HTML', extensions: ['html'] }],
      defaultPath: (documentTitle.replace(/\.(md|markdown)$/i, '') || '無題') + '.html'
    });
    if (!path) return;
    try {
      const fragment = DOMSerializer.fromSchema(schema).serializeFragment(view.state.doc.content);
      const body = document.createElement('div');
      body.appendChild(fragment);
      const html =
        `<!doctype html>\n<html lang="ja">\n<head>\n<meta charset="utf-8">\n` +
        `<title>${documentTitle}</title>\n<style>` +
        `body{font-family:'Segoe UI',Meiryo,sans-serif;max-width:860px;margin:2rem auto;padding:0 1rem;line-height:1.7;}` +
        `img{max-width:100%;}pre{background:#f5f5f5;padding:1em;border-radius:6px;overflow-x:auto;}` +
        `blockquote{border-left:3px solid #ddd;margin:.5em 0;padding-left:1em;color:#555;}` +
        `table{border-collapse:collapse;}td,th{border:1px solid #ccc;padding:4px 8px;}` +
        `</style>\n</head>\n<body>\n${body.innerHTML}\n</body>\n</html>\n`;
      await invoke('write_text_file', { path, content: html });
      window.alert('HTML を書き出しました。');
    } catch (e) {
      window.alert(String(e));
    }
  }, [documentTitle]);

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
          <button className="btn" onClick={() => void handleExportHtml()}>HTML出力</button>
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
          webrtcPeerCount={webrtcPeerCount ?? undefined}
          syncLabel={collabActive ? `同期: ${(syncedFlag || relaySynced) ? '済み' : (syncedFlag == null && relaySynced == null) ? '確認中' : '未同期'} / 中継: ${relayStatus ?? '不明'}${relaySynced != null ? (relaySynced ? '(同期済み)' : '(未同期)') : ''}${relayStats ? ` / 中継転送: 受信${relayStats.rx}/送信${relayStats.tx}/接続${relayStats.subs}` : ''} / 文書更新 ${ydocUpdates}回${lastSyncAt ? ` / 最終 ${lastSyncAt}` : ''}` : undefined}
          peers={peers}
          onStart={(opts) => void handleCollabStart(opts)}
          onStop={handleCollabStop}
        />
      )}

      <main className="app-main">
        <Editor onReady={handleReady} docDir={currentDir} />
      </main>
    </div>
  );
}

export default App;
