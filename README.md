誰でも簡単に使えるマークダウンエディタ。ポータブルでインターネットなし、サーバなしで共同編集可能。AI対応。

## 基本機能

https://github.com/user-attachments/assets/625756ea-2e0a-46f3-8e2e-60f006020408

## 共同編集

1. ファイルサーバ又はファイル共有されている.mdファイルを開く
2. 「共同編集」→「セッション開始」でホストになる
3. 参加者は同じファイルを開くとゲスト参加する（5人まで）

https://github.com/user-attachments/assets/ef963eb5-7d62-4470-9a4b-46ee25fafcf2

## AI連携

ChatGPT等に接続して、続きを書く (確認なしで挿入)、要約、AIに質問、編集代行ができます。

AIを利用するにはインターネット接続が必要です。

### 設定

「設定」-「エディタからのAI呼び出し（右クリックメニュー）」で下記を設定
- 有効化 ON
- 提供方式 API(OpenAI互換)
- API URL 　https://api.openai.com/v1/chat/completions
（OpenAIの場合)
- APIキー　　LLMのAPIキー　（OpenAIの場合、sk-から始まる文字列）
- モデル名（例）　　gpt-5.6-luna

### 呼び出し方法
右クリックメニューから呼び出し。またはショートカットキー

- Ctrl + Space — AI続き (確認なしで挿入)
- Ctrl + Shift + S — AI要約
- Ctrl + Shift + Q — AI質問 (メニューを開く)
- Ctrl + Shift + E — AI編集代行 (メニューを開く)

https://github.com/user-attachments/assets/6fc70025-4f91-4f75-bc67-e1c5e8228c34

## インストール

下記のどちらかでインストールしてください

- markink_0.1.0_x64-portable.zipをダウンロード、展開して任意の場所に配置（共有フォルダ可） \
  初回起動時はSmartScreen警告が出ます ([詳細情報]→[実行]で実行できます)
- markink_0.1.0_x64-setup.exeをダウンロードしてインストール

ダウンロードは　[releases](https://github.com/Katsudon-Z/markink/releases)　から

## 意見・質問・機能提案

意見・質問・機能提案はこちら: [Discussions](https://github.com/Katsudon-Z/markink/discussions)
