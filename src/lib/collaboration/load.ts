import type * as SessionModule from './session';
import type * as CollabModule from '../prosemirror/collab';

export interface CollabModules {
  session: typeof SessionModule;
  collab: typeof CollabModule;
}

let pending: Promise<CollabModules> | null = null;

/**
 * 共同編集ライブラリ (Yjs / y-webrtc / y-websocket / y-prosemirror) を必要なときに読み込む。
 * 起動時に読み込むバンドルを減らすため、動的 import で分離する。
 */
export function loadCollabModules(): Promise<CollabModules> {
  pending ??= Promise.all([import('./session'), import('../prosemirror/collab')]).then(
    ([session, collab]) => ({ session, collab })
  );
  return pending;
}
