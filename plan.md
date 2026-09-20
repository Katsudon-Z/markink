# markink 開発計画

## 0. 前提確認
requirements.md 9章のリアルタイム共同編集は、2026-09-14時点の確認で「本体拡張・未実装」表記が削除され、本体に組み込む要件と明確化された。
本計画では、ユーザーの要請に従い初期版スコープに**リアルタイム共同編集を必須機能**として含める。

## 1. プロジェクト概要
製品名: markink  
目的: プログラミング経験がない人でも Word 的な操作で Markdown (.md) を作成・編集できる Windows 専用デスクトップアプリ。初期版からリアルタイム共同編集対応  
主要技術: Tauri + ProseMirror + Yjs/WebRTC

## 2. 要件サマリー
- OS: Windows 10/11 64bit のみ（requirements.md:39,94）
- 配布形態: 管理者権限不要のポータブル配布、USB/ネットワークドライブ対応（requirements.md:87-89,101）
- オフライン完結: 初回起動後もインターネット不要、基本機能はローカル完結（requirements.md:40-42,102）
- WYSIWYG 編集: ProseMirror による見たまま編集、GFM 互換（requirements.md:96）
- リアルタイム共同編集: SMB共有上の単一文書を WebRTC DataChannel + Yjs で同期。LAN/VPN 内最大5端末、SMB 3 系前提。初期版から必須（requirements.md:106-114）
- パフォーマンス目標:
  - 起動から編集可能まで 3秒以内（requirements.md:44）
  - 5MB 約5万文字を目立つ遅延なく編集（requirements.md:45）
  - 入力・書式変更・Undo/Redo は 100ms 以内反応（requirements.md:46）
- 非機能: 自動保存、異常終了時の復元提案、IME 対応、日本語 UI、アクセシビリティ（requirements.md:48,50,31,35）

## 3. アーキテクチャ

### 3.1 全体構成
```
markink (Tauri)
├─ Frontend (WebView)
│  ├─ ProseMirror Editor (WYSIWYG)
│  ├─ Toolbar (アイコン版、ツールチップ付き)
│  ├─ App Bar / File Dialog
│  └─ Markdown → ProseMirror ↔ Markdown 変換層
└─ Backend (Rust)
   ├─ ファイル I/O (単一 .md + assets フォルダ)
   ├─ 自動保存 / 復元
   ├─ 画像ドラッグ&ドロップ処理
   └─ ポータブル配布設定
```

### 3.2 主要コンポーネント
- **Tauri**: Windows 専用ネイティブシェル、軽量起動、ポータブル配布対応（requirements.md:74）
- **ProseMirror**: WYSIWYG 編集コア、スキーマは GFM に準拠（requirements.md:75,98）
- **Markdown シリアライザ**: prosemirror-markdown + 拡張 (GFM 表、チェックリスト、コードブロック)
- **Yjs + WebRTC**: 共同編集必須機能。SMB 上の文書を Yjs で管理し WebRTC DataChannel でリアルタイム同期。シグナリングサーバー設定、STUN/TURN 初期無効（requirements.md:114）
- **ファイル管理**: 
  - 単一文書 .md（requirements.md:104）
  - 画像は隣接 assets/ フォルダに保存、Markdown 内は相対パス参照
  - 自動保存はローカル一時領域、共同編集補助データも SMB 上で管理（requirements.md:112）

## 4. 開発フェーズ

### Phase 1: プロジェクト初期化と基盤 (Week 1)
- [ ] Tauri プロジェクト作成 (Windows ターゲット) - requirements.md:94
- [ ] ProseMirror 編集器の基本セットアップ、GFM スキーマ実装
- [ ] Yjs + ProseMirror 連携初期設定、共同編集コア実装開始 - requirements.md:110
- [ ] 基本ツールバー UI 実装 (アイコン版、ツールチップ、日本語アクセシブル名) - requirements.md:31
- [ ] デザイン反映: design/markdown-editor.svg をベースにレイアウト - requirements.md:35
- [ ] 新規作成/ファイル開く画面の初期表示実装 - requirements.md:30
- テスト: 起動時間測定、空文書表示確認、ローカル編集動作。自動テスト必須（requirements.md:83）

