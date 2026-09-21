# markink AI共同編集 (MCPサーバ) 開発計画

対象要件: requirements.md 第10章 (AI共同編集)
前提: リアルタイム共同編集 (9章) は実装済み。Yjs + Awareness + ProseMirror プラグインで参加者カーソルを表示中。

## 1. 目標

- markink 本体が **MCPサーバ** となり、AI客户端 (Claude Desktop / Cursor / opencode など) が **人間参加者と同じ立場** で編集中ドキュメントを閲覧・編集できる。
- AI の編集は人間の画面へリアルタイム反映され、**カーソル名ラベルには AI 名** (例: `AI: Claude Desktop`) を表示する。
- 同時参加は **AI 1本限定**。追加の接続は拒否する。
- 通信は **localhost のみ**。アプリ自身はインターネットへ文書を送らない (非機能要件 40-42, 49 を維持)。

## 2. アーキテクチャ

```
AI客户端 (Claude Desktop 等)
  │ ①stdio: markink.exe mcp-stdio … stdin/stdout JSON-RPC (別プロセスだが「管」だけ)
  │ ②HTTP:  POST http://127.0.0.1:42110/mcp (+任意トークン)
  ▼
Rust バックエンド (GUI プロセス)  src-tauri/src/mcp/   ← MCP プロトコルとセッションの本体
  ├─ mod.rs         ライフサイクル (有効化/無効化・localhost のみ bind・ポート発行 42110-42119)
  ├─ proto.rs       JSON-RPC 2.0 / MCP プロトコル (initialize, tools/list, tools/call, ping) ※I/O 無し
  ├─ connection.rs  AI接続の単一スロット状態機 (待機/接続中+AI名/2本目拒否) ※I/O 無し
  ├─ catalog.rs     ツール定義の読み込み (shared/mcp-tools.json を include_str!)
  ├─ transport_http.rs      localhost HTTP エンドポイント (POST /mcp のみ)
  ├─ transport_ws.rs        対 stdioブリッジ用 localhost WS (/mcp-bridge, トークン照合)
  ├─ transport_stdio.rs     mcp-stdio モード本体 (stdio ⇄ WS の素通し。ロジック持たない)
  └─ gateway.rs     フロントエンド実行部への RPC (emit mcp:request / command mcp_response)
  │                 依存方向: transport_* → proto → connection → catalog / gateway (一方向)
  ▼ Tauri event / command (Rust⇄フロントの唯一の境界)
フロントエンド  src/lib/mcp/ + src/hooks/
  ├─ useMcpBridge.ts  mcp:request を購読し tool を実行。EditorView 可用時のみ有効
  ├─ tools.ts         ツール実装 (get/search/insert/replace/outline/save…)。view.dispatch 以外しない
  ├─ document.ts      PM 位置計算・Markdown 断片解析 (markdownParser 再利用)
  └─ presence.ts      AI プレゼンス制御 (専用カーソル装飾プラグイン。両モード共通)
       ├─ 共通: AI カーソルは自前プラグインで描画 (.mdn-collab-cursor と同系)。人間の selection は動かさない
       ├─ セッション中: AI 位置を Awareness の `ai` フィールドへミラー (`user` は上書き禁止!)
       │              → 他端末の同じプラグインがリモート AI カーソルとして描画
       └─ 単独編集時:  ローカル描画のみ
  ▼
編集経路 (MCP は Y.Doc を直接触らない):
  tool handler → view.dispatch (人間入力と同一の経路)
    → 共同編集セッション中: y-prosemirror が Y.Doc へ反映 → WebRTC/WS中継で他端末へ同期
    → 単独編集: ProseMirror history のみ (人間の Ctrl+Z で取消可、自動保存は既存発火)
```

### 2.0 実装上の重要事実 (コード確認済みの前提)

