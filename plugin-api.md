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

entry は 8 MiB 以下の UTF-8 JavaScript です。entry は単一スクリプトとして Worker に読み込みます。実行時の `import` と `require` はサポートしません。追加の UTF-8 ファイルは `package.read` 権限と `readPackageText()` で読み込めます。

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
| `document.read` | `readDocument()` | タイトル、Markdown 全文、選択位置、版、文書サイズ、選択テキスト、カーソル前のテキストを取得。全文は最大 16 MiB。 |
| `document.edit` | `applyEdit({ baseRevision, from, to, markdown, reason? })` | ProseMirror の位置で範囲を編集。2 MiB まで。全文置換時は利用者に確認。編集前に版を再検査。 |
| `ui.register` | `registerCommand(command, handler)` | 拡張メニューのコマンドを登録。戻り値は登録解除関数。 |
| `ui.register` | `registerCodeBlockRenderer(language, html)` | 指定言語のコードブロックを文書内の隔離されたiframeで描画。戻り値は登録解除関数。 |
| `ui.notify` | `notify(message)` | 通知を表示。最大 4096 文字。 |
| `ui.dialog` | `prompt(label, initialValue?)` | 文字列を入力。キャンセル時は `null`。 |
| `ui.dialog` | `showResult(title, text, canReplace)` | 結果を表示。`insert`、`replace`、`cancel` を返す。 |
| `ui.dialog` | `openEditor(title, html)` | サイズ変更・移動できる別ウィンドウの sandbox 付き iframe で HTML を表示。`parent.postMessage({ type: 'markink-editor-result', value: string }, '*')` で結果を返す。キャンセル時は `null`。 |
| `log.write` | `log({ level, message, fields? })` | 本体のログ設定に従いプラグインログを出力。 |
| `settings.read` | `getSetting(key)` | プラグイン固有の文字列設定を取得。未設定時は `null`。 |
| `settings.write` | `setSetting(key, value)` | プラグイン固有の文字列設定を保存。16 KiB まで。秘密値には使わない。 |
| `network.request` | `requestJson(url, body, useApiKey?, timeoutSecs?)` | 許可 origin へ JSON POST。`{ status, body }` を返す。 |
| `secrets.use` | `requestJson(..., true)` | Windows 資格情報ストア内の API キーを Bearer ヘッダーで付与。秘密値は Worker に返さない。 |
| `package.read` | `readPackageText(path)` | 同じZIPに同梱し、`fileHashes` に記載したUTF-8ファイルを読む。1ファイル8 MiBまで。 |
| `clipboard.write` | 描画iframeからの `markink-render-copy` | Windowsのクリップボードへ文字列またはPNGをコピーする。 |
| `office.copy` | 描画iframeからの `markink-render-copy` | 汎用図形データをOffice用クリップボード形式へ変換する。 |

プラグインログは 1 ID あたり 1 分間に 120 件までです。本文、API キー、HTTP 要求・応答をログに書かないでください。

`registerCommand` の `command` は `{ id, title, placement: 'menu', shortcut?, contextMenu? }` です。`id` は同じプラグイン内で一意にします。`shortcut` は `Mod-KeyS`、`Mod-Shift-KeyQ`、`Mod-Space` の形式です。`contextMenu: true` で右クリックメニューにも表示します。同じショートカットを複数のプラグインが使う場合は、先に登録されたコマンドがキー操作を受けます。メニューからは各コマンドを選べます。

`readDocument()` の `selection.from` と `selection.to`、`size` は Markdown 文字列の位置ではなく、ProseMirror 文書の位置です。編集には取得した `revision` を `baseRevision` として渡してください。文書が変わった場合は再取得が必要です。

画像ノードを選択している場合、`readDocument()` は `selectedImage: { src, alt, from, to }` を返します。それ以外は `null` です。図形エディタのようなプラグインは、画像の出所を確認してからこの範囲を `applyEdit()` で置き換えられます。

コードブロックを選択しているか、内部にカーソルがある場合、`selectedCodeBlock: { params, text, from, to }` を返します。`params` はコードフェンスの言語名など、`text` はコード本文、`from` と `to` はブロック全体のProseMirror位置です。Mermaidエディタは `params` が `mermaid` のブロックを再編集します。コードフェンスの言語名はMarkdown保存・再読込後も保持されます。

