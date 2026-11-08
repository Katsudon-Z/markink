import React from 'react';
import type { CollabDiagnostics } from '../hooks/useCollabSession';

interface StatusBarProps {
  /** 表示中のファイルパス (未保存なら null) */
  path: string | null;
  collabActive: boolean;
  peersCount: number;
  diagnostics: CollabDiagnostics;
}

function connectionSummary(diag: CollabDiagnostics, peersCount: number): string {
  const p2p = diag.webrtcPeerCount != null ? `P2P ${diag.webrtcPeerCount}台` : 'P2P 未確立';
  const relay = diag.relayStatus ?? '中継不明';
  const synced = diag.syncedFlag || diag.relaySynced ? '同期済み' : '未同期';
  return `${synced} / ${p2p} / 中継: ${relay} / 参加者 ${peersCount}人`;
}

/** 画面下部のステータスバー (同期状態・ファイル情報を常時表示) */
export const StatusBar = React.memo(function StatusBar({
  path,
  collabActive,
  peersCount,
  diagnostics
}: StatusBarProps) {
  return (
    <footer className="status-bar" role="status" aria-live="polite">
      <span className="status-left" title={path ?? '未保存の文書'}>
        {path ?? '未保存の文書'}
      </span>
      <span className="status-right">
        {collabActive
          ? `共同編集中 — ${connectionSummary(diagnostics, peersCount)}`
          : '単独編集中 — 共同編集を開始すると同期状態を表示します'}
      </span>
    </footer>
  );
});