### Phase 2: ファイル入出力と自動保存 (Week 2)
- [ ] ファイルオープン/新規作成ダイアログ
- [ ] Markdown → ProseMirror パース / ProseMirror → Markdown シリアライズ - requirements.md:61
- [ ] 保存処理、assets フォルダ自動生成 - requirements.md:57
- [ ] ドラッグ&ドロップ画像対応 (ローカル保存 + 相対パス埋め込み) - requirements.md:57
- [ ] 自動保存間隔設定、復元提案ロジック - requirements.md:48
- [ ] Undo/Redo キーバインド (Ctrl+Z / Ctrl+Y) - requirements.md:46
- [ ] SMB 共有検出、共同編集セッション開始/参加 UI 実装 - requirements.md:113
- テスト: 5MB 文書ロード時間、保存・復元動作確認。自動テスト必須

### Phase 3: UX 改善とパフォーマンス最適化 (Week 3)
- [ ] 空文書時の入力例表示 - requirements.md:32
- [ ] IME 入力テスト - requirements.md:50
- [ ] パフォーマンスチューニング: 大文書でのレンダリング最適化、仮想化検討 - requirements.md:45-46
- [ ] エラーメッセージの日本語化・行動指示付き - requirements.md:34
- [ ] アクセシビリティ: キーボード操作、フォーカス管理、全操作をメニューから実行可能 - requirements.md:33
- [ ] 起動時間 3秒以内確認 - requirements.md:44
- テスト: 5万文字編集テスト、100ms 反応目標測定。自動テスト必須

### Phase 4: 出力と配布準備 (Week 4)
- [ ] HTML エクスポート機能 - requirements.md:103
- [ ] ポータブル配布ビルド設定 - requirements.md:87-89,100
- [ ] ローカルドライブ/USB/ネットワークドライブからの起動確認 - requirements.md:88,101
- [ ] 初回起動ガイド、日本語ヘルプ同梱 - requirements.md:43
- テスト: 異常終了後の復元提案、ポータブル配布テスト。自動テスト必須

### Phase 5: 共同編集安定化 (Week 5)
- [ ] SMB 共有検出と文書同期設定 UI 完成 - requirements.md:112
- [ ] Yjs + WebRTC DataChannel 実装完了、シグナリングサーバー接続設定 - requirements.md:114
- [ ] 参加者表示、カーソル共有、変更ハイライト実装
- [ ] 共同編集時の衝突解決テスト、5端末同時編集検証 - requirements.md:111
- [ ] 権限不足時のガイド表示、接続エラー時の案内整備 - requirements.md:113
- テスト: LAN内複数端末でのリアルタイム同期確認、SMB権限チェック。自動テスト必須

## 5. 主要技術選定理由
- **Tauri**: 軽量、ポータブル配布容易、Windows 専用最適化 - requirements.md:74
- **ProseMirror**: 実績ある WYSIWYG コア、スキーマ拡張性、GFM 対応が成熟 - requirements.md:75,98
- **Yjs**: CRDT による衝突解決、WebRTC との相性良好 - requirements.md:77
- **WebRTC DataChannel**: LAN 内 P2P 同期、インターネット不要 - requirements.md:76

## 6. リスクと対策
- 大文書パフォーマンス → ProseMirror のプラグイン最適化、デバウンス処理 - requirements.md:45-46
- Markdown ↔ ProseMirror 変換ロス → GFM 厳密対応、テストケース充実 - requirements.md:96
- IME 入力問題 → 日本語入力テストを継続的に実施 - requirements.md:50
- ポータブル配布時の権限エラー → ネットワークドライブ実行テスト - requirements.md:88,101
- WebRTC 接続失敗/NAT 越え → 組織内シグナリング前提の明文化、接続診断 UI - requirements.md:114
- SMB 共有権限不足 → 初回起動時権限チェックと案内 - requirements.md:113

## 7. テスト計画
- 自動テスト必須: 各タスク完了時にテスト実行
- 単体テスト: Markdown パーサー、シリアライザ、ファイル I/O
- 統合テスト: 編集→保存→再読込の整合性
- パフォーマンステスト: 起動時間、5MB 文書編集、100ms 反応
- ユーザビリティテスト: 初心者操作シナリオ

## 8. 成果物
- plan.md (本計画書)
- Tauri プロジェクトソース
- ビルド済みポータブル配布パッケージ
- テストスイート
- ユーザーマニュアル (日本語)

## 9. 次のアクション
Phase 1 のプロジェクト初期化を開始。Tauri + ProseMirror + Yjs/WebRTC の最小構成を作成し、デザインに準拠したツールバーと共同編集セッション開始 UI を並行して実装する。
製品名は markink に統一 - requirements.md:94
