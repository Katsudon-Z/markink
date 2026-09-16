import { useCallback, useRef, useState } from 'react';
import { EditorView } from 'prosemirror-view';
import { markdownSerializer } from '../lib/prosemirror/editor';
import { ipc, type AutosaveData } from '../lib/ipc';

const AUTOSAVE_DEBOUNCE_MS = 1000;
/** 直列化をアイドル時間まで待つ上限 (これを過ぎたら実行する) */
const SERIALIZE_IDLE_TIMEOUT_MS = 2000;

interface IdleTask {
  cancel(): void;
}

/** 入力の合間 (アイドル時間) に実行する。requestIdleCallback 非対応環境では即時実行 */
function requestIdleTask(run: () => void, timeoutMs: number): IdleTask {
  if (typeof window.requestIdleCallback === 'function') {
    const handle = window.requestIdleCallback(run, { timeout: timeoutMs });
    return { cancel: () => window.cancelIdleCallback(handle) };
  }
  const timer = window.setTimeout(run, 0);
  return { cancel: () => window.clearTimeout(timer) };
}

export function serializeView(view: EditorView | null): string | null {
  if (!view) return null;
  return markdownSerializer.serialize(view.state.doc);
}

interface UseAutosaveOptions {
  getView: () => EditorView | null;
  /** 一緒に保存する共同編集のルーム名 (復元時に再利用する) */
  getRoomName?: () => string | null;
  /** 一緒に保存する文書パス (復元時に元のファイルとして開き直す) */
  getDocPath?: () => string | null;
  /** 自動保存が実際に書き込まれたとき (最終保存時刻の表示などに利用) */
  onSaved?: () => void;
}

/**
 * 編集のたびにデバウンスして自動保存し、起動時に復元候補を提示する (requirements.md:48)
 * - 変更が無い場合はシリアライズも書き込みもしない (軽快さ優先)
 */
export function useAutosave({ getView, getRoomName, getDocPath, onSaved }: UseAutosaveOptions) {
  const [restoreCandidate, setRestoreCandidate] = useState<AutosaveData | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dirty = useRef(false);
  const idle = useRef<IdleTask | null>(null);
  const getRoomNameRef = useRef(getRoomName);
  getRoomNameRef.current = getRoomName;
  const getDocPathRef = useRef(getDocPath);
  getDocPathRef.current = getDocPath;

  /** 直列化と書き込み (重い処理なのでアイドル時間に呼ぶ) */
  const write = useCallback(() => {
    const content = serializeView(getView());
    if (content == null) return;
    dirty.current = false;
    void ipc
      .autosave(content, getRoomNameRef.current?.() ?? null, getDocPathRef.current?.() ?? null)
      .then(() => onSaved?.())
      .catch(() => {});
  }, [getView, onSaved]);

  const cancelIdle = useCallback(() => {
    idle.current?.cancel();
    idle.current = null;
  }, []);

  const flush = useCallback(() => {
    if (!dirty.current) return;
    const view = getView();
    if (view?.composing) {
      // IME 変換中にシリアライズでメインスレッドを止めない
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(flush, AUTOSAVE_DEBOUNCE_MS);
      return;
    }
    if (idle.current) return; // 予約済みのアイドル処理で保存される
    // 入力を妨げないよう、直列化はアイドル時間まで待つ (要件: 100ms 以内の反応)
    idle.current = requestIdleTask(() => {
      idle.current = null;
      if (dirty.current) write();
    }, SERIALIZE_IDLE_TIMEOUT_MS);
  }, [getView, write]);

  /** 変更を検知してデバウンス保存を予約する */
  const markDirty = useCallback(() => {
    dirty.current = true;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(flush, AUTOSAVE_DEBOUNCE_MS);
  }, [flush]);

  /** 保留中の保存を即時実行 (終了時・保存時など) */
  const flushNow = useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    cancelIdle();
    if (dirty.current) write();
  }, [cancelIdle, write]);

  /** 起動時の復元候補を読み込む */
  const loadRestoreCandidate = useCallback(async () => {
    try {
      const saved = await ipc.readAutosave();
      if (saved) setRestoreCandidate(saved);
    } catch {
      window.alert('復元データの確認でエラーが発生しました。続行できますが、前回の内容は利用できません。');
    }
  }, []);

  const clearRestoreCandidate = useCallback(() => setRestoreCandidate(null), []);

  /** 正規保存が完了したので自動保存データを破棄する */
  const discardServerAutosave = useCallback(() => {
    dirty.current = false;
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    cancelIdle();
    void ipc.deleteAutosave().catch(() => {});
  }, [cancelIdle]);

  return {
    restoreCandidate,
    markDirty,
    flushNow,
    loadRestoreCandidate,
    clearRestoreCandidate,
    discardServerAutosave
  };
}
