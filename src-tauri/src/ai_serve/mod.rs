// エディタ起点のAI呼び出し (opencode serve 常駐)。
//
// 方向は MCPサーバ (AI→エディタ) と逆で、エディタがAIに文章処理を依頼する。
// 用途: 要約・続き・質問・編集代行 (requirements.md §11)。
//
// 構成:
// - `opencode serve` を子プロセスで起動 (127.0.0.1 のみ、Basic認証つき)。
//   パスワードは起動ごとに生成し、メモリ上でのみ保持する (ファイルに残さない)。
// - 要求は session作成 → message送信(応答待ち) → session削除 の3手で完結する
//   (都度破棄。会話の継続はしない)。
// - 道具呼びは封印する (`tools: {}`)。エディタへの再帰呼び出しを防ぐため。
// - HTTPクライアントは http.rs の手書き最小実装。接続先は localhost のみ許可。

mod api;
mod daemon;
mod http;
mod prompt;

use std::sync::{Mutex, OnceLock};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::settings;

struct Daemon {
    child: std::process::Child,
    password: String,
    port: u16,
    url: String,
}

static DAEMON: OnceLock<Mutex<Option<Daemon>>> = OnceLock::new();
static BUSY: OnceLock<Mutex<bool>> = OnceLock::new();
static CURRENT_SESSION: OnceLock<Mutex<Option<String>>> = OnceLock::new();

fn daemon_guard() -> &'static Mutex<Option<Daemon>> {
    DAEMON.get_or_init(|| Mutex::new(None))
}

fn busy_guard() -> &'static Mutex<bool> {
    BUSY.get_or_init(|| Mutex::new(false))
}

fn session_guard() -> &'static Mutex<Option<String>> {
    CURRENT_SESSION.get_or_init(|| Mutex::new(None))
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AiServeStatus {
    pub enabled: bool,
    pub running: bool,
    pub url: String,
}

fn status_snapshot() -> AiServeStatus {
    let s = settings::load();
    let guard = daemon_guard().lock();
    let (running, url) = match guard.map(|g| g.as_ref().map(|d| d.url.clone())) {
        Ok(Some(url)) => (true, url),
        _ => (false, s.ai_backend_url.clone()),
    };
    AiServeStatus { enabled: s.ai_call_enabled, running, url }
}

/// localhost のみ許可する (http://127.0.0.1:port / http://localhost:port)
fn parse_local_url(url: &str) -> Result<(String, u16), String> {
    let rest = url
        .strip_prefix("http://")
        .ok_or_else(|| "AI接続先は http:// のみ対応しています".to_string())?;
    let (host, port) = rest.split_once(':').ok_or_else(|| "ポートを指定してください (例: http://127.0.0.1:4096)".to_string())?;
    if host != "127.0.0.1" && host != "localhost" {
        return Err("AI接続先は localhost のみ許可しています".to_string());
    }
    let port: u16 = port.parse().map_err(|_| "ポート番号が不正です".to_string())?;
    if port == 0 {
        return Err("ポート番号が不正です".to_string());
    }
    Ok((host.to_string(), port))
}

fn ensure_running() -> Result<(String, u16, String), String> {
    // 既に起動済みなら使い回す
    if let Some(d) = daemon_guard().lock().map_err(|e| e.to_string())?.as_ref() {
        return Ok(("127.0.0.1".to_string(), d.port, d.password.clone()));
    }
    let s = settings::load();
    if !s.ai_call_enabled {
        return Err("AI呼び出しが無効です。設定で有効にしてください".to_string());
    }
    let (host, preferred) = parse_local_url(&s.ai_backend_url)?;
    // 複数起動時は空きポートにずらす (他インスタンスの現役デーモンは殺さない)
    daemon::remove_legacy_pid_file();
    let port = daemon::acquire_port(preferred)?;
    let password = settings::generate_token();
    let child = daemon::spawn_daemon(&s.opencode_bin, port, &password)?;
    let url = format!("http://{}:{}", host, port);
    *daemon_guard().lock().map_err(|e| e.to_string())? = Some(Daemon { child, password: password.clone(), port, url });
    Ok((host, port, password))
}

fn stop_daemon() {
    if let Ok(mut guard) = daemon_guard().lock() {
        if let Some(mut d) = guard.take() {
            let _ = d.child.kill();
            let _ = d.child.wait();
            daemon::remove_pid_file(d.port);
        }
    }
}

/// アプリ終了時の後始末 (孤児デーモンを残さない)。失敗しても無視する。
pub(crate) fn shutdown() {
    stop_daemon();
}

