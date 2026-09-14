import React, { useState } from 'react';
import './CollaborationPanel.css';

interface CollabPanelProps {
  active: boolean;
  roomName?: string;
  onStart: (opts: { roomName: string; signalingUrl: string }) => void;
  onStop: () => void;
}

export const CollaborationPanel: React.FC<CollabPanelProps> = ({ active, roomName, onStart, onStop }) => {
  const [roomInput, setRoomInput] = useState('MDNotepad-room');
  const [signalingUrl, setSignalingUrl] = useState('');

  return (
    <div className="collab-panel">
      <h3>共同編集</h3>
      {active ? (
        <div className="collab-controls">
          <p>セッション中: {roomName ?? '(ルームなし)'}</p>
          <button className="btn-secondary" onClick={onStop}>共同編集を終了</button>
        </div>
      ) : (
        <div className="collab-controls">
          <div className="form-group">
            <label htmlFor="collab-room">ルーム名 (文書ごとに共通の名前)</label>
            <input
              id="collab-room"
              type="text"
              value={roomInput}
              onChange={(e) => setRoomInput(e.target.value)}
              placeholder="例: 議事録-2026-09-14"
            />
          </div>
          <div className="form-group">
            <label htmlFor="collab-signal">シグナリングサーバー URL (組織内の指定 URL)</label>
            <input
              id="collab-signal"
              type="text"
              value={signalingUrl}
              onChange={(e) => setSignalingUrl(e.target.value)}
              placeholder="ws://社内サーバ:4444"
            />
          </div>
          <button
            className="btn-secondary"
            disabled={!roomInput || !signalingUrl}
            onClick={() => onStart({ roomName: roomInput, signalingUrl })}
          >
            セッション開始
          </button>
        </div>
      )}
    </div>
  );
};