`openEditor()` の HTML は 16 MiB 以下、戻り値は 2 MiB 以下です。Workerからホストへの要求全体は20 MiBまでです。編集画面は本体とは別のウィンドウで開き、移動・サイズ変更できます。iframe は `allow-scripts` のみの sandbox で動き、Tauri API やホストの DOM にはアクセスできません。HTML 内のネットワーク通信は CSP で禁止し、インラインとblobのスクリプトを許可します。プラグイン停止時は編集画面も閉じられます。`applyEdit()` のMarkdownは2 MiB、`readDocument()` のMarkdownは16 MiBまでです。

`registerCodeBlockRenderer(language, html)` のHTMLは16 MiB以下で、iframe内の `window.markinkCodeBlockSource` にコード本文が文字列で渡されます。図を描いた後は `parent.postMessage({ type: 'markink-render-height', height: document.body.scrollHeight }, '*')` で高さを通知できます。本体は140〜65536 pxに制限します。プラグイン停止時は通常のコードブロック表示に戻ります。同じ言語の描画は一つのプラグインだけが登録できます。iframeのsandboxとCSPは `openEditor()` と同じです。

描画iframeから `parent.postMessage({ type: 'markink-render-select' }, '*')` を送ると、対応するコードブロックを選択できます。右クリックメニューを開いたままにする場合は `focus: false` を加えてください。図の上下の余白をクリックするか、図を選択して上下矢印キーを押すと、前後の段落にカーソルを置けます。隣に段落がない場合は新しい段落を作成します。

描画iframeの右クリックメニューなどからコピーする場合は、`parent.postMessage({ type: 'markink-render-copy', format, value }, '*')` を送ります。`format` は `text`、`png`、`office-drawing` です。`text` は文字列、`png` はPNG data URLを指定し、`clipboard.write` 権限が必要です。`office-drawing` は図形・線・文字の座標を含むJSONを指定し、`office.copy` 権限が必要です。図形は `rectangle`、`ellipse`、`bullseye`（外周と中央の点を持つ1つの図形）、`diamond`、`freeform`、`roundRect`、`flowChartPredefinedProcess`、`can` を指定でき、`freeform` は輪郭の `points`（最大128点）を伴います。`pathClosed: false` を指定すると閉じない自由形状（最低2点）になります。自由形状にも `startArrow` と `endArrow` を指定できます。図形には `fill`、`stroke`、`strokeWidth`、`dash`、`layer`、任意の `nodeId`、線には `stroke`、`strokeWidth`、`dash`、`startArrow`、`endArrow`、任意の `startNode` と `endNode` を指定できます。両端のノードIDが図形の `nodeId` に一致すると、Officeコネクタの接続先に設定されます。色は `#RRGGBB` または `none`、矢印は `none`、`triangle`、`oval`、`diamond`、`cross`、`arrow`（開いた矢印）です。`cross` はコネクタのみ対応します。本体はPowerPointを起動せず、Windowsクリップボードに `Art::GVML ClipFormat` を書き込みます。要求は16 MiB以下です。結果はiframeへ `markink-render-copy-result` メッセージで返ります。従来の基本図形とコネクタについて、Officeへの貼り付けと個別編集は実機で確認済みです。接続先指定は実機で確認済みです。

Office図形JSONは `{ minX, minY, width, height, shapes, lines, texts }` です。`shapes` の要素は `{ x, y, w, h, kind, label, nodeId?, points?, connectionSites? }`、`lines` は `{ points: [[x, y], ...], startNode?, endNode?, startSite?, endSite? }`、`texts` は `{ x, y, w, h, label }` です。座標は同一の図形座標系を使います。`connectionSites` は `freeform` / `bullseye` 図形の接続点座標の配列で、最大1024点です。線の `startSite` / `endSite` は接続先図形の接続点番号を0から指定します。指定しない場合は上下左右の最も近い接続点を選びます。各`lines`要素は1つのOfficeコネクタに変換されます。ほぼ直線の経路は直線コネクタ、曲がる経路は曲線コネクタとして生成します。曲線はPowerPoint標準の形状と自動調整を使うため、Mermaid表示と異なる場合があります。MermaidプラグインのPowerPoint図コピーはフローチャートとシーケンス図に対応します。

Mermaidのような描画ライブラリは、ブラウザーで動く単一のJavaScriptファイルにビルドしてZIPへ同梱できます。manifestの `permissions` に `package.read` を加え、そのファイルを `fileHashes` に記載してください。Workerで `const code = await api.readPackageText('mermaid.bundle.js')` と読み、編集画面やコードブロック描画用のHTMLに渡します。画面内でコードをblob URLのスクリプトとして読み込めます。分割チャンクの動的importやCDNへのアクセスには対応しません。Mermaid原文はMarkdownのコードフェンスとして保存します。

