import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { Awareness } from 'y-protocols/awareness';
import { createEditorState } from '../../src/lib/prosemirror/editor';
import { createCollabEditorState, seedFragmentFromProseMirror, fragmentToMarkdown } from '../../src/lib/prosemirror/collab';
import { listPeers, randomColorForClientID } from '../../src/lib/collaboration/session';

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
});
