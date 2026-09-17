import { useEffect, useRef, useState } from 'react';
import { ipc } from '../lib/ipc';
import { clearAiCursor, setAiName as setPresenceAiName } from '../lib/mcp/presence';
import { getToolHandler } from '../lib/mcp/tools';
import type { McpRequest, ToolContext } from '../lib/mcp/types';

/**
 * Rust gateway からの mcp:request を受けてツールを実行し、結果を返す。
 * 接続状態 (AI名) を保持し、切断時は AI カーソルを片付ける。
 */
export function useMcpBridge(ctx: ToolContext) {
  const [aiName, setAiName] = useState<string | null>(null);
  const ctxRef = useRef(ctx);
  ctxRef.current = ctx;

  useEffect(() => {
    let alive = true;
    const unlistens: (() => void)[] = [];
    void (async () => {
      // 前回有効のまま終了していた場合はエンドポイントを復旧する
      // (Rust の .setup() 直下では Tokio コンテキストが無いため、ここから呼ぶ)
      await ipc.mcpAutostart().catch(() => {});
      const { listen } = await import('@tauri-apps/api/event');
      if (!alive) return;
      unlistens.push(
        await listen<McpRequest>('mcp:request', async (event) => {
          const { id, tool, args } = event.payload;
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
          }
        })
      );
      unlistens.push(
        await listen<string>('mcp:connected', (event) => {
          if (!alive) return;
          setPresenceAiName(event.payload);
          setAiName(event.payload);
        })
      );
      unlistens.push(
        await listen('mcp:disconnected', () => {
          if (!alive) return;
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
    })();
    return () => {
      alive = false;
      unlistens.forEach((unlisten) => unlisten());
    };
  }, []);

  return { aiName, aiConnected: aiName != null };
}