たとえば編集画面用HTMLの生成時に、ライブラリのテキストを安全なJavaScript文字列へ変換できます。

```js
const code = await api.readPackageText('mermaid.bundle.js');
const literal = JSON.stringify(code).replace(/</g, '\\u003c');
const html = `<script>
  const source = ${literal};
  const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
  const script = document.createElement('script');
  script.src = url;
  script.onload = () => URL.revokeObjectURL(url);
  document.head.append(script);
<\/script>`;
await api.openEditor('Mermaid', html);
```

実際のMermaidエディタではscriptの読み込み完了後にMermaidの初期化とプレビューを行います。`registerCodeBlockRenderer('mermaid', html)` で文書内の図表示を登録し、文書へは `mermaid` 言語のコードフェンスを `applyEdit()` で挿入します。

`requestJson()` の要求本文は最大 512 KiB、応答は最大 2 MiB、タイムアウトは 5〜120 秒です。リダイレクトと任意ヘッダーは使えません。API キーはプラグイン管理画面で利用者が保存します。Windows 以外での秘密値 API は現在未対応です。

## ライフサイクルと配布時の注意

プラグインは専用 Worker で実行されます。停止時は登録した UI が解除され、処理中の結果が文書に適用されないようにします。`deactivate()` は任意です。起動が 30 秒を超える場合やコマンドが規定時間を超える場合は失敗します。

ZIP は 50 MiB、展開合計は 100 MiB、ファイル数は 256 件までです。ZIP の発行元署名は現在検証していません。Worker は外部通信などを完全には隔離できません。利用者に信頼できる入手元からの ZIP だけを有効化してもらってください。アプリが強制する権限はホスト API の呼び出しに対するものです。

`fileHashes` はZIP内の破損や差し替え検知に使います。manifest自身や配布者の身元を証明する仕組みではありません。アプリはプレビュー時と導入時に ZIP 全体の SHA-256 を照合し、確認したバイト列から展開します。

完全な例は `plugin-packages/hello-world/`、`plugin-packages/markink-ai/`、`plugin-packages/shape-editor/`、`plugin-packages/mermaid-editor/` にあります。MermaidエディタはZIP内に描画ライブラリとライセンス文書を同梱しています。利用者へ配布するものは ZIP ファイルのみです。

図形・文字要素は fontSize（CSS px、1〜200）と textColor（#RRGGBB または none）を指定できます。図形は fillOpacity（0〜1）にも対応します。省略時は従来の文字サイズ・色・不透明な塗りです。複数行のラベルは改行をOfficeの段落として出力します。

描画iframeから parent.postMessage({ type: 'markink-render-command', commandId: 'コマンドID' }, '*') を送ると、対象コードブロックを選択して、描画プラグイン自身がcontextMenu:trueで登録したコマンドを実行します。他プラグインのコマンドは実行できません。

継続編集は openEditor(title, html, onApply) で開きます。onApply(value) は文書への反映処理を行う非同期コールバックです。iframeが parent.postMessage({ type: 'markink-editor-apply', value }, '*') を送ると、ウィンドウを閉じずにonApplyを呼びます。結果はiframeへ { type: 'markink-editor-apply-result', error: null | string } で返ります。反映データは2 MiB以下です。反映中はボタンを無効化してください。閉じる操作ではopenEditorのPromiseがnullで完了し、それまでに反映済みの編集は残ります。従来の2引数とmarkink-editor-resultは反映して閉じる動作を維持します。

Office図形shapesの要素に任意のgroupIdを指定すると、同じgroupIdの図形を1つのOfficeグループへまとめます。グループの枠はメンバーの配置から計算し、元の座標を保ちます。接続線はメンバーのnodeIdへ接続でき、グループの移動・サイズ変更に追従します。グループを解除すると部品ごとに編集できます。ネストしたgroupId階層はありません。文字を含むグループにはlabelを持つ透明rectangleを使えます。shapesのrotationは度単位で-360〜360を指定でき、文字枠や図形を回転します。

編集画面のiframeからも markink-render-copy と markink-render-copy-result を利用できます。形式、16 MiB上限、clipboard.write / office.copy の権限はコードブロック描画と同じです。本体が編集ウィンドウのセッションとプラグインの有効状態を確認し、コピーします。コピー要求は結果を受け取ってから次を送信してください。
