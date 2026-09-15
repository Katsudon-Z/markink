import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { EditorView } from 'prosemirror-view';
import { Awareness } from 'y-protocols/awareness';
import { createEditorState } from '../../src/lib/prosemirror/editor';
import { createCollabEditorState, seedFragmentFromProseMirror, fragmentToMarkdown } from '../../src/lib/prosemirror/collab';
import { listPeers, randomColorForClientID, stemOfPath } from '../../src/lib/collaboration/session';

describe('collab (y-prosemirror)', () => {
  it('ローカル文書をYjsフラグメントに反映し、Markdownに戻せる', () => {
    const ydoc = new Y.Doc();
    const fragment = ydoc.get('prosemirror', Y.XmlFragment) as Y.XmlFragment;
    const state = createEditorState('# 見出し\n\nこれは**太字**のテスト文書。\n');
    seedFragmentFromProseMirror(state.doc, ydoc, fragment);
    expect(fragment.length).toBeGreaterThan(0);

    const collabState = createCollabEditorState({ fragment, awareness: new Awareness(ydoc) });
    const md = fragmentToMarkdown(fragment);
    expect(md).toContain('# 見出し');
    expect(md).toContain('**太字**');
    expect(collabState.doc.textContent.length).toBeGreaterThan(0);
  });

  it('参加者一覧を取得できる (自分を除く)', () => {
    const ydoc = new Y.Doc();
    const awareness = new Awareness(ydoc);
    awareness.setLocalStateField('user', { name: '私', color: '#fff' });
    const others = listPeers(awareness, ydoc.clientID);
    expect(others).toEqual([]);

    const fakeState = new Map<number, unknown>([
      [999, { user: { name: '他参加A', color: '#f00' } }]
    ]);
    (awareness.getStates as unknown as () => Map<number, unknown>) = (() => fakeState) as never;
    const peers = listPeers(awareness, ydoc.clientID);
    expect(peers.length).toBe(1);
    expect(peers[0].name).toBe('他参加A');
  });

  it('clientIDから安定した色を返す', () => {
    expect(randomColorForClientID(1)).toBe(randomColorForClientID(1));
    expect(randomColorForClientID(99999)).toMatch(/^#/);
  });

  // 回帰: 自動参加と手動開始でルーム名が一致すること (不一致だと接続不成立・エラーなし)
  it('文書パスからルーム名(拡張子なし)を一意に決定する', () => {
    expect(stemOfPath('Z:\\共有\\議事録.md')).toBe('議事録');
    expect(stemOfPath('/mnt/share/議事録.markdown')).toBe('議事録');
    expect(stemOfPath('C:/docs/Notes.MD')).toBe('Notes');
    expect(stemOfPath('noext')).toBe('noext');
    expect(stemOfPath('議事録.md')).toBe('議事録');
  });

  it('フラグメントが空でも有効な文書で初期化できる (参加側の同期前)', () => {
    const ydoc = new Y.Doc();
    const fragment = ydoc.get('prosemirror', Y.XmlFragment) as Y.XmlFragment;
    const fallback = createEditorState('ローカル文').doc;
    const st = createCollabEditorState({ fragment, awareness: new Awareness(ydoc) }, fallback);
    expect(st.doc.textContent).toContain('ローカル文');
    // 空フラグメントはそのまま (ホストのみがシードする)
    expect(fragment.length).toBe(0);
  });

  it('同じフラグメントを共有する2ビュー間で編集が収束する', () => {
    const ydoc = new Y.Doc();
    const fragment = ydoc.get('prosemirror', Y.XmlFragment) as Y.XmlFragment;
    const initial = createEditorState('# 共有文書\n');
    seedFragmentFromProseMirror(initial.doc, ydoc, fragment);

    const el1 = document.createElement('div');
    const el2 = document.createElement('div');
    document.body.append(el1, el2);
    const opts1 = { fragment, awareness: new Awareness(ydoc) };
    const view1 = new EditorView(el1, { state: createCollabEditorState(opts1) });
    const view2 = new EditorView(el2, { state: createCollabEditorState({ fragment, awareness: new Awareness(ydoc) }) });

    // ビュー1 (端末A相当) で追記
    const insertPos = view1.state.doc.content.size - 1;
    view1.dispatch(view1.state.tr.insertText('追記文', insertPos));

    // ビュー2 (端末B相当) に即時反映される (同一プロセス内 Yjs は同期更新)
    expect(view2.state.doc.textContent).toContain('追記文');

    // Markdown へ戻しても追記が残る
    expect(fragmentToMarkdown(fragment)).toContain('追記文');

    view1.destroy();
    view2.destroy();
  });
});
