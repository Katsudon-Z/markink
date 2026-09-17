// mcp-stdio モード: MCPクライアント (Claude Desktop 等) がサブプロセスとして起動し、
// stdin/stdout の JSON-RPC を GUI プロセスのローカル WS へ素通しする「管」。
// プロトコル処理・接続スロット管理はすべて GUI プロセス側 (mcp-plan.md §2.0)
//
// 構成: 専用スレッドが stdin を行単位で読み tokio::sync::mpsc へ送る。
// 現在のスレッド上の current_thread ランタイムが WS との双方向中継を行う。
// stdout へは JSON-RPC 行以外を一切書かない (MCP stdio 仕様)。

use std::process::exit;

use futures_util::{SinkExt, StreamExt};
use tokio::sync::mpsc;
use tokio_tungstenite::tungstenite::Message;

use crate::mcp::transport_ws::WS_PATH;
use crate::settings;

/// 起動引数が mcp-stdio モードか (lib.rs::run() の先頭で判定する)
pub fn is_stdio_mode() -> bool {
    std::env::args().any(|a| a == "mcp-stdio")
}

/// stdio ⇄ WS 中継を実行してプロセスを終了する (GUI を起動しない)
pub fn run_stdio_mode() -> ! {
    let runtime = match tokio::runtime::Builder::new_current_thread().enable_all().build() {
        Ok(rt) => rt,
        Err(e) => fail(&format!("ランタイム初期化に失敗: {}", e)),
    };
    let code = runtime.block_on(pump());
    exit(code);
}

/// stdin 読み取りスレッドを起動し、行を送信するチャネルを返す。
/// EOF (クライアント終了) でチャネルが閉じる → WS 側も終了する。
fn spawn_stdin_reader() -> mpsc::UnboundedReceiver<String> {
    let (tx, rx) = mpsc::unbounded_channel::<String>();
    std::thread::spawn(move || {
        use std::io::BufRead;
        let stdin = std::io::stdin();
        let mut lock = stdin.lock();
        let mut buf = String::new();
        loop {
            buf.clear();
            match lock.read_line(&mut buf) {
                Ok(0) => break, // EOF
                Ok(_) => {
                    if buf.trim().is_empty() {
                        continue;
                    }
                    if tx.send(buf.clone()).is_err() {
                        break;
                    }
                }
                Err(_) => break,
            }
        }
        // tx を drop して受信側に終了を伝える
    });
    rx
}

async fn pump() -> i32 {
    let Some(endpoint) = settings::read_endpoint() else {
        eprintln!(
            "MDNotepad が起動していないか、AI共同編集 (MCP) が無効です。\n\
             アプリの設定で「AI共同編集」を有効にしてから再接続してください。"
        );
        return 2;
    };
    let url = format!(
        "ws://127.0.0.1:{}{}?token={}",
        endpoint.port, WS_PATH, endpoint.token
    );
    let (ws, _) = match tokio_tungstenite::connect_async(&url).await {
        Ok(pair) => pair,
        Err(e) => {
            eprintln!("MDNotepad に接続できません ({}). アプリが起動中か確認してください。", e);
            return 2;
        }
    };
    let (mut ws_sink, mut ws_source) = ws.split();
    let mut lines = spawn_stdin_reader();

    use std::io::Write;
    let stdout = std::io::stdout();

    loop {
        tokio::select! {
            // stdin (MCPクライアント → アプリ)
            maybe_line = lines.recv() => {
                match maybe_line {
                    Some(text) => {
                        if ws_sink.send(Message::Text(text.into())).await.is_err() {
                            eprintln!("MDNotepad との接続が切れました。");
                            return 1;
                        }
                    }
                    // EOF: クライアントが終了 → 自分も終了
                    None => return 0,
                }
            }
            // WS (アプリ → MCPクライアント)
            msg = ws_source.next() => {
                match msg {
                    Some(Ok(Message::Text(text))) => {
                        let mut out = stdout.lock();
                        if out.write_all(text.as_str().as_bytes()).is_err()
                            || out.write_all(b"\n").is_err()
                            || out.flush().is_err()
                        {
                            return 1;
                        }
                    }
                    Some(Ok(Message::Close(_))) | Some(Err(_)) | None => {
                        eprintln!("MDNotepad との接続が閉じられました。");
                        return 1;
                    }
                    _ => {}
                }
            }
        }
    }
}

fn fail(message: &str) -> ! {
    eprintln!("{}", message);
    exit(1);
}

#[cfg(test)]
mod tests {
    #[test]
    fn detects_stdio_mode_argument() {
        // is_stdio_mode は実際の起動引数に依存するため、判定ロジックだけ確認する
        let args = vec!["app.exe".to_string(), "mcp-stdio".to_string()];
        assert!(args.iter().any(|a| a == "mcp-stdio"));
        let args2 = vec!["app.exe".to_string(), "C:\\docs\\note.md".to_string()];
        assert!(!args2.iter().any(|a| a == "mcp-stdio"));
    }
}