- **Y.Doc / Awareness は共同編集セッション中しか存在しない** (`session.ts` / `useCollabSession`)。単独編集の AI 編集・カーソルは ProseMirror のみで完結させる。だから「AI は Yjs 文書に直接書く」という経路を作らない (上記 dispatch 一本化)。
- **Awareness のローカル状態は Y.Doc クライアント単位で 1 つ**。人間と AI は同一アプリ内で同じクライアントを共有するため、AI が `user` フィールドを書くと人間自身のカーソル名ラベルが全端末で上書きされる。→ AI は専用フィールド `ai: {name, color, anchor, head}` を使い、描画は yCursorPlugin ではなく自前の装飾プラグインで行う (人間の `user` / yCursorPlugin は無変更)。
- `settings.json` / エンドポイントファイル (`mcp.json`: 実ポート+トークン) は **AppHandle 無しで解決できるパス** (`%LOCALAPPDATA%/<identifier>/`) に置く。stdio サブプロセスには Tauri が無いため、AppHandle 依存のパス API を使えない。
- セッション開始/終了/カーソル切替で `view.updateState(createCollabEditorState(...))` によりプラグイン一式が再構築される。**AI カーソルは yCursorPlugin 側 (awareness) とローカル装飾プラグイン側の 2 経路**になり、再構築後もプレゼンスが復元される責務を presence.ts が持つ。
- `collab_host.rs` の既存 WS サーバは **0.0.0.0:42100 (LAN 向け)**。MCP は別ポート・別 bind (127.0.0.1 限定) で、既存 signaling 経路 (`handle_client` の path 分岐) に `/mcp` を足す設計は **採らない** (LAN 開放とホスト中のみ稼働という 2 つの要件違反になる)。
- stdio モードは単一実装ファイルの第 2 エントリポイント。`lib.rs::run()` の先頭 (single-instance プラグイン登録**前**) で argv 判定し、`transport_stdio::run()` して return する。判定を後ろに置くとシングルインスタンスプラグインが既存ウィンドウへ引数を渡して終了し、stdio が死んだままになる。
- AI 名は MCP `initialize` の `clientInfo.name` / `title` から採る (proto.rs) → connection.rs が保持 → gateway 経由でフロントへ `mcp:connected{name}` を通知し、presence.ts がラベルに使う。

### 2.1 モジュール境界のチェックルール

- proto.rs / connection.rs は純状態機械とし、テストは socket 無しで成立させる (transport からの入力は文字列/メッセージのみ)。
- gateway.rs は `EditorGateway` トレイトに抽象化し、Tauri が無い環境でもモックで tools/call まで通せるようにする。
- ツール一覧は Rust (tools/list 応答) と TS (実装) の二重定義にしない。**共有ファイル `shared/mcp-tools.json` を単一の定義**とし、Rust は include_str! で tools/list に使う。CI で「JSON の名前集合 = TS レジストリの名前集合」を検証するテストを置く (vitest + rust test 両側)。
- 保存・自動保存・タイトル更新は既存のフロント保存フロー (useDocumentActions) のみを介す。Rust から document::write_markdown を直接叩く MCP 経路は作らない。
- 「セッション」語の衝突回避: MCP 接続状態 = **connection**、Yjs 共同編集 = session のまま (Rust 側は connection.rs / フロント側は useMcpBridge)。
- 権限の切り分け: レート・サイズ上限 = Rust (transport 前)。確認ダイアログ (全文置換) / aiAutoSave ガード = フロント (tool handler 内)。AI がファイルシステムやネットワークへ直接アクセスする口は作らない (要件 10.5)。

## 3. MCP ツール仕様

座標系は **ProseMirror 絶対位置** (整数)。編集系ツールは適用後の範囲 `{from,to}` を返し、AI は `get_document` / `search` / `get_outline` から座標を得て連鎖する前提。

| ツール | 引数 | 戻り値 | 備考 |
|---|---|---|---|
| `get_document` | なし | `{title, path, dirty, markdown}` | 5MB 超は先頭 + 注記で切詰め |
| `search` | `{query, regex?, caseSensitive?, maxResults?}` | `{matches:[{from,to,excerpt}]}` | 位置の決定に使う |
| `get_outline` | なし | `{headings:[{level,text,pos}]}` | 見出しツリー |
| `insert_text` | `{position, markdown}` | `{from,to}` | Markdown 断片をパースして挿入 (見出し・リスト・表可) |
| `replace_range` | `{from, to, markdown}` | `{from,to}` | 範囲が文書全体を覆う場合は人間に確認ダイアログ (10.4 安全策) |
| `replace_all` | `{search, replacement, caseSensitive?}` | `{replaced}` | テキストノード単位。表ヘッダーも対象 |
| `apply_markdown` | `{anchor: {position} \| {heading} \| {end}, markdown}` | `{from,to}` | 見出し直下・文末など意味的挿入点 |
| `set_heading` | `{position, level}` | `{ok}` | level=0 で段落に戻す |
| `set_cursor` | `{from, to?}` | `{from,to}` | AI カーソル (装飾) 移動 + 任意スクロール。**人間の selection は動かさない** |
| `get_cursor` | なし | `{from,to,ai}` | 編集中カーソル (AI の最終位置) |
| `save_document` | なし | `{path}` | 既存保存処理を呼ぶ。AI 自動保存 OFF 設定時はエラー |
| `notify_human` | `{message}` | `{ok}` | ステータス表示 / 簡易トースト |

制約:
- 単一呼出しのサイズ上限 (挿入 Markdown 512KB まで)、1 秒あたり呼出し数制限 (レート制限)。超過は明確なエラーメッセージを返す。
- 接続直後の `initialize` で `clientInfo.name` / `title` を取得し、AI 名 (`AI: <title or name>`) とカーソル色 (紫 `#7c3aed`、人間と衝突しない配色) を確定する。

