import { useCallback, useEffect, useRef, useState } from 'react';
import { EditorView } from 'prosemirror-view';
import type { CollabSession, PeerInfo } from '../lib/collaboration/session';
import { loadCollabModules, type CollabModules } from '../lib/collaboration/load';
import { clearRemoteHighlights } from '../lib/collaboration/remoteHighlight';
import { ipc, type RelayStats } from '../lib/ipc';
import { attachAwareness, refreshAiCursor } from '../lib/mcp/presence';

const DIAGNOSTICS_INTERVAL_MS = 2000;

export interface CollabDiagnostics {
  webrtcPeerCount: number | null;
  syncedFlag: boolean | null;
  ydocUpdates: number;
  lastSyncAt: string | null;
  relayStatus: string | null;
  relaySynced: boolean | null;
  relayStats: RelayStats | null;
}

const EMPTY_DIAGNOSTICS: CollabDiagnostics = {
  webrtcPeerCount: null,
  syncedFlag: null,
  ydocUpdates: 0,
  lastSyncAt: null,
  relayStatus: null,
  relaySynced: null,
  relayStats: null
};

function sameDiagnostics(a: CollabDiagnostics, b: CollabDiagnostics): boolean {
  return (
    a.webrtcPeerCount === b.webrtcPeerCount &&
    a.syncedFlag === b.syncedFlag &&
    a.ydocUpdates === b.ydocUpdates &&
    a.lastSyncAt === b.lastSyncAt &&
    a.relayStatus === b.relayStatus &&
    a.relaySynced === b.relaySynced &&
    a.relayStats?.rx === b.relayStats?.rx &&
    a.relayStats?.tx === b.relayStats?.tx &&
    a.relayStats?.subs === b.relayStats?.subs
  );
}

export function formatSyncLabel(diag: CollabDiagnostics): string {
  const synced = diag.syncedFlag || diag.relaySynced;
  const syncText =
    synced ? '済み' : diag.syncedFlag == null && diag.relaySynced == null ? '確認中' : '未同期';
  const relayText = diag.relayStatus ?? '不明';
  const relaySyncedText =
    diag.relaySynced == null ? '' : diag.relaySynced ? '(同期済み)' : '(未同期)';
  const statsText = diag.relayStats
    ? ` / 中継転送: 受信${diag.relayStats.rx}/送信${diag.relayStats.tx}/接続${diag.relayStats.subs}`
    : '';
  const lastText = diag.lastSyncAt ? ` / 最終 ${diag.lastSyncAt}` : '';
  return `同期: ${syncText} / 中継: ${relayText}${relaySyncedText}${statsText} / 文書更新 ${diag.ydocUpdates}回${lastText}`;
}

interface UseCollabSessionOptions {
  getView: () => EditorView | null;
  getDocDir: () => string | null;
  /** 共同編集で表示する自分の名前 (設定値。空なら自動生成) */
  getUserName?: () => string;
  /** Yjs 文書が変化したとき (自動保存の契機) */
  onDocumentChanged?: () => void;
}

