import * as Y from 'yjs';
import { WebrtcProvider } from 'y-webrtc';
import { WebsocketProvider as YRelayProvider } from 'y-websocket';
import { Awareness } from 'y-protocols/awareness';

// requirements.md:110-114
// WebRTC DataChannel + Yjs。シグナリングは組織内の指定 URL のみ使用し、
// STUN/TURN は初期状態で無効 (LAN 内でのみ完結)

export const PROSEMIRROR_FRAGMENT_KEY = 'prosemirror';

export interface CollabSession {
  doc: Y.Doc;
  fragment: Y.XmlFragment;
  awareness: Awareness;
  provider: WebrtcProvider;
  relay: YRelayProvider | null;
  roomName: string;
}

export interface StartCollabOptions {
  roomName: string;
  signalingUrl: string;
  userName?: string;
}

export function startCollabSession(opts: StartCollabOptions): CollabSession {
  const doc = new Y.Doc();
  const clientID = doc.clientID;
  const awareness = new Awareness(doc);
  awareness.setLocalStateField('user', {
    name: opts.userName || `ユーザ-${clientID % 10000}`,
    color: randomColorForClientID(clientID)
  });

  // STUN/TURN は初期状態で無効 (requirements.md:114)。LAN 内の直接接続のみ使用
  const provider = new WebrtcProvider(opts.roomName, doc, {
    awareness,
    signaling: [opts.signalingUrl],
    peerOpts: { config: { iceServers: [] } }
  });

  // TCP 中継フォールバック: P2P が不通でもホスト経由で同期を保証する。
  // 同じ Y.Doc を共有するため二重配送でも CRDT で収束する。
  let relay: YRelayProvider | null = null;
  try {
    const base = opts.signalingUrl.replace(/\/$/, '');
    relay = new YRelayProvider(
      base,
      encodeURIComponent(opts.roomName),
      doc,
      { awareness, disableBc: true }
    );
  } catch (e) {
    console.warn('relay provider init failed', e);
  }

  return {
    doc,
    fragment: doc.get(PROSEMIRROR_FRAGMENT_KEY, Y.XmlFragment) as Y.XmlFragment,
    awareness,
    provider,
    relay,
    roomName: opts.roomName
  };
}

export function stopCollabSession(session: CollabSession): void {
  try {
    session.relay?.disconnect();
    session.relay?.destroy();
  } catch {
    /* ignore */
  }
  try {
    session.provider.destroy();
  } finally {
    session.doc.destroy();
  }
}

export function randomColorForClientID(clientID: number): string {
  const colors = ['#e11d48', '#0284c7', '#16a34a', '#d97706', '#7c3aed', '#0891b2'];
  return colors[Math.abs(clientID) % colors.length];
}

export interface PeerInfo {
  clientID: number;
  name: string;
  color: string;
}

// 文書名からルーム名を一意に決定 (全端末で一致させるため必須)
// PC間でルーム名がずれると接続自体が成立しない
export { stem as stemOfPath } from '../path';

// 参加者一覧の取得 (自分を除く)
export function listPeers(awareness: Awareness, selfClientID: number): PeerInfo[] {
  const result: PeerInfo[] = [];
  awareness.getStates().forEach((state, id) => {
    const user = (state as { user?: { name?: string; color?: string } }).user;
    if (id !== selfClientID && user) {
      result.push({
        clientID: id,
        name: user.name ?? `ユーザ-${id}`,
        color: user.color ?? '#999'
      });
    }
  });
  return result;
}
