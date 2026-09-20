import { useCallback, useEffect, useState } from 'react';
import type { EditorView } from 'prosemirror-view';
import { ipc, type AiModeId } from '../lib/ipc';
import { buildAiContext } from '../lib/ai/context';
import { insertAiMarkdown, replaceAiRange } from '../lib/ai/applyResult';

/** 右クリックAIメニューの表示情報 (送信文字数は表示時に一度だけ計算する) */
export interface AiMenuState {
  x: number;
  y: number;
  contextChars: number;
  hasSelection: boolean;
  /** ショートカットから開いた場合、プロンプト欄にフォーカスする */
  focusPrompt?: boolean;
}

export interface AiRunState {
  mode: AiModeId;
  selFrom: number;
  selTo: number;
  cursorPos: number;
  hasSelection: boolean;
  text: string;
  error: string | null;
}

interface UseAiCallOptions {
  getView: () => EditorView | null;
  notifyHuman: (message: string) => void;
  onOpenSettings: () => void;
}

/**
 * エディタ起点のAI呼び出し (右クリックメニュー → 結果ダイアログ)。
 * App から状態とハンドラを分離して見通しを良くする。
 */
export function useAiCall({ getView, notifyHuman, onOpenSettings }: UseAiCallOptions) {
  const [aiMenu, setAiMenu] = useState<AiMenuState | null>(null);
  const [aiEnabled, setAiEnabled] = useState(false);
  const [aiRun, setAiRun] = useState<AiRunState | null>(null);
  const [aiBusy, setAiBusy] = useState<{ mode: AiModeId; startedAt: number } | null>(null);
  // Ctrl+Space の確認なし続き生成が実行中か (処理中バッジ用)
  const [directBusy, setDirectBusy] = useState(false);
  const [aiElapsed, setAiElapsed] = useState(0);

  // 起動時は状態だけ読む。serve の起動は初回AI利用まで遅延させる
  // (opencode の起動は重く、毎回のアプリ起動を遅くするため)。
  // ai_ask 内部の ensure_running が必要時に起動する。
  useEffect(() => {
    void ipc
      .aiStatus()
      .then((st) => setAiEnabled(st.enabled))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!aiBusy) {
      setAiElapsed(0);
      return;
    }
    setAiElapsed(0);
    const timer = window.setInterval(
      () => setAiElapsed(Math.floor((Date.now() - aiBusy.startedAt) / 1000)),
      500
    );
    return () => window.clearInterval(timer);
  }, [aiBusy]);

  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target?.closest?.('.ProseMirror')) return;
      e.preventDefault();
      void ipc
        .mcpGetSettings()
        .then((s) => setAiEnabled(s.aiCallEnabled))
        .catch(() => {});
      // 送信文字数はメニュー表示用に一度だけ計算する (レンダー毎の全文直列化を避ける)
      const view = getView();
      let contextChars = 0;
      let hasSelection = false;
      if (view) {
        try {
          const built = buildAiContext(view, 'question', 8000);
          contextChars = built.context.length;
          hasSelection = built.hasSelection;
        } catch {
          // 直列化失敗時は 0 表示
        }
      }
      setAiMenu({ x: e.clientX, y: e.clientY, contextChars, hasSelection });
    },
    [getView]
  );

  const executeAi = useCallback(
    (mode: AiModeId, prompt: string) => {
      const view = getView();
      if (!view) {
        notifyHuman('エディタが準備できていません');
        return;
      }
      if ((mode === 'question' || mode === 'edit') && !prompt.trim()) {
        notifyHuman('指示・質問を入力してください');
        return;
      }
      let built;
      try {
        built = buildAiContext(view, mode, 8000);
      } catch (err) {
        notifyHuman(err instanceof Error ? err.message : String(err));
        return;
      }
      if (!built.context.trim()) {
        notifyHuman('送信できる文書がありません');
        return;
      }
      setAiMenu(null);
      setAiBusy({ mode, startedAt: Date.now() });
      setAiRun({
        mode,
        selFrom: built.selFrom,
        selTo: built.selTo,
        cursorPos: built.cursorPos,
        hasSelection: built.hasSelection,
        text: '',
        error: null
      });
      void (async () => {
        try {
          const answer = await ipc.aiAsk(mode, prompt, built.context);
          setAiRun((prev) =>
            prev && prev.mode === mode ? { ...prev, text: answer.text } : prev
          );
        } catch (err) {
          setAiRun((prev) =>
            prev && prev.mode === mode
              ? { ...prev, error: err instanceof Error ? err.message : String(err) }
              : prev
          );
        } finally {
          setAiBusy((prev) => (prev && prev.mode === mode ? null : prev));
        }
      })();
    },
    [getView, notifyHuman]
  );

  const abortAi = useCallback(() => {
    void ipc.aiAbort().catch((err) => notifyHuman(String(err)));
  }, [notifyHuman]);

  /** 右クリックメニュー用: 選択範囲をコピー (メニューは開いたまま) */
  const copySelection = useCallback(() => {
    const view = getView();
    if (!view) return;
    const { from, to, empty } = view.state.selection;
    if (empty) {
      notifyHuman('コピーする範囲を選択してください');
      return;
    }
    const text = view.state.doc.textBetween(from, to, '\n');
    void navigator.clipboard
      ?.writeText(text)
      .catch(() => notifyHuman('コピーに失敗しました'));
  }, [getView, notifyHuman]);

  /** 右クリックメニュー用: 選択範囲を切り取り */
  const cutSelection = useCallback(() => {
    const view = getView();
    if (!view) return;
    const { from, to, empty } = view.state.selection;
    if (empty) {
      notifyHuman('切り取る範囲を選択してください');
      return;
    }
    const text = view.state.doc.textBetween(from, to, '\n');
    const remove = () => {
      const v = getView();
      if (v) v.dispatch(v.state.tr.deleteSelection().scrollIntoView());
      setAiMenu(null);
    };
    if (navigator.clipboard?.writeText) {
      void navigator.clipboard
        .writeText(text)
        .then(remove)
        .catch(() => notifyHuman('切り取りに失敗しました'));
    } else {
      remove();
    }
  }, [getView, notifyHuman]);

  /** 右クリックメニュー用: カーソル位置に貼り付け */
  const pasteFromClipboard = useCallback(() => {
    const view = getView();
    if (!view) return;
    if (!navigator.clipboard?.readText) {
      notifyHuman('貼り付けに対応していません');
      return;
    }
    void navigator.clipboard
      .readText()
      .then((text) => {
        const v = getView();
        if (!v || !text) return;
        const { from, to } = v.state.selection;
        v.dispatch(v.state.tr.insertText(text, from, to).scrollIntoView());
        setAiMenu(null);
      })
      .catch(() => notifyHuman('貼り付けに失敗しました'));
  }, [getView, notifyHuman]);

  /**
   * Ctrl+Space 用: カーソル位置からAIで続きを書き、確認なしで直接挿入する。
   * 結果ダイアログは出さない。失敗時のみトーストで知らせる。
   */
  const continueDirectly = useCallback(() => {
    const view = getView();
    if (!view || view.composing) return false;
    let built;
    try {
      built = buildAiContext(view, 'continue', 8000);
    } catch {
      return false;
    }
    if (!built.context.trim()) {
      notifyHuman('送信できる文書がありません');
      return true;
    }
    notifyHuman('AIが続きを生成しています…');
    setDirectBusy(true);
    void (async () => {
      try {
        const answer = await ipc.aiAsk('continue', '', built.context);
        const v = getView();
        if (v && answer.text.trim()) {
          insertAiMarkdown(v, built.cursorPos, answer.text);
        }
      } catch (err) {
        notifyHuman(err instanceof Error ? err.message : String(err));
      } finally {
        setDirectBusy(false);
      }
    })();
    return true;
  }, [getView, notifyHuman]);

  /**
   * ショートカット用: カーソル位置にAIメニューを開く (質問・編集代行用)。
   * プロンプト欄にフォーカスする。
   */
  const openMenuAtCursor = useCallback(() => {
    const view = getView();
    if (!view || view.composing) return false;
    let coords;
    try {
      const pos = Math.max(
        0,
        Math.min(view.state.selection.from, view.state.doc.content.size)
      );
      coords = view.coordsAtPos(pos);
    } catch {
      return false;
    }
    void ipc
      .mcpGetSettings()
      .then((s) => setAiEnabled(s.aiCallEnabled))
      .catch(() => {});
    let contextChars = 0;
    let hasSelection = false;
    try {
      const built = buildAiContext(view, 'question', 8000);
      contextChars = built.context.length;
      hasSelection = built.hasSelection;
    } catch {
      // 直列化失敗時は 0 表示
    }
    setAiMenu({
      x: coords.left,
      y: coords.bottom,
      contextChars,
      hasSelection,
      focusPrompt: true
    });
    return true;
  }, [getView]);

  /**
   * ショートカットキー振り分け (Editor のキー処理から呼ぶ)。
   * 要約・続きは即実行、質問・編集代行はメニューを開く (プロンプト必須のため)。
   */
  const handleAiShortcut = useCallback(
    (mode: AiModeId) => {
      if (mode === 'continue') {
        continueDirectly();
      } else if (mode === 'summary') {
        executeAi('summary', '');
      } else {
        openMenuAtCursor();
      }
    },
    [continueDirectly, executeAi, openMenuAtCursor]
  );

  const applyAiInsert = useCallback(() => {
    const view = getView();
    if (!view || !aiRun?.text) return;
    try {
      insertAiMarkdown(view, aiRun.cursorPos, aiRun.text);
      setAiRun(null);
    } catch (err) {
      notifyHuman(err instanceof Error ? err.message : String(err));
    }
  }, [getView, aiRun, notifyHuman]);

  const applyAiReplace = useCallback(() => {
    const view = getView();
    if (!view || !aiRun?.text) return;
    try {
      replaceAiRange(view, aiRun.selFrom, aiRun.selTo, aiRun.text);
      setAiRun(null);
    } catch (err) {
      notifyHuman(err instanceof Error ? err.message : String(err));
    }
  }, [getView, aiRun, notifyHuman]);

  return {
    aiMenu,
    aiEnabled,
    aiRun,
    aiBusy,
    directBusy,
    aiElapsed,
    handleContextMenu,
    executeAi,
    abortAi,
    copySelection,
    cutSelection,
    pasteFromClipboard,
    continueDirectly,
    openMenuAtCursor,
    handleAiShortcut,
    applyAiInsert,
    applyAiReplace,
    closeAiMenu: () => setAiMenu(null),
    closeAiDialog: () => setAiRun(null),
    openSettingsFromMenu: () => {
      setAiMenu(null);
      onOpenSettings();
    }
  };
}
