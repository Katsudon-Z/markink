誰でも簡単に使えるマークダウンエディタ。ポータブルでインターネットなし、サーバなしで共同編集可能。AI機能は別配布のプラグインで利用できます。

## 基本機能

https://github.com/user-attachments/assets/625756ea-2e0a-46f3-8e2e-60f006020408

## 共同編集

1. ファイルサーバ又はファイル共有されている.mdファイルを開く
2. 「共同編集」→「セッション開始」でホストになる
3. 参加者は同じファイルを開くとゲスト参加する（5人まで）

https://github.com/user-attachments/assets/ef963eb5-7d62-4470-9a4b-46ee25fafcf2

## AI連携

AIプラグインを導入すると、OpenAI互換APIで続き生成、要約、質問、編集代行を利用できます。結果を確認してから挿入または置換します。

AIのAPIが利用できるサービスとインターネット接続が必要です。

### 設定

1. プラグイン管理で `markink-ai-http-1.0.0.zip` を導入し、有効化します。
2. APIキーを使う場合はプラグイン管理画面で保存します。Windows資格情報ストアに保存されます。
3. プラグイン管理画面でAPI URL、モデル、送信上限、タイムアウトを指定します。

複数のプラグインZIPを同時に選んで導入できます。有効化したプラグインは次回起動時に自動で再開します。更新したプラグインは再度有効化してください。新版の起動に失敗した場合は旧版へ戻します。プラグイン開発者向けの仕様は [プラグインAPI](plugin-api.md) を参照してください。

利用できる通信先はプラグインZIPのmanifestに記載されています。外部通信はHTTPS、ローカルHTTPはループバック宛先に限定されます。

### 呼び出し方法
右クリックメニューから呼び出し。またはショートカットキー

- Ctrl + Space — AI続き
- Ctrl + Shift + S — AI要約
- Ctrl + Shift + Q — AI質問
- Ctrl + Shift + E — AI編集代行

従来の本体組み込みAIとMCP接続機能は終了しました。以前のOpenAI互換API設定とAPIキーは起動時にAIプラグイン用の保存先へ移行します。ローカルのAIプロセスを本体から起動する機能はありません。

https://github.com/user-attachments/assets/6fc70025-4f91-4f75-bc67-e1c5e8228c34

## インストール

下記のどちらかでインストールしてください

- markink_0.1.0_x64-portable.zipをダウンロード、展開して任意の場所に配置（共有フォルダ可） \
  初回起動時はSmartScreen警告が出ます ([詳細情報]→[実行]で実行できます)
- markink_0.1.0_x64-setup.exeをダウンロードしてインストール

ダウンロードは　[releases](https://github.com/Katsudon-Z/markink/releases)　から

## 意見・質問・機能提案

意見・質問・機能提案はこちら: [Discussions](https://github.com/Katsudon-Z/markink/discussions)
