import React, { useEffect, useState } from 'react';
import type { CollabDiagnostics } from '../hooks/useCollabSession';
import { CollabStatus } from './CollabStatus';
import './CollaborationPanel.css';

interface CollabPanelProps {
  active: boolean;
  roomName?: string;
  suggestedRoom?: string;
  positionLabel?: string;
  peers?: { clientID: number; name: string; color: string }[];
  diagnostics: CollabDiagnostics;
  onStart: (opts: { roomName: string; signalingUrl: string | null }) => void;
  onStop: () => void;
}

const DEFAULT_ROOM = 'MDNotepad-room';

export const CollaborationPanel: React.FC<CollabPanelProps> = ({
  active,
  roomName,
  suggestedRoom,
  positionLabel,
  peers,
  diagnostics,
  onStart,
  onStop
}) => {
  const [roomInput, setRoomInput] = useState(suggestedRoom ?? DEFAULT_ROOM);
  const [roomLocked, setRoomLocked] = useState(suggestedRoom != null);
  const [signalingUrl, setSignalingUrl] = useState('');
  const [auto, setAuto] = useState(true);

  // 文書を開いたら、その文書名をルーム名に統一 (全端末で一致させるため)
  useEffect(() => {
    if (suggestedRoom) {
      setRoomInput(suggestedRoom);
      setRoomLocked(true);
    }
  }, [suggestedRoom]);

  return (
    <div className="collab-panel">
      <h3>共同編集</h3>
      {active ? (
        <div className="collab-controls">
          <p>セッション中: {roomName ?? '(ルームなし)'}</p>
          {positionLabel && <p className="collab-status">{positionLabel}</p>}
          <CollabStatus diagnostics={diagnostics} />
          {peers && peers.length > 0 && (
            <div className="collab-peers">
              <p>接続中の参加者 ({peers.length}人):</p>
              <ul>
                {peers.map((p) => (
                  <li key={p.clientID}>
                    <span className="collab-peer-dot" style={{ background: p.color }} />
                    {p.name}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <button className="btn-secondary" onClick={onStop}>共同編集を終了</button>
        </div>
      ) : (
        <div className="collab-controls">
          <div className="form-group">
            <label htmlFor="collab-room">ルーム名 (文書名と一致させます)</label>
            <input
              id="collab-room"
              type="text"
              value={roomInput}
              disabled={roomLocked}
              onChange={(e) => setRoomInput(e.target.value)}
              placeholder="例: 議事録-2026-09-14"
            />
            {roomLocked && (
              <button
                className="btn-link"
                onClick={() => setRoomLocked(false)}
                title="別のルーム名を手入力する場合に有効化します"
              >
                別のルーム名を使う
              </button>
            )}
          </div>
          <label className="collab-auto">
            <input
              type="checkbox"
              checked={auto}
              onChange={(e) => setAuto(e.target.checked)}
            />
            保存済み文書のフォルダからホストを自動検出 (最初に起動した端末がサーバになります)
          </label>
          {!auto && (
            <div className="form-group">
              <label htmlFor="collab-signal">シグナリングサーバー URL (手動指定)</label>
              <input
                id="collab-signal"
                type="text"
                value={signalingUrl}
                onChange={(e) => setSignalingUrl(e.target.value)}
                placeholder="ws://社内サーバ:42100"
              />
            </div>
          )}
          <button
            className="btn-secondary"
            disabled={!roomInput || (!auto && !signalingUrl)}
            onClick={() => onStart({ roomName: roomInput, signalingUrl: auto ? null : signalingUrl })}
          >
            セッション開始
          </button>
        </div>
      )}
    </div>
  );
};
