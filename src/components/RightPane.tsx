import { useEffect, useState } from 'react';
import type { EditorView } from 'prosemirror-view';
import { TextSelection } from 'prosemirror-state';
import type { Node as PMNode } from 'prosemirror-model';
import { getOutline, type OutlineHeading } from '../lib/mcp/document';
import { subscribeDocVersion } from '../lib/mcp/docVersion';

interface RightPaneProps {
  getView: () => EditorView | null;
  peers: { clientID: number; name: string; color: string; ai?: boolean }[];
  aiName?: string | null;
  collabActive: boolean;
}

/**
 * 右ペイン: 目次 (見出し一覧・クリックで移動) と、その下に共同編集の参加者一覧。
 * 目次は文書版の進行に追従して更新する。
 */
export function RightPane({ getView, peers, aiName, collabActive }: RightPaneProps) {
  const [headings, setHeadings] = useState<OutlineHeading[]>([]);

  useEffect(() => {
    // 版通知に付いてくる新しい文書を使う。通知時点では view.state が
    // まだ古い文書のため、view から読むと1手遅れになる。
    const recompute = (doc?: PMNode) => {
      const target = doc ?? getView()?.state.doc;
      if (!target) {
        setHeadings([]);
        return;
      }
      try {
        const next = getOutline(target);
        setHeadings((prev) => {
          if (
            prev.length === next.length &&
            prev.every((h, i) => h.level === next[i].level && h.text === next[i].text)
          ) {
            return prev;
          }
          return next;
        });
      } catch {
        // ignore
      }
    };
    recompute();
    const unsub = subscribeDocVersion((_info, doc) => recompute(doc));
    return unsub;
  }, [getView, collabActive]);

  const jump = (pos: number) => {
    const view = getView();
    if (!view) return;
    try {
      const safe = Math.max(0, Math.min(pos, view.state.doc.content.size));
      const sel = TextSelection.near(view.state.doc.resolve(safe));
      view.dispatch(view.state.tr.setSelection(sel).scrollIntoView());
      view.focus();
    } catch {
      // ignore
    }
  };

  const showPeers = collabActive || aiName != null;

  return (
    <aside className="right-pane" aria-label="目次と参加者">
      <h3>目次</h3>
      {headings.length === 0 ? (
        <p className="restore-message">見出しがありません</p>
      ) : (
        <ul className="toc">
          {headings.map((h, i) => (
            <li key={i} className="toc-item">
              <button
                type="button"
                title={h.text}
                style={{ paddingLeft: `${4 + (h.level - 1) * 12}px` }}
                onClick={() => jump(h.pos)}
              >
                {h.text || '(空の見出し)'}
              </button>
            </li>
          ))}
        </ul>
      )}
      {showPeers && (
        <>
          <h3>参加者 ({peers.length}人)</h3>
          {peers.length === 0 ? (
            <p className="restore-message">自分のみ</p>
          ) : (
            <ul className="peers">
              {peers.map((p) => (
                <li key={p.clientID}>
                  <span className="collab-peer-dot" style={{ background: p.color }} />
                  {p.ai && <span className="collab-peer-ai">AI</span>}
                  {p.name}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </aside>
  );
}
