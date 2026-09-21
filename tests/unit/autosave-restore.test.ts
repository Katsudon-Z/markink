import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React, { useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { EditorView } from 'prosemirror-view';
import { invoke } from '@tauri-apps/api/core';
import { createEditorState } from '../../src/lib/prosemirror/editor';
import { useAutosave } from '../../src/hooks/useAutosave';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const invokeMock = vi.mocked(invoke);

function createView() {
  const el = document.createElement('div');
  document.body.appendChild(el);
  return new EditorView(el, { state: createEditorState('本文\n') });
}

interface HarnessProps {
  apiRef: { current: ReturnType<typeof useAutosave> | null };
  getView: () => EditorView | null;
  getRestoreEnabled: () => boolean;
}

function Harness({ apiRef, getView, getRestoreEnabled }: HarnessProps) {
  const api = useAutosave({ getView, getRestoreEnabled });
  useEffect(() => {
    apiRef.current = api;
  });
  return React.createElement('div', {
    'data-candidate': api.restoreCandidate ? 'yes' : 'no'
  });
}

function renderHarness(props: HarnessProps) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(React.createElement(Harness, props));
  });
  const candidate = () =>
    container.querySelector('[data-candidate]')?.getAttribute('data-candidate');
  return {
    container,
    candidate,
    unmount: () => {
      act(() => {
        root.unmount();
      });
      container.remove();
    }
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  invokeMock.mockReset();
  invokeMock.mockResolvedValue(null);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('復元機能が無効 (既定) のとき', () => {
  it('markDirty しても自動保存の invoke を呼ばない', () => {
    const view = createView();
    const apiRef: HarnessProps['apiRef'] = { current: null };
    const h = renderHarness({
      apiRef,
      getView: () => view,
      getRestoreEnabled: () => false
    });
    act(() => {
      apiRef.current!.markDirty();
    });
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(invokeMock).not.toHaveBeenCalledWith('autosave', expect.anything());
    expect(apiRef.current!.isDirty()).toBe(false);
    h.unmount();
    view.destroy();
  });

  it('loadRestoreCandidate が読み込みも提案もしない', async () => {
    const apiRef: HarnessProps['apiRef'] = { current: null };
    const h = renderHarness({
      apiRef,
      getView: () => null,
      getRestoreEnabled: () => false
    });
    await act(async () => {
      await apiRef.current!.loadRestoreCandidate();
    });
    expect(invokeMock).not.toHaveBeenCalledWith('read_autosave', expect.anything());
    expect(h.candidate()).toBe('no');
    h.unmount();
  });
});

describe('復元機能が有効のとき', () => {
  it('markDirty 後に自動保存の invoke を呼ぶ', () => {
    const view = createView();
    const apiRef: HarnessProps['apiRef'] = { current: null };
    const h = renderHarness({
      apiRef,
      getView: () => view,
      getRestoreEnabled: () => true
    });
    act(() => {
      apiRef.current!.markDirty();
    });
    expect(apiRef.current!.isDirty()).toBe(true);
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(invokeMock).toHaveBeenCalledWith(
      'autosave',
      expect.objectContaining({ content: expect.stringContaining('本文') })
    );
    h.unmount();
    view.destroy();
  });

  it('loadRestoreCandidate が復元候補を提示する', async () => {
    invokeMock.mockImplementation((cmd) => {
      if (cmd === 'read_autosave') {
        return Promise.resolve({ content: '未保存の内容', room: null, path: null });
      }
      return Promise.resolve(null);
    });
    const apiRef: HarnessProps['apiRef'] = { current: null };
    const h = renderHarness({
      apiRef,
      getView: () => null,
      getRestoreEnabled: () => true
    });
    await act(async () => {
      await apiRef.current!.loadRestoreCandidate();
    });
    expect(invokeMock).toHaveBeenCalledWith('read_autosave');
    expect(h.candidate()).toBe('yes');
    expect(apiRef.current!.isDirty()).toBe(false);
    h.unmount();
  });
});
