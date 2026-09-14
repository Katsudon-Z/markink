import * as Y from 'yjs';

export function createYjsDocument(): Y.Doc {
  return new Y.Doc();
}

export interface CollabSession {
  doc: Y.Doc;
  roomName: string;
  connected: boolean;
}

// requirements.md:110-114 SMB共有上の文書をYjsで管理、WebRTC DataChannelで同期
export function setupCollabSession(roomName: string): CollabSession {
  const doc = createYjsDocument();
  console.log(`共同編集セッション作成: ${roomName}`);
  return { doc, roomName, connected: false };
}

export async function detectSMBShare(): Promise<string[]> {
  // Tauri backend 経由でSMB共有を検出する予定
  return [];
}