/// session作成 → message送信(応答待ち) → session削除。本体処理。
async fn ask_flow(
    host: &str,
    port: u16,
    password: &str,
    mode: prompt::AiMode,
    model: &str,
    prompt: &str,
    context: &str,
    timeout_secs: u64,
) -> Result<String, String> {
    let user_text = mode.build_user_text(prompt, context)?;
    let created =
        http::http_json(host, port, password, "POST", "/session", Some(&json!({ "title": mode.title() })), 15)
            .await?;
    let session_id = created
        .get("id")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "AIセッションを作成できません".to_string())?
        .to_string();
    *session_guard().lock().map_err(|e| e.to_string())? = Some(session_id.clone());
    let result = async {
        let mut msg: Value = json!({
            "system": mode.system_prompt(),
            "tools": {},
            "parts": [{ "type": "text", "text": user_text }],
        });
        // モデルは {providerID, modelID} 形式 (文字列 "provider/model" を分割する)。
        // 空なら serve 側の既定を使う。
        match http::parse_model(model) {
            Some(m) => {
                msg["model"] = m;
            }
            None if model.trim().is_empty() => {}
            None => {
                return Err(
                    "モデルは provider/model 形式で指定してください (例: opencode-go/kimi-k3)".to_string(),
                );
            }
        }
        let response = http::http_json(
            host,
            port,
            password,
            "POST",
            &format!("/session/{}/message", session_id),
            Some(&msg),
            timeout_secs,
        )
        .await?;
        http::extract_texts(&response)
    }
    .await;
    // 成功失敗に関わらずセッションは消す (溜めない)
    let _ = http::http_json(host, port, password, "DELETE", &format!("/session/{}", session_id), None, 10).await;
    *session_guard().lock().map_err(|e| e.to_string())? = None;
    result
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AiAnswer {
    pub text: String,
}

/// エディタからのAI呼び出し (Tauri command)
#[tauri::command]
pub async fn ai_ask(mode: String, prompt: String, context: String) -> Result<AiAnswer, String> {
    // ロックは await の前に外す (MutexGuard は Send でないため)
    {
        let mut busy = busy_guard().lock().map_err(|e| e.to_string())?;
        if *busy {
            return Err("AI実行中です。終わるまで待つか中断してください".to_string());
        }
        *busy = true;
    }
    let s = settings::load();
    let max_chars = if s.ai_max_chars == 0 { settings::DEFAULT_AI_MAX_CHARS } else { s.ai_max_chars };
    let mut context = context;
    let truncated = context.len() > max_chars;
    if truncated {
        context.truncate(max_chars);
    }
    let done: Result<String, String> = async {
        let mode = prompt::AiMode::parse(&mode)?;
        // api モードは serve を介さず直接エンドポイントへ送る
        if s.ai_provider == "api" {
            let mut text = api::ask_api(&s, mode, &prompt, &context).await?;
            if truncated {
                text.push_str("\n(参考: 長い文書のため先頭のみ送信しました)");
            }
            return Ok(text);
        }
        let (host, port, password) = ensure_running()?;
        // デーモン起動待ち (初回のみ最大25秒)
        daemon::wait_healthy(&host, port, &password).await?;
        let mut text = ask_flow(&host, port, &password, mode, &s.ai_model, &prompt, &context, s.ai_timeout_secs.max(10)).await?;
        if truncated {
            text.push_str("\n(参考: 長い文書のため先頭のみ送信しました)");
        }
        Ok(text)
    }
    .await;
    *busy_guard().lock().map_err(|e| e.to_string())? = false;
    done.map(|text| AiAnswer { text })
}

/// 実行中の要求を中断する
#[tauri::command]
pub async fn ai_abort() -> Result<(), String> {
    let (session_id, password, port) = {
        let session = session_guard().lock().map_err(|e| e.to_string())?.clone();
        let daemon = daemon_guard().lock().map_err(|e| e.to_string())?;
        match (session, daemon.as_ref()) {
            (Some(id), Some(d)) => (id, d.password.clone(), d.port),
            _ => return Err("中断できる要求がありません".to_string()),
        }
    };
    let _ = http::http_json("127.0.0.1", port, &password, "POST", &format!("/session/{}/abort", session_id), None, 10).await;
    Ok(())
}

#[tauri::command]
pub fn ai_status() -> AiServeStatus {
    status_snapshot()
}

