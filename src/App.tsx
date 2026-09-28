import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { EditorView } from 'prosemirror-view';
import { TextSelection } from 'prosemirror-state';
import { Editor } from './components/Editor';
import { Toolbar } from './components/Toolbar';
import { CollaborationPanel } from './components/CollaborationPanel';
import { StatusBar } from './components/StatusBar';
import { applyFormat, createEditorState } from './lib/prosemirror/editor';
import { insertImageAt } from './lib/prosemirror/image';
import { bumpDocumentVersion } from './lib/document/version';
import { baseName, dirName, stem as stemOfPath, relativePath, toFileUri } from './lib/path';
import { ipc } from './lib/ipc';
import { useAutosave, serializeView } from './hooks/useAutosave';
import { useCollabSession } from './hooks/useCollabSession';
import { useDocumentActions, useStartupFile, UNTITLED } from './hooks/useDocumentActions';
import { SettingsPanel } from './components/SettingsPanel';
import { RightPane } from './components/RightPane';
import { MenuDropdown } from './components/MenuDropdown';
import { ExtensionHost } from './lib/plugins/extensionHost';
import { PluginManagerPanel } from './components/PluginManagerPanel';
import { PluginManager } from './lib/plugins/manager';
import { WorkerRuntime } from './lib/plugins/workerRuntime';
import { installedManifest } from './lib/plugins/info';
import type { RegisteredCommand } from './lib/plugins/commands';
import type { PluginPermission } from './lib/plugins/api';