export function useCollabSession({
  getView,
  getDocDir,
  getUserName,
  onDocumentChanged
}: UseCollabSessionOptions) {
  const [active, setActive] = useState(false);
  const [roomName, setRoomName] = useState('');
  const [roleLabel, setRoleLabel] = useState<string | null>(null);
  const [peers, setPeers] = useState<PeerInfo[]>([]);
  const [diagnostics, setDiagnostics] = useState<CollabDiagnostics>(EMPTY_DIAGNOSTICS);
  const [showCursors, setShowCursorsState] = useState(true);

  const sessionRef = useRef<CollabSession | null>(null);
  // 共同編集ライブラリは初回のセッション開始時に読み込む
  const modulesRef = useRef<CollabModules | null>(null);
  const updateCountRef = useRef(0);
  const lastUpdateTimeRef = useRef<string | null>(null);
  const relayStatusRef = useRef<string | null>(null);
  const relaySyncedRef = useRef<boolean | null>(null);
  const relayStatsRef = useRef<RelayStats | null>(null);

  const onDocumentChangedRef = useRef(onDocumentChanged);
  onDocumentChangedRef.current = onDocumentChanged;
  const getUserNameRef = useRef(getUserName);
  getUserNameRef.current = getUserName;
  const showCursorsRef = useRef(showCursors);
  showCursorsRef.current = showCursors;

  /** 相手カーソル表示の切替 (エディタ状態を再構築。Yjs 文書は保持される) */
  const setShowCursors = useCallback(
    (next: boolean) => {
      setShowCursorsState(next);
      showCursorsRef.current = next;
      const session = sessionRef.current;
      const view = getView();
      const collab = modulesRef.current?.collab;
      if (session && view && collab) {
        view.updateState(collab.createCollabEditorState(session, view.state.doc, { showCursors: next }));
      }
    },
    [getView]
  );

  const stop = useCallback(() => {
    const session = sessionRef.current;
    if (!session) return null;
    sessionRef.current = null;
    // AIプレゼンスの Awareness 連携を外す (ローカル装飾は維持)
    attachAwareness(null);
    clearRemoteHighlights();
    void ipc.releaseSignal().catch(() => {});
    modulesRef.current?.session.stopCollabSession(session);
    updateCountRef.current = 0;
    lastUpdateTimeRef.current = null;
    relayStatusRef.current = null;
    relaySyncedRef.current = null;
    relayStatsRef.current = null;
    setActive(false);
    setRoomName('');
    setRoleLabel(null);
    setPeers([]);
    setDiagnostics(EMPTY_DIAGNOSTICS);
    return session;
  }, []);

  /** セッションを開始する。signalingUrl が null なら C案のホスト自動検出を行う */
  const ensure = useCallback(
    async (room: string, signalingUrl: string | null, seedIfHost = true): Promise<boolean> => {
      const view = getView();
      if (!view || sessionRef.current) return false;

      const modules = modulesRef.current ?? (modulesRef.current = await loadCollabModules());

      let url = signalingUrl;
      let label: string | null = null;
      let shouldSeed = seedIfHost;
      if (!url) {
        const info = await ipc.resolveSignal(getDocDir() ?? '', room);
        url = info.url;
        label = info.role === 'host' ? 'この端末がシグナリングサーバです (ホスト)' : '既存ホストに参加';
        if (seedIfHost) shouldSeed = info.role === 'host';
      }

      const session = modules.session.startCollabSession({
        roomName: room,
        signalingUrl: url,
        userName: getUserNameRef.current?.() || undefined
      });
      sessionRef.current = session;
      // AIプレゼンスを Awareness に接続 (人間の user フィールドは触らない)
      attachAwareness(session.awareness);

      const updatePeers = () => {
        setPeers(modules.session.listPeers(session.awareness, session.doc.clientID));
        // リモート AI カーソルの再描画 (Awareness 変化時)
        const view = getView();
        if (view) refreshAiCursor(view);
      };
      updatePeers();
      session.awareness.on('change', updatePeers);

      updateCountRef.current = 0;
      lastUpdateTimeRef.current = null;
      session.doc.on('update', () => {
        updateCountRef.current += 1;
        lastUpdateTimeRef.current = new Date().toLocaleTimeString('ja-JP');
        onDocumentChangedRef.current?.();
      });

      relayStatusRef.current = session.relay ? '接続中' : '無効';
      relaySyncedRef.current = session.relay ? false : null;
      try {
        session.relay?.on('status', (e: { status: string }) => {
          relayStatusRef.current =
            e.status === 'connected' ? '接続済み' : e.status === 'disconnected' ? '切断' : '接続中';
        });
        session.relay?.on('sync', (synced: boolean) => {
          relaySyncedRef.current = synced === true;
        });
      } catch {
        /* ignore */
      }

      if (shouldSeed) {
        // ホスト(ルームの最初の参加者)が現行の内容を共有
        modules.collab.seedFragmentFromProseMirror(view.state.doc, session.doc, session.fragment);
      }
      view.updateState(
        modules.collab.createCollabEditorState(session, view.state.doc, {
          showCursors: showCursorsRef.current
        })
      );

      setActive(true);
      setRoomName(room);
      setRoleLabel(label);
      return true;
    },
    [getView, getDocDir]
  );

  // 診断ポーリング (セッション中のみ・2秒間隔・変化時のみ再描画)
  // ステータスバーで常時表示するため、パネルの開閉には依存しない
  useEffect(() => {
    if (!active) return;
    let cancelled = false;

    const collect = () => {
      const session = sessionRef.current;
      if (!session) return;
      const provider = session.provider as unknown as {
        room: { webrtcConns: Map<string, { connected: boolean }> } | null;
        synced: boolean;
      };
      let peerCount: number | null = null;
      let syncedFlag: boolean | null = null;
      if (provider.room) {
        let n = 1;
        provider.room.webrtcConns.forEach((c) => {
          if (c.connected) n += 1;
        });
        peerCount = n;
        syncedFlag = provider.synced === true;
      }
      void ipc
        .relayStats(session.roomName)
        .then((s) => {
          relayStatsRef.current = s;
        })
        .catch(() => {});
      const next: CollabDiagnostics = {
        webrtcPeerCount: peerCount,
        syncedFlag,
        ydocUpdates: updateCountRef.current,
        lastSyncAt: lastUpdateTimeRef.current,
        relayStatus: relayStatusRef.current,
        relaySynced: relaySyncedRef.current,
        relayStats: relayStatsRef.current
      };
      setDiagnostics((prev) => (sameDiagnostics(prev, next) ? prev : next));
    };

    collect();
    const timer = setInterval(() => {
      if (!cancelled) collect();
    }, DIAGNOSTICS_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [active]);

  /** セッションを終了し、Yjs 上の内容を Markdown として返す */
  const stopAndExtractMarkdown = useCallback(async (): Promise<string | null> => {
    const session = sessionRef.current;
    if (!session) return null;
    const markdown = modulesRef.current?.collab.fragmentToMarkdown(session.fragment) ?? null;
    stop();
    return markdown;
  }, [stop]);

  return {
    active,
    roomName,
    roleLabel,
    peers,
    diagnostics,
    showCursors,
    setShowCursors,
    ensure,
    stop,
    stopAndExtractMarkdown,
    setRoleLabel
  };
}