## 4. 開発フェーズ

### M1: MCP 基盤 (Rust)
- `mcp/proto.rs`: JSON-RPC 2.0 のパース / 生成、MCP handshake (clientInfo 抽出)、tools/list 組み立て。**I/O 無し・純粋**。
- `mcp/connection.rs`: AI接続スロットの状態機。待機中 → 接続中 (AI名) → 切断で待機。2本目の `initialize` は拒否。**I/O 無し・純粋**。
- `mcp/catalog.rs` + `shared/mcp-tools.json`: ツール定義の単一ソース (Rust: include_str! / TS: import。tsconfig に `resolveJsonModule` が必要なら追加)。
- `mcp/transport_stdio.rs`: エントリ分岐を `lib.rs::run()` の先頭 (single-instance **登録前**) に置く。接続先 (GUI プロセスの localhost WS) がない場合は原因付きエラーで終了。
- `mcp/transport_ws.rs`: 対 stdio ブリッジ用 WS (127.0.0.1、トークン照合、close でスロット解放)。
- 設定の永続化: `settings.rs` 新設 (`%LOCALAPPDATA%/<identifier>/settings.json`、AppHandle 無しで解決 = stdio プロセスからも読める。SMB に置かない)。`mcpEnabled`, `mcpToken`, `aiAutoSave`。エンドポイントファイル `mcp.json` (実ポート+トークン) も同じ場所へ。
- テスト: handshake / tools/list / 不正メッセージ / 2本目拒否 (connection.rs をモック駆動) + **GUI 起動中に `markink.exe mcp-stdio` を別プロセスで実行しても stdio が生き続ける回帰テスト** (手動)。

### M2: リクエストブリッジと読み取りツール
- `mcp/gateway.rs`: `EditorGateway` トレイト (async request → response)。実装は `mcp:request` emit → `mcp_response` 受信まで oneshot 待機 (タイムアウト 30 秒)。WebView 応答不可はエラー応答。proto/connection はモックゲートウェイでテスト可能にする。
- フロント `useMcpBridge.ts` + `tools.ts` 骨格 + `document.ts`。読み取り: `get_document`, `search`, `get_outline`, `get_cursor`。
- 接続通知: connection.rs → gateway → `mcp:connected{name}` emit → presence.ts へ AI 名を渡す。
- テスト: vitest で EditorView に対し各ツール関数の入出力を検証 (Markdown 往復は markdownSerializer 既定) + shared/mcp-tools.json と TS レジストリの名前集合一致テスト。

### M3: 編集ツールと Undo / 自動保存統合
- `insert_text`, `replace_range`, `replace_all`, `apply_markdown`, `set_heading`, `save_document`。
- Markdown 断片 → ノード変換は `markdownParser` を再利用 (コードブロック・表・コメント対応の検証)。
- 適用は `view.dispatch` + ProseMirror history。範囲が全文書を覆う置換は確認ダイアログ。
- 自動保存フック (useAutosave) が AI 編集でも発火すること。`aiAutoSave` OFF 時は `save_document` ツール拒否。
- テスト: 位置境界 (先頭 / 文末 / 表内 / リスト内)、全置換の確認フロー、undo 一連。

### M4: AIプレゼンス (カーソル・参加者表示)
- `presence.ts` を **プレゼンスコントローラ**として統一 (tools.ts はセッション有無で分岐しない):
  - **AI カーソルは自前の装飾プラグイン**で描画 (`.mdn-collab-cursor` 同系のマークアップ、紫 `#7c3aed`、ラベル `AI: <client>`)。人間の `state.selection` は一切動かさない。
  - セッション中: AI 位置を Awareness の専用フィールド `ai` にミラーし、他端末の同じプラグインがリモート AI カーソルを描画。**人間の `user` フィールドと yCursorPlugin には触れない** (上書きバグ防止)。
  - プラグインは `createBasePlugins` 経由で両モード (local/collab) に入るため、ensure / stop / setShowCursors の `view.updateState` 再構築でも自動で載る。AI 位置・名前の状態はプラグイン外のストア (presence.ts) が持ち、再構築後に decoration を再計算。
- 切断時: `mcp:disconnected` で装飾と `ai` フィールドをクリア。
- 参加者一覧 / ステータスバーに AI であることを示すバッジ (要件 10.6)。人間側カーソルと区別。
- `notify_human` ツール + 人間向けトースト表示。
- テスト: 名前ラベル描画、人間の `user` フィールドが AI 接続で不変であること、セッション開始/終了をまたいだ AI 表示の持続、セッションなし時の装飾、切断時のクリーンアップ。

