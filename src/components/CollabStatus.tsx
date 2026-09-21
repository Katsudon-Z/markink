import React from 'react';
import type { CollabDiagnostics } from '../hooks/useCollabSession';
import { formatSyncLabel } from '../hooks/useCollabSession';

interface CollabStatusProps {
  diagnostics: CollabDiagnostics;
}

/** 共同編集の状態表示。診断値が変わったときのみ再描画される */
export const CollabStatus = React.memo(function CollabStatus({ diagnostics }: CollabStatusProps) {
  return (
    <>
      {diagnostics.webrtcPeerCount != null && (
        <p className="collab-status">P2P 接続中: {diagnostics.webrtcPeerCount}台(自身を含む)</p>
      )}
      <p className="collab-status">{formatSyncLabel(diagnostics)}</p>
    </>
  );
});
