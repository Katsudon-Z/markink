# markink AI共同編集 (MCP) 接続手順書

markink 本体が MCPサーバになり、AIアシスタントが人間と同じように文書を読み書きします。
通信は PC 内部 (localhost) のみで完結し、文書がインターネットへ送信されることはありません。

## 1. 有効化 (markink 側)

1. markink を起動し、ヘッダーの「AI接続」ボタンを押す
2. 「有効化」を ON にする (ON の間だけ localhost で待ち受けます)
3. 状態が「待機中」になれば準備完了

## 2. 接続方法1: stdio (Claude Desktop など)

AIクライアントの設定ファイルに以下を登録します
(`command` は「AI接続」パネルに表示される設定スニペットをコピーしてください)。

```json
{
  "mcpServers": {
    "markink": {
      "command": "Z:\\Apps\\markink\\markink.exe",
      "args": ["mcp-stdio"]
    }
  }
}
```

クライアント別の設定ファイルの場所:

| クライアント | 設定ファイル |
|---|---|
| Claude Desktop | `%APPDATA%\Claude\claude_desktop_config.json` |
| Cursor | `%USERPROFILE%\.cursor\mcp.json` |
| Cline (VS Code) | 拡張機能の「MCP Servers」→「Configure MCP Servers」(`cline_mcp_settings.json`) |
| opencode | `opencode.json` の `mcp` に `"type": "local"` で登録 (下記参照) |

- `command` はお使いの `markink.exe` の実際のパスに置き換えてください
  (ローカルでもネットワークドライブでも可。例: `C:\Tools\markink\markink.exe`、`Z:\Apps\markink\markink.exe`)
  (JSON では `\` を `\\` と2重に書きます)
- 先に markink を起動して有効化しておく必要があります

## 3. 接続方法2: Streamable HTTP (opencode / Cursor など)

1. 「AI接続」パネルに表示される URL (例: `http://127.0.0.1:42120/mcp`) とトークンをコピー
2. AIクライアントの MCP 設定に URL を登録し、
   Authorization ヘッダに `Bearer <トークン>` を付けます
3. 作業終了時は `disconnect` ツールを呼ぶか、パネルの「切断する」で解放します
   (30分無操作でも自動解放されます)

### opencode からの接続例

`~/.config/opencode/opencode.json` (Windows では `%USERPROFILE%\.config\opencode\opencode.json`)
の `mcp` に追加します。設定後は opencode を再起動してください。

stdio 方式 (推奨。ポート番号の確認が不要です):

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "markink": {
      "type": "local",
      "command": ["Z:\\Apps\\markink\\markink.exe", "mcp-stdio"],
      "enabled": true
    }
  }
}
```

- `command` は配列形式、`markink.exe` は実際のパスに置き換えます (ローカルでもネットワークドライブでも可。JSON では `\` を `\\` と書きます)
- 先に markink を起動して「AI接続」を有効化しておく必要があります
  (未起動のまま接続すると、その旨のエラーで終了します)

HTTP 方式 (パネルに表示される URL・トークンを使います):

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "markink": {
      "type": "remote",
      "url": "http://127.0.0.1:42120/mcp",
      "headers": { "Authorization": "Bearer {env:MARKINK_MCP_TOKEN}" },
      "oauth": false,
      "enabled": true
    }
  }
}
```

- `MARKINK_MCP_TOKEN` 環境変数にパネルのトークンを設定します (設定ファイルへの直書きを避けるため)
- `oauth: false` は、トークン方式なのに OAuth フローへ誘導されるのを防ぐための指定です
- ポート (上例の 42120) は起動ごとに変わることがあるため、パネルで確認してください

## 4. 使い方の目安

- AI は `get_document` / `search` / `get_outline` で内容と位置を確認してから編集します
- 編集は人間の入力と同じ経路で反映され、共同編集中は他の端末にも同期されます
- AI のカーソルには `AI: <クライアント名>` の紫ラベルが付きます
- 文書全体の置換は人間の確認ダイアログが出ます (許可/拒否)
- AI の編集は人間の `Ctrl+Z` で取り消せます
- AI への通知 (`notify_human`) は画面右下のトーストに表示されます

## 4.1 文書変更の検知 (バージョン通知)

人間の編集をAIが知るための仕組みです。AIはポーリングし続けなくて済みます。

- **stdio接続のAI**: 文書が変わるとサーバから通知が届きます
  ```json
  {"jsonrpc":"2.0","method":"notifications/document/changed","params":{"version":12,"origin":"human","cursor":{"from":120,"to":120}}}
  ```
  - `origin` は `"human"` (人間・他端末の編集) か `"ai"` (自分自身の編集の反響) かを示します。自分の反響は無視してください
  - 通知に本文は含まれません。内容が必要なら `get_changes` で取得します
  - 通知は変更のたびに送られます (フロント側で間引きしません)。連続入力中は `version` の最新値のみを追えば十分です
- **HTTP接続のAI**: 通知は届かないため、`get_version` を数秒ごとに叩いて版番号を比べます
  - 版が進んでいたら `get_changes {"since": 前回の版}` で最新の全文を取得します
  - 変更がなければ `{"changed":false}` のみが返ります (軽量)
- `get_document` の応答にも `version` が含まれます。編集連鎖の基準に使ってください

## 5. 制限事項

- 同時に参加できる AI は **1つのみ** です。2つ目の接続は拒否されます
- AI に見えるのは編集中の文書のみです (他のファイルへのアクセスはできません)
- AI の編集で自動保存が動きます (設定で OFF 可。その場合は `save_document` も拒否されます)
- 位置指定は ProseMirror 絶対位置です。編集後は `search` 等で再取得してください

## 6. トラブルシューティング

| 症状 | 対処 |
|---|---|
| 接続できない (stdio) | markink が起動し、有効化が ON か確認。`command` のパスが正しいか確認 |
| 401 Unauthorized (HTTP) | トークンを貼り直す。「トークンを再生成」後は古いトークンは無効 |
| 2つ目の AI が拒否される | 仕様です。パネルの「切断する」で1つ目を切断してください |
| ツールがタイムアウトする | エディタのウィンドウが開いているか確認。IME 変換中は最大2秒待ってから適用されます |
| AI カーソルが出ない | `set_cursor` を呼ぶと表示されます。名前は接続時のクライアント名です |