### M5: HTTP トランスポート・セキュリティ・UI
- `transport_http.rs`: 127.0.0.1 固定 bind (ポート範囲 42120-42129)、POST /mcp のみ、必須 Bearer トークン、Mcp-Session-Id 発行・検証、ボディ上限 8MB、常時 Connection: close。**collab_host.rs (0.0.0.0:42100) とはモジュール・ポート・bind を完全分離** (既存 WS の path 分岐に `/mcp` を足さない)。
- `disconnect` ツールは Rust 側 (proto) で完結し、スロット解放 + HTTP セッション破棄を行う。フロントには転送しない (マニフェストには掲載し、TS 側の網羅テストでは例外扱い)。
- 放置タイムアウト: 30分無操作の接続は自動解放 (HTTP は切断検知ができないため。`ConnectionSlot` に実装)。
- 設定 UI (新規 `AiSettings` パネル): 有効化トグル、接続状態 (待機 / 接続中+AI名)、接続 URL / 設定スニペットのコピー、トークン再生成、接続解除、aiAutoSave。 ipc.ts に `mcpSetEnabled/mcpStatus/mcpRegenerateToken` を追加 (フロントは Tauri invoke を ipc 経由のみ)。
- 無効化中はサーバを stop しポートを閉じる。アプリ終了時は OS が回収。
- テスト: ループバック以外拒否 (bind 検証)、トークン不一致拒否、UI 状態遷移 (vitest / 実機確認)。

### M6: E2E 検証とドキュメント
- 接続手順書 (README or docs): Claude Desktop (`claude_desktop_config.json` に `markink.exe mcp-stdio`)、Cursor / opencode (stdio 共通)、HTTP 設定例。
- 実機検証: ①単独編集で AI 挿入 / 置換 / カーソル確認 ②2端末共同編集 + AI で AI 編集が他端末へ同期・AI ラベル表示 ③AI 編集を人間の Ctrl+Z で取消 ④2本目 AI 拒否 ⑤インターネット遮断環境で全機能。
- 性能: 5万文字文書で `get_document` / 編集適用の体感遅延を確認 (目標 <200ms 往復、長文の read は切詰め)。
- requirements.md との突合表 (未実装項目の明示)。

## 5. テスト方針 (要件 83: 自動テスト必須)

- **Rust 単体 / 統合**: JSON-RPC 境界値、プロトコルエラー応答、connection の 2 本目拒否、HTTP パーサ、stdio⇄WS 中継 (mock)、shared マニフェストと tools/list の一致。
- 前端単体 (vitest): ツールごとに実 EditorView を使い入力→doc / Markdown 出力を検証。位置計算 (全置換検出、表内カーソル)。
- 手動シナリオ: M6 の ①〜⑤ (テスト手順書へ記録)。
- CI 的に `npm test -- --run` と `cargo test --lib` が緑であること。

## 6. リスクと対策

- **Rust⇄WebView 往復の遅延・喪失**: request ID 照合 + タイムアウト + 保留中キャッシュなし (再接続で状態は文書そのもの)。100ms 目標に収まるか M2 で実測。
- **stdio とシングルインスタンスプラグインの衝突**: 判定順を間違えると 2 番目のプロセスが「2 重起動」として既存インスタンスに引数を渡して終了し、stdio が死ぬ。`run()` 先頭で argv 判定 → single-instance 登録前に branch。M1 に回帰手順を固定。
- **Yjs 不在の単独編集**: ツール・プレゼンスともに「セッション中有無」を presence.ts / view.dispatch 経由に隠蔽し、tools.ts が条件分岐を持たないようにする (境界ルール)。
- **位置の陳腐化**: AI が読んだ位置は編集で動く。CRDT で落ちないため実害は小さいが、ツール応答に常に新 `{from,to}` を含め、AI 側に「編集後に再取得」を tools description で促す。
- **AI 連打による描画負荷**: ブロック単位バッチ + レート制限 + 長文 read 切詰め (要件 45-47)。
- **IME / 編集中の状態**: 変換中はトランザクション適用を保留しない (composition は人間側のみ、Yjs 反映は通常)。既存 IME 対策 (composing ガード) と衝突しないか M3 で確認。
- **ポート衝突**: 42110 使用時は起動時リトライ (range 42110-42119) + 実ポートを UI 表示 / ポートファイル。

## 7. 完了条件 (Definition of Done)

1. 設定 ON + AI 接続で、AI が read / edit / cursor 全ツールを使いこなし、人間画面へリアルタイム反映される。
2. AI カーソルに `AI: <クライアント名>` が表示され、人間と色・ラベルで区別できる。
3. 2 本目の AI 接続が拒否され、UI に理由が出る。
4. AI 編集は人間の Ctrl+Z で取り消せ、自動保存 / 保存フローに乗る。
5. localhost 以外にポートを開放せず、無効時はサーバが動かない。
6. 全自動テストが緑、手動シナリオ①〜⑤の記録が揃う。