import { Plugin } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import type { Node as PMNode } from 'prosemirror-model';

// 行番号ガター (論理行ごとに番号を表示)。折り返し継続行には番号を付けない
// (一般的なエディタと同様)。表示は設定で切替える。

let visible = true;

/** 行番号ガターの表示/非表示 (設定の反映用) */
export function setLineNumbersVisible(v: boolean): void {
  visible = v;
}

/** 論理行 (textblock 内の \n 区切り) の開始PM位置を列挙する (レイアウト参照なし) */
function logicalLineStarts(doc: PMNode): number[] {
  const starts: number[] = [];
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    const base = pos + 1;
    starts.push(base);
    // インライン子をオフセット付きで走査し、改行・hard_break を正確に追う
    node.content.forEach((child, childOffset) => {
      if (child.isText && child.text) {
        const parts = child.text.split('\n');
        let p = childOffset + parts[0].length + 1;
        for (let i = 1; i < parts.length; i += 1) {
          starts.push(base + p);
          p += parts[i].length + 1;
        }
      } else if (child.type.name === 'hard_break') {
        starts.push(base + childOffset + 1);
      }
    });
    return false;
  });
  return starts;
}

/**
 * 行番号ガターのプラグイン。
 * 可視範囲±余白の論理行だけ coordsAtPos で配置し、スクロール・変更・リサイズで更新する。
 */
export function lineNumbersPlugin(): Plugin {
  let gutter: HTMLElement | null = null;
  let scroller: HTMLElement | null = null;
  let raf = 0;
  let viewRef: EditorView | null = null;
  let resizeObs: ResizeObserver | null = null;

  const schedule = () => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(update);
  };

  const update = () => {
    raf = 0;
    const view = viewRef;
    if (!view || !gutter || !scroller || !visible) {
      if (gutter) gutter.style.display = 'none';
      return;
    }
    gutter.style.display = '';
    const doc = view.state.doc;
    const starts = logicalLineStarts(doc);
    if (starts.length === 0) {
      gutter.replaceChildren();
      return;
    }
    const rect = scroller.getBoundingClientRect();
    // 可視PM範囲を求め、文字数余白で広げる
    const topPos =
      view.posAtCoords({ left: rect.left + 60, top: rect.top + 1 })?.pos ?? 0;
    const bottomPos =
      view.posAtCoords({ left: rect.left + 60, top: rect.bottom - 1 })?.pos ??
      doc.content.size;
    const lo = Math.max(0, topPos - 2000);
    const hi = Math.min(doc.content.size, bottomPos + 2000);
    const frag = document.createDocumentFragment();
    for (let i = 0; i < starts.length; i += 1) {
      const p = starts[i];
      if (p < lo || p > hi) continue;
      let coords: { top: number };
      try {
        coords = view.coordsAtPos(Math.max(0, Math.min(p, doc.content.size)));
      } catch {
        continue;
      }
      const top = coords.top - rect.top + scroller.scrollTop;
      const div = document.createElement('div');
      div.className = 'line-number';
      div.textContent = String(i + 1);
      div.style.top = `${top}px`;
      frag.appendChild(div);
    }
    gutter.replaceChildren(frag);
  };

  return new Plugin({
    view(editorView) {
      viewRef = editorView;
      scroller = editorView.dom.parentElement as HTMLElement | null;
      gutter = document.createElement('div');
      gutter.className = 'line-numbers-gutter';
      gutter.setAttribute('aria-hidden', 'true');
      scroller?.prepend(gutter);
      const onScroll = () => schedule();
      scroller?.addEventListener('scroll', onScroll, { passive: true });
      if (typeof ResizeObserver !== 'undefined' && scroller) {
        resizeObs = new ResizeObserver(() => schedule());
        resizeObs.observe(scroller);
      }
      schedule();
      return {
        update() {
          schedule();
        },
        destroy() {
          cancelAnimationFrame(raf);
          scroller?.removeEventListener('scroll', onScroll);
          resizeObs?.disconnect();
          gutter?.remove();
          gutter = null;
          scroller = null;
          viewRef = null;
        }
      };
    }
  });
}
