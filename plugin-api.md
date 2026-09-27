# markink プラグイン API v1

プラグインは単一の ZIP ファイルで配布します。ZIP 直下に `manifest.json` と JavaScript の entry ファイルを配置してください。利用者はプラグイン管理画面から複数の ZIP を選んで導入できます。プラグインは ID ごとに別々に導入・有効化・停止・削除されます。

有効化には利用者の確認が必要です。有効状態は保存され、次回起動時に再開します。更新した ZIP は再度確認して有効化する必要があります。新版の起動に失敗した場合は旧版へ戻します。起動前に手動で「旧版へ戻す」を選ぶこともできます。更新以外で起動に失敗したプラグインは失敗状態として表示されます。

## 最小構成

```text
example.zip
├── manifest.json
└── index.js
```

`manifest.json`:

```json
{
  "id": "example.hello",
  "name": "Hello",
  "version": "1.0.0",
  "apiVersion": 1,
  "entry": "index.js",
  "permissions": ["ui.register", "ui.notify"]
}
```

`index.js`:

```js
self.markinkPlugin = {
  async activate(api) {
    await api.registerCommand(
      { id: 'hello', title: '挨拶', placement: 'menu' },
      () => api.notify('こんにちは')
    );
  },
  async deactivate() {
    // 必要な後処理があれば実行する。
  }
};
```

entry は 1 MiB 以下の UTF-8 JavaScript です。追加のファイルを ZIP に含められますが、現行ランタイムは entry を単一スクリプトとして Worker に読み込みます。実行時の `import`、`require`、ZIP 内ファイルの読み込みはサポートしません。依存コードは entry に束ねてください。

## manifest.json

| 項目 | 内容 |
| --- | --- |
| `id` | 小文字英数字から始まる 3〜64 文字の一意な ID。以降は小文字英数字、`.`、`_`、`-`。 |
| `name` | 表示名。最大 120 文字。 |
| `version` | SemVer 形式。 |
| `apiVersion` | 現在は `1`。 |
| `entry` | ZIP 内の相対パス。実行するプラグインには必須。 |
| `permissions` | 利用する権限の配列。重複不可。 |
| `description`, `author` | 任意の説明と作者名。 |
| `networkOrigins` | `network.request` 用の通信先 origin。最大 8 件。 |
| `settingsFields` | 管理画面に表示する設定項目。最大 16 件。 |
| `fileHashes` | 任意。`manifest.json` を除くZIP内の全ファイルパスと小文字の SHA-256 値。旧ZIPとの互換のため省略可。指定時は全ファイルを照合。 |

設定項目の例:

```json
"settingsFields": [
  { "key": "model", "label": "モデル名", "type": "text" },
  { "key": "timeout", "label": "待機秒数", "type": "number", "defaultValue": "30" },
  { "key": "mode", "label": "モード", "type": "choice", "options": ["fast", "safe"], "defaultValue": "safe" }
]
```

`settingsFields` には `settings.read` と `settings.write` の両権限が必要です。`key` は 1〜64 文字の英数字、`.`、`_`、`-` で、Windows の予約名は使えません。`type` は `text`、`number`、`choice`。`choice` には重複のない候補を 2〜8 件指定します。`defaultValue` は表示用の既定値であり、保存値がなければ `getSetting()` は `null` を返します。必要ならプラグイン側でも既定値を適用してください。

`networkOrigins` は `https://api.example.com` のような origin だけを指定します。外部通信は HTTPS、HTTP は localhost・127.0.0.1・[::1] のループバックに限ります。URL のパスは実行時の `requestJson()` で指定します。

## 権限と API

`activate(api)` が受け取る API は次の通りです。すべての操作は非同期です。

| 権限 | API | 内容 |
| --- | --- | --- |
| `document.read` | `readDocument()` | タイトル、Markdown 全文、選択位置、版、文書サイズ、選択テキスト、カーソル前のテキストを取得。全文は最大 5 MiB。 |
| `document.edit` | `applyEdit({ baseRevision, from, to, markdown, reason? })` | ProseMirror の位置で範囲を編集。512 KiB まで。全文置換時は利用者に確認。編集前に版を再検査。 |
| `ui.register` | `registerCommand(command, handler)` | 拡張メニューのコマンドを登録。戻り値は登録解除関数。 |
| `ui.notify` | `notify(message)` | 通知を表示。最大 4096 文字。 |
| `ui.dialog` | `prompt(label, initialValue?)` | 文字列を入力。キャンセル時は `null`。 |
| `ui.dialog` | `showResult(title, text, canReplace)` | 結果を表示。`insert`、`replace`、`cancel` を返す。 |
| `log.write` | `log({ level, message, fields? })` | 本体のログ設定に従いプラグインログを出力。 |
| `settings.read` | `getSetting(key)` | プラグイン固有の文字列設定を取得。未設定時は `null`。 |
| `settings.write` | `setSetting(key, value)` | プラグイン固有の文字列設定を保存。16 KiB まで。秘密値には使わない。 |
| `network.request` | `requestJson(url, body, useApiKey?, timeoutSecs?)` | 許可 origin へ JSON POST。`{ status, body }` を返す。 |
| `secrets.use` | `requestJson(..., true)` | Windows 資格情報ストア内の API キーを Bearer ヘッダーで付与。秘密値は Worker に返さない。 |

プラグインログは 1 ID あたり 1 分間に 120 件までです。本文、API キー、HTTP 要求・応答をログに書かないでください。

`registerCommand` の `command` は `{ id, title, placement: 'menu', shortcut?, contextMenu? }` です。`id` は同じプラグイン内で一意にします。`shortcut` は `Mod-KeyS`、`Mod-Shift-KeyQ`、`Mod-Space` の形式です。`contextMenu: true` で右クリックメニューにも表示します。同じショートカットを複数のプラグインが使う場合は、先に登録されたコマンドがキー操作を受けます。メニューからは各コマンドを選べます。

`readDocument()` の `selection.from` と `selection.to`、`size` は Markdown 文字列の位置ではなく、ProseMirror 文書の位置です。編集には取得した `revision` を `baseRevision` として渡してください。文書が変わった場合は再取得が必要です。

`requestJson()` の要求本文は最大 512 KiB、応答は最大 2 MiB、タイムアウトは 5〜120 秒です。リダイレクトと任意ヘッダーは使えません。API キーはプラグイン管理画面で利用者が保存します。Windows 以外での秘密値 API は現在未対応です。

## ライフサイクルと配布時の注意

プラグインは専用 Worker で実行されます。停止時は登録した UI が解除され、処理中の結果が文書に適用されないようにします。`deactivate()` は任意です。起動が 10 秒を超える場合やコマンドが規定時間を超える場合は失敗します。

ZIP は 50 MiB、展開合計は 100 MiB、ファイル数は 256 件までです。ZIP の発行元署名は現在検証していません。Worker は外部通信などを完全には隔離できません。利用者に信頼できる入手元からの ZIP だけを有効化してもらってください。アプリが強制する権限はホスト API の呼び出しに対するものです。

`fileHashes` はZIP内の破損や差し替え検知に使います。manifest自身や配布者の身元を証明する仕組みではありません。アプリはプレビュー時と導入時に ZIP 全体の SHA-256 を照合し、確認したバイト列から展開します。

完全な例は `plugin-packages/hello-world/` と `plugin-packages/markink-ai/` にあります。利用者へ配布するものは ZIP ファイルのみです。
