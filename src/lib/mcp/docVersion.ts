import { Plugin } from 'prosemirror-state';
import type { Transaction } from 'prosemirror-state';

// 文書版管理 (バージョン通知 P1)
// すべての編集は view.dispatch に収束する (単独編集の人間入力・AI編集、
// 共同編集中のリモートYjs更新も y-prosemirror が dispatch として適用する)。
// そのため dispatch を監視する1箇所のフックで全モードの変更を検知できる。
// ストアはプラグイン外に置くため、共同編集の開始/終了による
// view.updateState 再構築でも版番号は維持される。

/** AIによるトランザクションを示すmetaキー (tools.ts が付与する) */
export const AI_TR_META = 'mcpAi';

export type DocChangeOrigin = 'ai' | 'human';

export interface DocVersionInfo {
  version: number;
  origin: DocChangeOrigin;
}

let version = 0;
let lastOrigin: DocChangeOrigin = 'human';
let lastCursor: { from: number; to: number } | null = null;
const listeners = new Set<(info: DocVersionInfo) => void>();

export function getDocVersion(): number {
  return version;
}

export function getLastOrigin(): DocChangeOrigin {
  return lastOrigin;
}

/** 版を1つ進める (dispatch監視プラグインと文書切替処理が呼ぶ) */
export function bumpDocVersion(origin: DocChangeOrigin): DocVersionInfo {
  version += 1;
  lastOrigin = origin;
  const info: DocVersionInfo = { version, origin };
  listeners.forEach((cb) => {
    try {
      cb(info);
    } catch {
      // 通知先の例外で編集を壊さない
    }
  });
  return info;
}

/** テスト用のリセット (本番では呼ばない) */
export function resetDocVersion(): void {
  version = 0;
  lastOrigin = 'human';
  lastCursor = null;
}

/** 版が進んだときの購読 (通知送信側が使う)。戻り値で解除する */
export function subscribeDocVersion(cb: (info: DocVersionInfo) => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

function transactionOrigin(trs: readonly Transaction[]): DocChangeOrigin {
  return trs.some((tr) => tr.getMeta(AI_TR_META) === true) ? 'ai' : 'human';
}

/** 変更時点の人間カーソル (通知用。非整数値は記録しない) */
export function getLastCursor(): { from: number; to: number } | null {
  return lastCursor;
}

/**
 * 人間カーソルを記録する。Editor の dispatchTransaction から呼ぶ
 * (dispatch と同期しているため view が確実に存在する)。
 */
export function recordCursor(from: number, to: number): void {
  if (Number.isInteger(from) && Number.isInteger(to)) {
    lastCursor = { from, to };
  }
}

/**
 * dispatchされた変更を監視し版を進める。
 * createBasePlugins 経由で単独・共同の両状態に入る。
 * 空トランザクション (AIカーソル再描画など) では何もしない。
 * 通知より先にカーソルを記録する (送信側が同期的に読むため)。
 * 選択のみの移動は Editor の dispatchTransaction 側で追う。
 */
export function docVersionPlugin(): Plugin {
  return new Plugin({
    appendTransaction(trs) {
      let changed: Transaction | null = null;
      for (const tr of trs) {
        if (tr.docChanged) changed = tr;
      }
      if (!changed) return undefined;
      // 適用後の選択位置を記録してから版を進める (購読者への通知が最新位置を持つ)
      try {
        recordCursor(changed.selection.from, changed.selection.to);
      } catch {
        // 記録失敗は版管理に影響させない
      }
      bumpDocVersion(transactionOrigin(trs));
      return undefined;
    }
  });
}