#[tauri::command]
pub fn ai_set_enabled(enabled: bool) -> Result<AiServeStatus, String> {
    let mut s = settings::load();
    s.ai_call_enabled = enabled;
    settings::save(&s)?;
    if !enabled {
        stop_daemon();
    }
    Ok(status_snapshot())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiCallConfig {
    pub provider: Option<String>,
    pub model: Option<String>,
    pub backend_url: Option<String>,
    pub api_url: Option<String>,
    pub api_key: Option<String>,
    pub api_model: Option<String>,
    pub max_chars: Option<usize>,
    pub timeout_secs: Option<u64>,
    pub opencode_bin: Option<String>,
}

#[tauri::command]
pub fn ai_set_config(config: AiCallConfig) -> Result<AiServeStatus, String> {
    let mut s = settings::load();
    if let Some(v) = config.provider {
        if v != "local" && v != "api" {
            return Err("提供方式は local か api で指定してください".to_string());
        }
        let changed = s.ai_provider != v;
        s.ai_provider = v;
        if changed {
            stop_daemon();
        }
    }
    if let Some(v) = config.model {
        s.ai_model = v;
    }
    if let Some(v) = config.backend_url {
        // 保存前に localhost 制限を検証する
        parse_local_url(&v)?;
        let changed = s.ai_backend_url != v;
        s.ai_backend_url = v;
        if changed {
            stop_daemon();
        }
    }
    if let Some(v) = config.api_url {
        // 空白を除去してから検証・保存する (コピペ時の混入対策)
        let normalized: String = v.split_whitespace().collect();
        api::validate_api_url(&normalized)?;
        s.ai_api_url = normalized;
    }
    if let Some(v) = config.api_key {
        s.ai_api_key = v;
    }
    if let Some(v) = config.api_model {
        s.ai_api_model = v.trim().to_string();
    }
    if let Some(v) = config.max_chars {
        s.ai_max_chars = v.clamp(1000, 100_000);
    }
    if let Some(v) = config.timeout_secs {
        s.ai_timeout_secs = v.clamp(10, 600);
    }
    if let Some(v) = config.opencode_bin {
        if !v.trim().is_empty() {
            s.opencode_bin = v.trim().to_string();
        }
    }
    settings::save(&s)?;
    Ok(status_snapshot())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn local_url_allows_loopback_only() {
        assert_eq!(
            parse_local_url("http://127.0.0.1:4096").unwrap(),
            ("127.0.0.1".to_string(), 4096)
        );
        assert_eq!(
            parse_local_url("http://localhost:5123").unwrap(),
            ("localhost".to_string(), 5123)
        );
        assert!(parse_local_url("https://127.0.0.1:4096").is_err(), "https不可");
        assert!(parse_local_url("http://192.168.1.2:4096").is_err(), "LAN不可");
        assert!(parse_local_url("http://example.com:4096").is_err(), "外部不可");
        assert!(parse_local_url("http://127.0.0.1").is_err(), "ポート必須");
        assert!(parse_local_url("http://127.0.0.1:0").is_err(), "port 0不可");
    }

    /// ask_flow 全体の結合テスト (モック serve: session/message/delete)。
    /// 実 serve と同じ3手を話すループバックサーバで検証する。
    #[tokio::test]
    async fn ask_flow_against_mock_serve() {
        use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        tokio::spawn(async move {
            while let Ok((stream, _)) = listener.accept().await {
                tokio::spawn(async move {
                    let (rh, mut wh) = stream.into_split();
                    let mut reader = BufReader::new(rh);
                    let mut request_line = String::new();
                    if reader.read_line(&mut request_line).await.is_err() {
                        return;
                    }
                    // ヘッダを空行まで読み飛ばす
                    loop {
                        let mut line = String::new();
                        match reader.read_line(&mut line).await {
                            Ok(0) | Err(_) => return,
                            Ok(_) if line == "\r\n" => break,
                            Ok(_) => {}
                        }
                    }
                    // 簡易化: パスで応答を切り替える (要求本文は読まない)
                    let body = if request_line.starts_with("POST /session ") {
                        "{\"id\":\"ses_test\"}"
                    } else if request_line.contains("/message") {
                        "{\"parts\":[{\"type\":\"text\",\"text\":\"モック応答\"}]}"
                    } else {
                        "true"
                    };
                    let resp = format!(
                        "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                        body.len(),
                        body
                    );
                    let _ = wh.write_all(resp.as_bytes()).await;
                });
            }
        });
        let text = ask_flow("127.0.0.1", port, "pw", prompt::AiMode::Summary, "", "追加", "文書", 10)
            .await
            .expect("モック経由で応答が返る");
        assert_eq!(text, "モック応答");
    }
}
