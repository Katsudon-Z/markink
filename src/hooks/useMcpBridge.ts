import { useEffect, useRef, useState } from 'react';
import { ipc } from '../lib/ipc';
import { MCP_FEATURE_ENABLED } from '../lib/features';
import { clearAiCursor, setAiName as setPresenceAiName } from '../lib/mcp/presence';
import {
  getDocVersion,
  getLastCursor,
  getLastOrigin,
  subscribeDocVersion
} from '../lib/mcp/docVersion';
import { getToolHandler } from '../lib/mcp/tools';
import type { McpRequest, ToolContext } from '../lib/mcp/types';

/**
 * Rust gateway からの mcp:request を受けてツールを実行し、結果を返す。
 * 接続状態 (AI名) を保持し、切断時は AI カーソルを片付ける。
 */
export function useMcpBridge(ctx: ToolContext) {
  const [aiName, setAiName] = useState<string | null>(null);
  // 実行中のツール要求数 (AI処理中の表示用。完了で必ず戻す)
  const [busyCount, setBusyCount] = useState(0);
  const ctxRef = useRef(ctx);
  ctxRef.current = ctx;
  const aiNameRef = useRef<string | null>(null);

  useEffect(() => {
    // MCP機能は非表示中のため、自動起動も待受けも行わない (実装は残置)
    if (!MCP_FEATURE_ENABLED) return;
    let alive = true;
    const unlistens: (() => void)[] = [];
    void (async () => {
      // 前回有効のまま終了していた場合はエンドポイントを復旧する
      // (Rust の .setup() 直下では Tokio コンテキストが無いため、ここから呼ぶ)
      await ipc.mcpAutostart().catch(() => {});
      const { listen } = await import('@tauri-apps/api/event');
      if (!alive) return;      unlistens.push(
        await listen<McpRequest>('mcp:request', async (event) => {
          const { id, tool, args } = event.payload;
          setBusyCount((c) => c + 1);
          try {
            const handler = getToolHandler(tool);
            if (!handler) throw new Error(`未知のツール: ${tool}`);
            const data = await handler(args ?? {}, ctxRef.current);
            await ipc.mcpResponse(id, true, data ?? null, null);
          } catch (err) {
            await ipc.mcpResponse(
              id,
              false,
              null,
              err instanceof Error ? err.message : String(err)
            );
          } finally {
            setBusyCount((c) => Math.max(0, c - 1));
          }
        })
      );
      unlistens.push(
        await listen<string>('mcp:connected', (event) => {
          if (!alive) return;
          // ref を先に更新する (後続処理の例外で取りこぼさないため)
          aiNameRef.current = event.payload;
          setPresenceAiName(event.payload);
          setAiName(event.payload);
        })
      );
      unlistens.push(
        await listen('mcp:disconnected', () => {
          if (!alive) return;
          aiNameRef.current = null;
          setAiName(null);
          setPresenceAiName(null);
          clearAiCursor();
        })
      );
      unlistens.push(
        await listen<string>('mcp:rejected', (event) => {
          if (!alive) return;
          ctxRef.current.notifyHuman(`2つ目のAI接続を拒否しました (${event.payload})`);
        })
      );
      // 接続イベントを聞き逃した場合に備え、現在の接続状態で同期する
      // (起動直後の接続など、emit より listen 登録が遅れた場合の取りこぼし対策)
      try {
        const status = await ipc.mcpStatus();
        if (!alive) return;
        if (status.connection) {
          aiNameRef.current = status.connection;
          setPresenceAiName(status.connection);
          setAiName(status.connection);
        }
      } catch {
        // 状態取得の失敗は無視する (次回の接続イベントで同期される)
      }
    })();
    return () => {
      alive = false;
      unlistens.forEach((unlisten) => unlisten());
    };
  }, []);

  // 文書版の購読: 変更のたびに Rust へ送る (AIへの通知に転送される)。
  // 本文は送らず「版が進んだ」の合図のみ。
  // 注意: setTimeout による間引きは行わない。バックグラウンドの WebView では
  // タイマーが凍結され通知が届かなくなるため、dispatch と同期に送信する。
  // バースト時の負荷は localhost 往復で吸収できる範囲であり、必要になれば
  // Rust 側 (Tokio、スロットルされない) で合流させる。
  useEffect(() => {
    let lastSent = -1;
    const unsubscribe = subscribeDocVersion(() => {
      if (aiNameRef.current == null) return;
      const version = getDocVersion();
      if (version === lastSent) return;
      lastSent = version;
      // カーソルは変更時点に記録済みのものを使う (送信時に view を触らない)
      const cursor = getLastCursor();
      void ipc
        .mcpDocChanged(version, getLastOrigin(), cursor?.from ?? null, cursor?.to ?? null)
        .catch(() => {});
    });
    return () => {
      unsubscribe();
    };
  }, []);

  return { aiName, aiConnected: aiName != null, toolBusy: busyCount > 0 };
}
