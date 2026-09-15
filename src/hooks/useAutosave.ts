import { useCallback, useRef, useState } from 'react';
import { EditorView } from 'prosemirror-view';
import { defaultMarkdownSerializer } from '../lib/prosemirror/editor';
import { ipc } from '../lib/ipc';

const AUTOSAVE_DEBOUNCE_MS = 1000;

export function serializeView(view: EditorView | null): string | null {
  if (!view) return null;
  return defaultMarkdownSerializer.serialize(view.state.doc);
}

interface UseAutosaveOptions {
  getView: () => EditorView | null;
  /** 自動保存が実際に書き込まれたとき (最終保存時刻の表示などに利用) */
  onSaved?: () => void;
}

/**
 * 編集のたびにデバウンスして自動保存し、起動時に復元候補を提示する (requirements.md:48)
 * - 変更が無い場合はシリアライズも書き込みもしない (軽快さ優先)
 */
export function useAutosave({ getView, onSaved }: UseAutosaveOptions) {
  const [restoreCandidate, setRestoreCandidate] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dirty = useRef(false);

  const flush = useCallback(() => {
    if (!dirty.current) return;
    const content = serializeView(getView());
    if (content == null) return;
    dirty.current = false;
    void ipc.autosave(content).then(() => onSaved?.()).catch(() => {});
  }, [getView, onSaved]);

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
    flush();
  }, [flush]);

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
    void ipc.deleteAutosave().catch(() => {});
  }, []);

  return {
    restoreCandidate,
    markDirty,
    flushNow,
    loadRestoreCandidate,
    clearRestoreCandidate,
    discardServerAutosave
  };
}