function App() {
  const [showCollab, setShowCollab] = useState(false);
  const [showComments, setShowComments] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showPlugins, setShowPlugins] = useState(false);
  // 起動時の初期画面 (ロゴ + 新規作成/開く)。ファイルを開いたら閉じる
  const [showStartScreen, setShowStartScreen] = useState(true);
  // Markdownソース表示 (読み取り専用)
  const [markdownSource, setMarkdownSource] = useState<string | null>(null);
  const [mdCopied, setMdCopied] = useState(false);
  const [suggestedRoom, setSuggestedRoom] = useState<string | undefined>(undefined);
  // 前回保存していない内容の復元機能 (既定: 無効)
  const [restoreEnabled, setRestoreEnabled] = useState(false);
  const restoreEnabledRef = useRef(false);
  const getRestoreEnabled = useCallback(() => restoreEnabledRef.current, []);
  // 共同編集で表示する自分の名前 (設定値。空なら自動生成)
  const userNameRef = useRef('');
  const getUserName = useCallback(() => userNameRef.current, []);
  // 画像パスの記録方式 (設定値。ファイル選択からの挿入に適用)
  const imagePathModeRef = useRef('relative');
  // 行番号ガターの表示 (設定値。既定は表示)
  const [showLineNumbers, setShowLineNumbers] = useState(true);
  // エディタの文字サイズ・種類 (設定値)
  const [fontSizePx, setFontSizePx] = useState(14);
  const [fontFamily, setFontFamily] = useState('');

  const viewRef = useRef<EditorView | null>(null);
  const [editorReady, setEditorReady] = useState(false);
  const dirRef = useRef<string | null>(null);
  const pathRef = useRef<string | null>(null);
  const getView = useCallback(() => viewRef.current, []);
  // React.memo を維持するため prop の同一性を保つ
  const getDocDir = useCallback(() => dirRef.current, []);

  // 共同編集セッションの参照 (自動保存でルーム名を記録するため先に用意)
  const collabRef = useRef<ReturnType<typeof useCollabSession> | null>(null);
  const suggestedRoomRef = useRef<string | null>(null);
  suggestedRoomRef.current = suggestedRoom ?? null;
  // 保存するルーム名: 進行中のセッション → 開いている文書から決まる候補
  const getRoomName = useCallback(
    () => collabRef.current?.roomName || suggestedRoomRef.current,
    []
  );
  const getDocPath = useCallback(() => pathRef.current, []);

  // 文書のフォルダでシグナリングサーバを探し、あれば自動参加・なければルーム名を提案する
  const joinOrSuggest = useCallback(
    async (path: string, dir: string, preferredRoom?: string | null) => {
      const room = preferredRoom || stemOfPath(path);
      const found = await ipc.probeSignal(dir);
      if (found) {
        setShowCollab(true);
        await collabRef.current?.ensure(room, found.url, false);
        collabRef.current?.setRoleLabel('既存ホストに参加');
      } else {
        setSuggestedRoom(room);
      }
    },
    []
  );

  const autosave = useAutosave({ getView, getRoomName, getDocPath, getRestoreEnabled });

  // 復元機能の設定を読み込む。Editor の準備より遅れる場合があるため、
  // 有効だった場合はここで復元候補を読み直す (handleReady 時の読み込みは無効扱いで素通りする)
  // (autosave オブジェクトは毎レンダーで変わるため、安定な関数のみ依存する)
  const { loadRestoreCandidate, clearRestoreCandidate } = autosave;
  useEffect(() => {
    let cancelled = false;
    void ipc
      .getSettings()
      .then((s) => {
        if (cancelled) return;
        restoreEnabledRef.current = s.restoreEnabled;
        setRestoreEnabled(s.restoreEnabled);
        userNameRef.current = s.userName ?? '';
        imagePathModeRef.current = s.imagePathMode === 'absolute' ? 'absolute' : 'relative';
        setShowLineNumbers(s.lineNumbers ?? true);
        if (Number.isFinite(s.fontSize) && s.fontSize > 0) setFontSizePx(s.fontSize);
        setFontFamily(s.fontFamily ?? '');
        if (s.restoreEnabled) void loadRestoreCandidate();
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [loadRestoreCandidate]);

  // 復元機能の切り替え。無効化時は候補を破棄し、残っている自動保存データも消す
  const handleRestoreEnabledChange = useCallback(
    (enabled: boolean) => {
      void (async () => {
        await ipc.setRestoreEnabled(enabled);
        restoreEnabledRef.current = enabled;
        setRestoreEnabled(enabled);
        if (!enabled) {
          clearRestoreCandidate();
          await ipc.deleteAutosave().catch(() => {});
        } else {
          await loadRestoreCandidate();
        }
      })().catch(() => window.alert('設定の保存に失敗しました'));
    },
    [clearRestoreCandidate, loadRestoreCandidate]
  );

  // 自分の名前の変更 (設定パネルから。ref を先に更新して次の共同編集開始に反映)
  const handleUserNameChange = useCallback((name: string) => {
    userNameRef.current = name.trim();
  }, []);

  // 行番号表示の切り替え
  const handleLineNumbersChange = useCallback((enabled: boolean) => {
    void (async () => {
      await ipc.setLineNumbers(enabled);
      setShowLineNumbers(enabled);
    })().catch(() => window.alert('設定の保存に失敗しました'));
  }, []);

  // エディタの文字サイズ・種類の変更
  const handleEditorFontChange = useCallback((patch: { sizePx?: number; family?: string }) => {
    void (async () => {
      await ipc.setEditorFont(patch);
      if (patch.sizePx != null) setFontSizePx(patch.sizePx);
      if (patch.family != null) setFontFamily(patch.family);
    })().catch(() => window.alert('設定の保存に失敗しました'));
  }, []);

  // Ctrl+S で上書き保存 (ブラウザ既定の保存ダイアログを抑止。IME変換中は除く)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (
        (e.ctrlKey || e.metaKey) &&
        !e.shiftKey &&
        !e.altKey &&
        e.code === 'KeyS' &&
        !e.repeat &&
        !e.isComposing
      ) {
        e.preventDefault();
        e.stopPropagation();
        docRef.current?.saveCurrent(autosave.discardServerAutosave);
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [autosave.discardServerAutosave]);

  // 共同編集 (セッションのライフサイクルと診断表示)
  const collab = useCollabSession({
    getView,
    getDocDir,
    getUserName,
    onDocumentChanged: autosave.markDirty
  });
  collabRef.current = collab;

  // 未保存文書で共同編集を開始しようとしたときの保存促進モーダル
  const [showSavePrompt, setShowSavePrompt] = useState(false);

  // 共同編集が始まったら上部の共同編集パネルを自動で閉じる (状態は右端バッジで示す)
  const collabActiveRef = useRef(false);
  useEffect(() => {
    if (collab.active && !collabActiveRef.current) setShowCollab(false);
    collabActiveRef.current = collab.active;
  }, [collab.active]);

  // 文書操作 (新規/開く/保存/HTML出力/起動引数)
  const docRef = useRef<ReturnType<typeof useDocumentActions> | null>(null);
  const doc = useDocumentActions({
    getView,
    dirRef,
    pathRef,
    onBeforeOpen: () => collabRef.current?.stop(),
    onAfterOpen: (path, dir) => joinOrSuggest(path, dir)
  });
  docRef.current = doc;

  useStartupFile((path) => {
    setShowStartScreen(false);
    void docRef.current?.openByPath(path);
  });

  const getDocumentTitle = useCallback(() => docRef.current?.title ?? UNTITLED, []);
  const [editConfirm, setEditConfirm] = useState<{ summary: string; resolve: (ok: boolean) => void } | null>(
    null
  );
  const confirmPluginReplace = useCallback(
    (summary: string) =>
      new Promise<boolean>((resolve) => {
        setEditConfirm({
          summary,
          resolve: (ok) => {
            setEditConfirm(null);
            resolve(ok);
          }
        });
      }),
    []
  );
  // プラグインからの通知 (トースト表示・6秒で自動消去)
  const [notice, setNotice] = useState<{ id: number; message: string } | null>(null);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 6000);
    return () => clearTimeout(timer);
  }, [notice]);
  const notifyHuman = useCallback(
    (message: string) => setNotice({ id: Date.now(), message }),
    []
  );
  const [pluginResult, setPluginResult] = useState<{
    title: string; text: string; canReplace: boolean;
    resolve: (choice: 'insert' | 'replace' | 'cancel') => void;
  } | null>(null);
  const pluginResultPending = useRef(false);
  const pluginResultRef = useRef<{ pluginId: string; resolve: (choice: 'insert' | 'replace' | 'cancel') => void } | null>(null);
  const [pluginEditor, setPluginEditor] = useState<{ title: string; html: string; resolve: (value: string | null) => void } | null>(null);
  const pluginEditorRef = useRef<{ pluginId: string; resolve: (value: string | null) => void } | null>(null);
  const pluginEditorFrame = useRef<HTMLIFrameElement | null>(null);
  const showPluginResult = useCallback((pluginId: string, title: string, text: string, canReplace: boolean) => {
    if (pluginResultPending.current || pluginEditorRef.current) return Promise.reject(new Error('別のダイアログを表示中です'));
    pluginResultPending.current = true;
    return new Promise<'insert' | 'replace' | 'cancel'>((resolve) => {
      const finish = (choice: 'insert' | 'replace' | 'cancel') => {
        pluginResultRef.current = null;
        pluginResultPending.current = false;
        setPluginResult(null);
        resolve(choice);
      };
      pluginResultRef.current = { pluginId, resolve: finish };
      setPluginResult({ title, text, canReplace, resolve: finish });
    });
  }, []);
  const openPluginEditor = useCallback((pluginId: string, title: string, html: string) => {
    if (pluginEditorRef.current || pluginResultPending.current) return Promise.reject(new Error('別のダイアログを表示中です'));
    return new Promise<string | null>((resolve) => {
      const finish = (value: string | null) => {
        pluginEditorRef.current = null;
        setPluginEditor(null);
        resolve(value);
      };
      pluginEditorRef.current = { pluginId, resolve: finish };
      setPluginEditor({ title, html, resolve: finish });
    });
  }, []);
  useEffect(() => {
    if (!pluginEditor) return;
    const onMessage = (event: MessageEvent) => {
      if (event.source !== pluginEditorFrame.current?.contentWindow) return;
      const data = event.data as { type?: unknown; value?: unknown } | null;
      if (!data || data.type !== 'markink-editor-result' || typeof data.value !== 'string'
        || new TextEncoder().encode(data.value).byteLength > 2 * 1024 * 1024) return;
      pluginEditor.resolve(data.value);
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [pluginEditor]);
  const cancelPluginDialogs = useCallback((pluginId: string) => {
    if (pluginResultRef.current?.pluginId === pluginId) {
      pluginResultRef.current.resolve('cancel');
    }
    if (pluginEditorRef.current?.pluginId === pluginId) pluginEditorRef.current.resolve(null);
  }, []);
  const extensionHost = useMemo(
    () =>
      new ExtensionHost({
        getView,
        getTitle: getDocumentTitle,
        confirmEdit: (proposal) =>
          confirmPluginReplace(
            proposal.reason ?? 'プラグインが文書全体を置き換えようとしています。続けますか？'
          ),
        notify: (_pluginId, message) => notifyHuman(message),
        log: (pluginId, event) => ipc.writePluginLog(pluginId, event.level, event.message),
        getSetting: (pluginId, key) => ipc.pluginGetSetting(pluginId, key),
        setSetting: (pluginId, key, value) => ipc.pluginSetSetting(pluginId, key, value),
        requestJson: (pluginId, url, body, useApiKey, timeoutSecs) => ipc.pluginRequestJson(pluginId, url, body, useApiKey, timeoutSecs),
        prompt: (_pluginId, label, initialValue) => Promise.resolve(window.prompt(label, initialValue)),
        showResult: showPluginResult,
        openEditor: openPluginEditor,
        readPackageText: (pluginId, path) => ipc.pluginReadPackageText(pluginId, path),
        cancelDialogs: cancelPluginDialogs
      }),
    [getView, getDocumentTitle, confirmPluginReplace, notifyHuman, showPluginResult, openPluginEditor, cancelPluginDialogs]
  );
  const pluginCommands = useSyncExternalStore(
    extensionHost.commands.subscribe,
    extensionHost.commands.getSnapshot,
    extensionHost.commands.getSnapshot
  );
  const pluginManagerRef = useRef<PluginManager | null>(null);
  const [busyPlugins, setBusyPlugins] = useState<Record<string, number>>({});
  const runPluginCommand = useCallback(async (item: RegisteredCommand) => {
    setBusyPlugins((current) => ({ ...current, [item.pluginId]: (current[item.pluginId] ?? 0) + 1 }));
    try {
      await item.run();
    } finally {
      setBusyPlugins((current) => {
        const next = { ...current };
        if ((next[item.pluginId] ?? 0) <= 1) delete next[item.pluginId];
        else next[item.pluginId] -= 1;
        return next;
      });
    }
  }, []);
  const displayPluginCommands = useMemo(() => pluginCommands.map((item) => ({
    ...item, run: () => runPluginCommand(item)
  })), [pluginCommands, runPluginCommand]);
  const [pluginMenu, setPluginMenu] = useState<{ x: number; y: number } | null>(null);
  const pluginMenuRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!pluginMenu) return;
    const closeOutside = (event: MouseEvent) => {
      if (!pluginMenuRef.current?.contains(event.target as Node)) setPluginMenu(null);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setPluginMenu(null);
    };
    document.addEventListener('mousedown', closeOutside, true);
    document.addEventListener('keydown', closeOnEscape, true);
    return () => {
      document.removeEventListener('mousedown', closeOutside, true);
      document.removeEventListener('keydown', closeOnEscape, true);
    };
  }, [pluginMenu]);
  useEffect(() => {
    const onPluginShortcut = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.repeat || event.isComposing) return;
      const shortcut = `Mod-${event.shiftKey ? 'Shift-' : ''}${event.code}`;
      const command = pluginCommands.find((item) => item.command.shortcut === shortcut);
      if (!command) return;
      event.preventDefault();
      event.stopPropagation();
      void runPluginCommand(command).catch((error) => notifyHuman(String(error)));
    };
    document.addEventListener('keydown', onPluginShortcut, true);
    return () => document.removeEventListener('keydown', onPluginShortcut, true);
  }, [pluginCommands, notifyHuman, runPluginCommand]);
  const pluginManager = useMemo(() => new PluginManager({
    runtime: new WorkerRuntime((id, error) => {
      void pluginManagerRef.current?.fail(id, error);
      notifyHuman(`プラグイン ${id} が停止しました: ${error}`);
    }),
    createHostApi: (manifest, permissions) => extensionHost.createApi(manifest, permissions)
  }), [extensionHost, notifyHuman]);
  pluginManagerRef.current = pluginManager;
  const pluginRestoreStarted = useRef(false);
  useEffect(() => {
    if (!editorReady || pluginRestoreStarted.current) return;
    pluginRestoreStarted.current = true;
    void (async () => {
      try {
        const [installed, enabledIds] = await Promise.all([ipc.pluginList(), ipc.pluginEnabledIds()]);
        const enabled = new Set(enabledIds);
        for (const plugin of installed) {
          if (!enabled.has(plugin.id)) continue;
          try {
            const manifest = installedManifest(plugin);
            await pluginManager.enable(manifest, new Set(manifest.permissions as PluginPermission[]));
          } catch (error) {
            notifyHuman(`プラグイン ${plugin.id} を再開できません: ${String(error)}`);
          }
        }
      } catch (error) {
        notifyHuman(`プラグインの有効状態を復元できません: ${String(error)}`);
      }
    })();
  }, [editorReady, pluginManager, notifyHuman]);
  const handleReady = useCallback(
    (view: EditorView) => {
      viewRef.current = view;
      setEditorReady(true);
      void autosave.loadRestoreCandidate();
    },
    [autosave]
  );

  const handleFormat = useCallback((format: string, payload?: { href?: string }) => {
    if (!viewRef.current) return;
    // ショートカットからのリンクは URL を尋ねる (ツールバーは独自入力欄を持つ)
    if (format === 'link' && !payload?.href) {
      const href = window.prompt('リンク先URL:', 'https://');
      if (!href || !href.trim()) return;
      applyFormat(viewRef.current, format, { href: href.trim() });
      return;
    }
    // 画像挿入はファイル選択ダイアログを使う非同期フロー。
    // 画像（リンク）: コピーなし。設定で相対 (既定) /絶対を選択。
    // 画像（コピー）: assets/ へコピーして相対参照 (常に)。
    if (format === 'image-link' || format === 'image-copy') {
      void (async () => {
        try {
          const { open } = await import('@tauri-apps/plugin-dialog');
          const selected = await open({
            filters: [
              { name: '画像', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'] }
            ]
          });
          const filePath = Array.isArray(selected) ? selected[0] : selected;
          if (!filePath) return;
          const view = viewRef.current;
          if (!view) return;
          if (format === 'image-copy') {
            const dir = dirRef.current;
            if (!dir) {
              window.alert('画像をコピーするには先に文書を保存してください');
              return;
            }
            const bytes = await ipc.readFileBytes(filePath);
            const base = filePath.split(/[\\/]/).pop() || 'image.png';
            const rel = await ipc.writeAsset(dir, `${Date.now()}-${base}`, bytes);
            const v = viewRef.current;
            if (v) insertImageAt(v, null, rel);
            return;
          }
          if (imagePathModeRef.current === 'absolute') {
            insertImageAt(view, null, toFileUri(filePath));
            return;
          }
          const dir = dirRef.current;
          if (!dir) {
            window.alert('相対パスで参照するには先に文書を保存してください');
            return;
          }
          const rel = relativePath(dir, filePath);
          if (!rel) {
            window.alert('別ドライブのため絶対パスで挿入します');
            insertImageAt(view, null, toFileUri(filePath));
            return;
          }
          insertImageAt(view, null, rel);
        } catch (e) {
          window.alert(String(e));
        }
      })();
      return;
    }
    applyFormat(viewRef.current, format, payload);
  }, []);

  const handleToggleComments = useCallback(() => setShowComments((v) => !v), []);

  // ファイル名はウィンドウ枠 (タイトルバー) に表示する
  useEffect(() => {
    let cancelled = false;
    void import('@tauri-apps/api/window').then(({ getCurrentWindow }) => {
      if (cancelled) return;
      getCurrentWindow().setTitle(`${doc.title} - markink`).catch(() => {});
    });
    return () => {
      cancelled = true;
    };
  }, [doc.title]);

  return (
    <div className="app">
      {autosave.restoreCandidate != null && (
        <div className="restore-overlay" role="dialog" aria-modal="true" aria-labelledby="restore-title">
          <div className="restore-dialog">
            <h2 id="restore-title" className="restore-title">復元のお知らせ</h2>
            <p className="restore-message">
              前回、アプリが異常終了した際に編集中の内容が自動保存されています。
              復元しますか?
            </p>
            <pre className="restore-preview">{autosave.restoreCandidate.content.slice(0, 400)}</pre>
            {autosave.restoreCandidate.room && (
              <p className="restore-message">
                共同編集のルーム「{autosave.restoreCandidate.room}」も復元します。
              </p>
            )}
            <div className="restore-actions">
              <button
                className="btn btn-primary"
                onClick={() => {
                  const data = autosave.restoreCandidate;
                  if (!data) return;
                  autosave.clearRestoreCandidate();
                  autosave.discardServerAutosave();
                  void (async () => {
                    if (data.path) {
                      // 元のファイルとして復元し、共同編集のフォルダ情報も引き継ぐ
                      doc.loadMarkdown(data.content, baseName(data.path), data.path);
                      await joinOrSuggest(data.path, dirName(data.path) ?? '', data.room);
                      setShowStartScreen(false);
                      return;
                    }
                    doc.loadMarkdown(data.content, '復元した文書', null);
                    setShowStartScreen(false);
                    if (data.room) {
                      setSuggestedRoom(data.room);
                      setShowCollab(true);
                    }
                  })();
                }}
              >
                復元する
              </button>
              <button
                className="btn"
                onClick={() => {
                  autosave.clearRestoreCandidate();
                  autosave.discardServerAutosave();
                }}
              >
                破棄する
              </button>
            </div>
          </div>
        </div>
      )}

      {editConfirm && (
        <div className="restore-overlay" role="dialog" aria-modal="true" aria-labelledby="edit-confirm-title">
          <div className="restore-dialog">
            <h2 id="edit-confirm-title" className="restore-title">文書編集の確認</h2>
            <p className="restore-message">{editConfirm.summary}</p>
            <div className="restore-actions">
              <button className="btn btn-primary" onClick={() => editConfirm.resolve(true)}>
                許可する
              </button>
              <button className="btn" onClick={() => editConfirm.resolve(false)}>
                拒否する
              </button>
            </div>
          </div>
        </div>
      )}

      <header className="app-header">
        <div className="app-actions">
          <MenuDropdown
            label="ファイル"
            title="ファイル操作"
            buttonClassName="btn"
            items={[
              {
                id: 'new',
                label: '新規作成',
                onSelect: () => doc.newDocument(autosave.discardServerAutosave)
              },
              {
                id: 'open',
                label: '開く',
                onSelect: () => void doc.openDialog()
              },
              {
                id: 'save',
                label: '保存',
                onSelect: () => doc.saveCurrent(autosave.discardServerAutosave)
              },
              {
                id: 'save-as',
                label: '名前を付けて保存',
                onSelect: () => void doc.saveAs(autosave.discardServerAutosave)
              },
              {
                id: 'export-html',
                label: 'HTML出力',
                onSelect: () => void doc.exportHtml()
              }
            ]}
          />
          <button
            className="btn"
            onClick={() => {
              const md = serializeView(viewRef.current);
              if (md == null) {
                notifyHuman('エディタが準備できていません');
                return;
              }
              setMdCopied(false);
              setMarkdownSource(md);
            }}
          >
            Markdown表示
          </button>
          <button className="btn" onClick={() => setShowCollab((v) => !v)}>共同編集</button>
          <button className="btn" onClick={() => setShowSettings((v) => !v)}>設定</button>
          <button className="btn" onClick={() => setShowPlugins((v) => !v)}>プラグイン</button>
        </div>
        <div className="app-status">
          {Object.keys(busyPlugins).map((id) => (
            <button key={id} className="btn" title={`${id} を停止`} onClick={() => {
              void (async () => {
                await ipc.pluginSetEnabled(id, false);
                await pluginManagerRef.current?.disable(id);
              })().catch((error) => notifyHuman(String(error)));
            }}>{id} · 停止</button>
          ))}
          {collab.active && (
            <span className="app-status-badge collab" title="共同編集中">
              共同編集中 ({collab.peers.length}人)
            </span>
          )}
        </div>
      </header>

      <Toolbar
        onFormat={handleFormat}
        showComments={showComments}
        onToggleComments={handleToggleComments}
        extensionCommands={displayPluginCommands}
      />

      {showCollab && (
        <CollaborationPanel
          active={collab.active}
          roomName={collab.roomName}
          suggestedRoom={suggestedRoom}
          positionLabel={collab.roleLabel ?? undefined}
          peers={collab.peers}
          diagnostics={collab.diagnostics}
          showCursors={collab.showCursors}
          onShowCursorsChange={collab.setShowCursors}
          onStart={(opts) => {
            // 未保存の文書には .mdnotepad フォルダ (合流地点) が無いため先に保存させる
            if (!pathRef.current) {
              setShowSavePrompt(true);
              return;
            }
            void collab.ensure(opts.roomName, opts.signalingUrl).catch((e) => window.alert(String(e)));
          }}
          onStop={() => {
            const view = viewRef.current;
            void collab.stopAndExtractMarkdown().then((markdown) => {
              if (view && markdown != null) {
                // 結合結果で文書を置換するため、版を明示的に進める
                view.updateState(createEditorState(markdown));
                bumpDocumentVersion(view.state.doc);
              }
            });
          }}
        />
      )}

      {showSettings && (
        <SettingsPanel
          restoreEnabled={restoreEnabled}
          onRestoreEnabledChange={handleRestoreEnabledChange}
          onUserNameChange={handleUserNameChange}
          lineNumbers={showLineNumbers}
          onLineNumbersChange={handleLineNumbersChange}
          fontSizePx={fontSizePx}
          fontFamily={fontFamily}
          onEditorFontChange={handleEditorFontChange}
          onClose={() => setShowSettings(false)}
        />
      )}

      {pluginResult && (
        <div className="restore-overlay" role="dialog" aria-modal="true" aria-labelledby="plugin-result-title">
          <div className="restore-dialog settings-dialog">
            <h2 id="plugin-result-title" className="restore-title">{pluginResult.title}</h2>
            <pre className="settings-dialog-code plugin-result-pre">{pluginResult.text}</pre>
            <div className="restore-actions">
              <button className="btn btn-primary" onClick={() => pluginResult.resolve('insert')}>挿入</button>
              {pluginResult.canReplace && <button className="btn" onClick={() => pluginResult.resolve('replace')}>選択範囲を置換</button>}
              <button className="btn" onClick={() => pluginResult.resolve('cancel')}>閉じる</button>
            </div>
          </div>
        </div>
      )}

      {pluginEditor && (
        <div className="restore-overlay" role="dialog" aria-modal="true" aria-labelledby="plugin-editor-title">
          <div className="restore-dialog plugin-editor-dialog">
            <h2 id="plugin-editor-title" className="restore-title">{pluginEditor.title}</h2>
            <iframe
              ref={pluginEditorFrame}
              title={pluginEditor.title}
              sandbox="allow-scripts"
              referrerPolicy="no-referrer"
              srcDoc={`<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' blob:; style-src 'unsafe-inline' blob:; img-src data: blob:; connect-src 'none'; form-action 'none'">${pluginEditor.html}`}
            />
            <div className="restore-actions"><button className="btn" onClick={() => pluginEditor.resolve(null)}>キャンセル</button></div>
          </div>
        </div>
      )}

      {showPlugins && <PluginManagerPanel manager={pluginManager} onClose={() => setShowPlugins(false)} />}

      <main className="app-main" onContextMenu={(event) => {
        if (!(event.target instanceof Element) || !event.target.closest('.ProseMirror')) return;
        if (!pluginCommands.some((item) => item.command.contextMenu)) return;
        event.preventDefault();
        const view = viewRef.current;
        const position = view?.posAtCoords({ left: event.clientX, top: event.clientY })?.pos;
        if (view && position != null && view.state.selection.empty) {
          const selection = TextSelection.near(view.state.doc.resolve(position));
          view.dispatch(view.state.tr.setSelection(selection));
        }
        setPluginMenu({ x: event.clientX, y: event.clientY });
      }}>
        <Editor
          onReady={handleReady}
          onChange={autosave.markDirty}
          getDocDir={getDocDir}
          showComments={showComments}
          showLineNumbers={showLineNumbers}
          fontSizePx={fontSizePx}
          fontFamily={fontFamily}
          onFormatText={handleFormat}
        />
        <RightPane
          getView={getView}
          peers={collab.peers}
          collabActive={collab.active}
        />
      </main>

      {pluginMenu && (
        <div ref={pluginMenuRef} className="plugin-context-menu" style={{ position: 'fixed', left: Math.min(pluginMenu.x, window.innerWidth - 270), top: Math.min(pluginMenu.y, window.innerHeight - 260), zIndex: 1000 }}>
          {pluginCommands.filter((item) => item.command.contextMenu).map((item) => (
            <button key={item.key} className="plugin-menu-item" onClick={() => {
              setPluginMenu(null);
              void runPluginCommand(item).catch((error) => notifyHuman(String(error)));
            }}>{item.command.title}</button>
          ))}
          <button className="plugin-menu-item" onClick={() => setPluginMenu(null)}>閉じる</button>
        </div>
      )}

      <StatusBar
        path={doc.path}
        collabActive={collab.active}
        peersCount={collab.peers.length}
        diagnostics={collab.diagnostics}
      />

      {showStartScreen && (
        <div className="start-screen" role="dialog" aria-label="はじめに">
          <img src="/markink-splash.svg" alt="markink" className="start-logo" />
          <div className="start-actions">
            <button
              className="btn btn-primary btn-large"
              onClick={() => {
                doc.newDocument(autosave.discardServerAutosave);
                setShowStartScreen(false);
              }}
            >
              新規作成
            </button>
            <button
              className="btn btn-large"
              onClick={() => {
                void (async () => {
                  await doc.openDialog();
                  if (pathRef.current) setShowStartScreen(false);
                })();
              }}
            >
              開く
            </button>
          </div>
        </div>
      )}

      {showSavePrompt && (
        <div className="restore-overlay" role="dialog" aria-modal="true" aria-labelledby="save-prompt-title">
          <div className="restore-dialog">
            <h2 id="save-prompt-title" className="restore-title">保存が必要です</h2>
            <p className="restore-message">共同編集を始める前に保存してください。</p>
            <div className="restore-actions">
              <button
                className="btn btn-primary"
                onClick={() => {
                  setShowSavePrompt(false);
                  void doc.saveAs(() => {
                    autosave.discardServerAutosave();
                    const p = pathRef.current;
                    if (p) setSuggestedRoom(stemOfPath(p));
                  });
                }}
              >
                名前を付けて保存
              </button>
              <button className="btn" onClick={() => setShowSavePrompt(false)}>
                キャンセル
              </button>
            </div>
          </div>
        </div>
      )}

      {markdownSource != null && (
        <div className="restore-overlay" role="dialog" aria-modal="true" aria-labelledby="md-source-title">
          <div className="restore-dialog settings-dialog">
            <h2 id="md-source-title" className="restore-title">Markdownソース (読み取り専用)</h2>
            <pre className="settings-dialog-code plugin-result-pre">{markdownSource}</pre>
            <div className="restore-actions">
              <button
                className="btn"
                onClick={() => {
                  void navigator.clipboard
                    ?.writeText(markdownSource)
                    .then(() => setMdCopied(true))
                    .catch(() => notifyHuman('コピーに失敗しました'));
                }}
              >
                {mdCopied ? 'コピーしました' : 'コピー'}
              </button>
              <button className="btn btn-primary" onClick={() => setMarkdownSource(null)}>
                閉じる
              </button>
            </div>
          </div>
        </div>
      )}

      {notice && (
        <div className="plugin-toast" role="status" key={notice.id}>
          <span className="plugin-toast-name">プラグイン</span>
          <span>{notice.message}</span>
        </div>
      )}
    </div>
  );
}

export default App;
