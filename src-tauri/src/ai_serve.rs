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
// - HTTPクライアントは tokio TcpStream の手書き最小実装 (依存追加なし)。
//   接続先は localhost のみ許可する。

use std::sync::{Mutex, OnceLock};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};

use crate::settings;

/// AI呼び出しの用途 (フロントの右クリックメニューに対応)
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum AiMode {
    Summary,
    Continue,
    Question,
    Edit,
}

impl AiMode {
    fn parse(s: &str) -> Result<Self, String> {
        match s {
            "summary" => Ok(AiMode::Summary),
            "continue" => Ok(AiMode::Continue),
            "question" => Ok(AiMode::Question),
            "edit" => Ok(AiMode::Edit),
            _ => Err(format!("未知のAIモード: {}", s)),
        }
    }

    fn title(&self) -> &'static str {
        match self {
            AiMode::Summary => "AI要約",
            AiMode::Continue => "AI続き",
            AiMode::Question => "AI質問",
            AiMode::Edit => "AI編集代行",
        }
    }

    /// 用途別の system 指示 (本文のみ出力させ、前置きを禁じる)
    fn system_prompt(&self) -> &'static str {
        match self {
            AiMode::Summary => {
                "あなたは文書要約アシスタントです。次の文書を日本語5行以内の箇条書きで要約してください。要約のみを出力し、前置き・説明は不要です。"
            }
            AiMode::Continue => {
                "あなたは文章作成アシスタントです。次の文章の続きを自然に2〜3文で書いてください。続きの本文のみを出力し、前置き・説明・引用符は不要です。"
            }
            AiMode::Question => {
                "あなたは文書アシスタントです。与えられた文書の内容に基づいて質問に日本語で簡潔に答えてください。答えのみを出力してください。"
            }
            AiMode::Edit => {
                "あなたは文書編集アシスタントです。指示に従って文書を書き換えた全文のみを出力してください。前置き・説明・コードフェンスは不要です。"
            }
        }
    }

    /// 要求本文を組み立てる (prompt は質問・編集代行で必須)
    fn build_user_text(&self, prompt: &str, context: &str) -> Result<String, String> {
        let prompt = prompt.trim();
        match self {
            AiMode::Summary => {
                let extra = if prompt.is_empty() {
                    String::new()
                } else {
                    format!("追加の指示: {}\n", prompt)
                };
                Ok(format!("{}文書:\n{}", extra, context))
            }
            AiMode::Continue => {
                let extra = if prompt.is_empty() {
                    String::new()
                } else {
                    format!("方向性: {}\n", prompt)
                };
                Ok(format!("{}次の文章の続きを書いてください:\n{}", extra, context))
            }
            AiMode::Question => {
                if prompt.is_empty() {
                    return Err("質問内容を入力してください".to_string());
                }
                Ok(format!("文書:\n{}\n質問: {}", context, prompt))
            }
            AiMode::Edit => {
                if prompt.is_empty() {
                    return Err("編集指示を入力してください".to_string());
                }
                Ok(format!("文書:\n{}\n指示: {}", context, prompt))
            }
        }
    }
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

/// 最小の Base64 エンコーダ (Basic認証用。依存追加を避ける)
fn base64_encode(input: &[u8]) -> String {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity((input.len() + 2) / 3 * 4);
    for chunk in input.chunks(3) {
        let mut n: u32 = 0;
        for (i, &b) in chunk.iter().enumerate() {
            n |= (b as u32) << (16 - 8 * i);
        }
        let pad = 3 - chunk.len();
        for i in 0..4 - pad {
            out.push(TABLE[((n >> (18 - 6 * i)) & 63) as usize] as char);
        }
        for _ in 0..pad {
            out.push('=');
        }
    }
    out
}

struct Daemon {
    child: std::process::Child,
    password: String,
    port: u16,
}

/// デーモンのPIDファイル (アプリ終了時に取り残された孤児の回収用)。
/// spawn 時に書き込み、stop_daemon で削除する。
#[derive(Serialize, Deserialize)]
struct DaemonPid {
    pid: u32,
    port: u16,
}

fn pid_file_path() -> std::path::PathBuf {
    settings::local_dir().join("ai-serve.json")
}

fn write_pid_file(pid: u32, port: u16) {
    let _ = std::fs::create_dir_all(settings::local_dir());
    let text = serde_json::to_string(&DaemonPid { pid, port }).unwrap_or_default();
    let _ = std::fs::write(pid_file_path(), text);
}

fn read_pid_file() -> Option<DaemonPid> {
    std::fs::read_to_string(pid_file_path())
        .ok()
        .and_then(|text| serde_json::from_str(&text).ok())
}

fn remove_pid_file() {
    let _ = std::fs::remove_file(pid_file_path());
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
    let running = daemon_guard().lock().map(|d| d.is_some()).unwrap_or(false);
    AiServeStatus { enabled: s.ai_call_enabled, running, url: s.ai_backend_url.clone() }
}

/// HTTP 応答 (ステータス + JSON本文)
async fn http_json(
    host: &str,
    port: u16,
    password: &str,
    method: &str,
    path: &str,
    body: Option<&Value>,
    timeout_secs: u64,
) -> Result<Value, String> {
    let body_text = body.map(|b| b.to_string()).unwrap_or_default();
    let req = format!(
        "{} {} HTTP/1.1\r\nHost: {}\r\nAuthorization: Basic {}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        method,
        path,
        host,
        base64_encode(format!("opencode:{}", password).as_bytes()),
        body_text.len(),
        body_text
    );
    let addr = format!("{}:{}", host, port);
    let work = async {
        let stream = tokio::net::TcpStream::connect(&addr)
            .await
            .map_err(|e| format!("AIサーバに接続できません ({}): {}", addr, e))?;
        let mut reader = BufReader::new(stream);
        reader
            .write_all(req.as_bytes())
            .await
            .map_err(|e| format!("AIサーバへの送信に失敗: {}", e))?;
        // ステータス行 + ヘッダを空行まで読む
        let mut header_text = String::new();
        loop {
            let mut line = String::new();
            let n = reader
                .read_line(&mut line)
                .await
                .map_err(|e| format!("AIサーバからの受信に失敗: {}", e))?;
            if n == 0 {
                return Err("AIサーバが応答を閉じました".to_string());
            }
            if line == "\r\n" || line == "\n" {
                break;
            }
            header_text.push_str(&line);
            if header_text.len() > 64 * 1024 {
                return Err("AIサーバの応答ヘッダが大きすぎます".to_string());
            }
        }
        let status: u16 = header_text
            .lines()
            .next()
            .and_then(|l| l.split_whitespace().nth(1))
            .and_then(|c| c.parse().ok())
            .ok_or_else(|| "AIサーバの応答を解釈できません".to_string())?;
        let header_value = |name: &str| {
            header_text
                .lines()
                .filter_map(|l| l.split_once(':'))
                .find(|(k, _)| k.trim().eq_ignore_ascii_case(name))
                .map(|(_, v)| v.trim().to_string())
        };
        // 本文の枠: chunked 優先 (/message は chunked で返る)、次に Content-Length
        let body_bytes = if header_value("transfer-encoding")
            .map(|v| v.to_ascii_lowercase().contains("chunked"))
            .unwrap_or(false)
        {
            read_chunked_body(&mut reader).await?
        } else {
            let content_length: usize = header_value("content-length")
                .and_then(|v| v.parse().ok())
                .unwrap_or(0);
            if content_length > 16 * 1024 * 1024 {
                return Err("AIサーバの応答が大きすぎます".to_string());
            }
            let mut body = vec![0u8; content_length];
            if content_length > 0 {
                reader
                    .read_exact(&mut body)
                    .await
                    .map_err(|e| format!("AIサーバからの受信に失敗: {}", e))?;
            }
            body
        };
        if !(200..300).contains(&status) {
            let preview = String::from_utf8_lossy(&body_bytes);
            return Err(format!("AIサーバが {} を返しました: {}", status, preview.chars().take(200).collect::<String>()));
        }
        if body_bytes.is_empty() {
            return Ok(Value::Null);
        }
        serde_json::from_slice(&body_bytes).map_err(|e| format!("AIサーバの応答を解釈できません: {}", e))
    };
    tokio::time::timeout(std::time::Duration::from_secs(timeout_secs), work)
        .await
        .map_err(|_| "AIサーバの応答がタイムアウトしました".to_string())?
}

/// chunked 本文を復号する (/session/:id/message の応答用)
async fn read_chunked_body<R>(reader: &mut BufReader<R>) -> Result<Vec<u8>, String>
where
    R: tokio::io::AsyncRead + Unpin,
{
    let mut out = Vec::new();
    loop {
        let mut line = String::new();
        reader
            .read_line(&mut line)
            .await
            .map_err(|e| format!("AIサーバからの受信に失敗: {}", e))?;
        let size_str = line.split(';').next().unwrap_or("").trim();
        let size = usize::from_str_radix(size_str, 16)
            .map_err(|_| "AIサーバの応答を解釈できません (chunk)".to_string())?;
        if size == 0 {
            // トレーラを空行まで読み飛ばす
            loop {
                let mut trailer = String::new();
                reader
                    .read_line(&mut trailer)
                    .await
                    .map_err(|e| format!("AIサーバからの受信に失敗: {}", e))?;
                if trailer == "\r\n" || trailer == "\n" || trailer.is_empty() {
                    break;
                }
            }
            break;
        }
        if out.len() + size > 16 * 1024 * 1024 {
            return Err("AIサーバの応答が大きすぎます".to_string());
        }
        let mut chunk = vec![0u8; size];
        reader
            .read_exact(&mut chunk)
            .await
            .map_err(|e| format!("AIサーバからの受信に失敗: {}", e))?;
        out.extend_from_slice(&chunk);
        let mut crlf = [0u8; 2];
        reader
            .read_exact(&mut crlf)
            .await
            .map_err(|e| format!("AIサーバからの受信に失敗: {}", e))?;
    }
    Ok(out)
}

/// 応答 parts から text 部分だけを抜き出す
fn extract_texts(response: &Value) -> Result<String, String> {
    let parts = response
        .get("parts")
        .and_then(|p| p.as_array())
        .ok_or_else(|| "AIサーバの応答形式が不正です".to_string())?;
    let mut out = Vec::new();
    for part in parts {
        if part.get("type").and_then(|t| t.as_str()) == Some("text") {
            if let Some(text) = part.get("text").and_then(|t| t.as_str()) {
                out.push(text.to_string());
            }
        }
    }
    if out.is_empty() {
        return Err("AIからの本文がありませんでした".to_string());
    }
    Ok(out.join("\n").trim().to_string())
}

/// serve デーモンを起動し、health が通るまで待つ
fn spawn_daemon(bin: &str, port: u16, password: &str) -> Result<std::process::Child, String> {
    // ポート使用中は孤児 (前回アプリ終了時の取り残し) の回収を試みる
    if std::net::TcpStream::connect(format!("127.0.0.1:{}", port)).is_ok() {
        adopt_stale_daemon(port)?;
    }
    let log_path = settings::local_dir().join("ai-serve.log");
    let _ = std::fs::create_dir_all(settings::local_dir());
    let log = std::fs::File::create(&log_path).map_err(|e| e.to_string())?;
    let err_log = log.try_clone().map_err(|e| e.to_string())?;
    #[cfg(windows)]
    let mut cmd = {
        let mut c = std::process::Command::new("cmd");
        c.args(["/C", bin, "serve", "--port", &port.to_string(), "--hostname", "127.0.0.1"]);
        use std::os::windows::process::CommandExt;
        c.creation_flags(0x08000000);
        c
    };
    #[cfg(not(windows))]
    let mut cmd = {
        let mut c = std::process::Command::new(bin);
        c.args(["serve", "--port", &port.to_string(), "--hostname", "127.0.0.1"]);
        c
    };
    cmd.env("OPENCODE_SERVER_PASSWORD", password)
        .stdout(std::process::Stdio::from(log))
        .stderr(std::process::Stdio::from(err_log))
        .stdin(std::process::Stdio::null());
    let child = cmd.spawn().map_err(|e| {
        format!("opencode を起動できません ({}): {}。設定で実行ファイルの場所を指定してください", bin, e)
    })?;
    write_pid_file(child.id(), port);
    Ok(child)
}

/// ポート占有者が自分が取り残したデーモンなら殺して回収する。
/// 判定は占有者自身のコマンドラインで行う (`serve --port <port>` を含むか)。
/// PIDファイルは cmd ラッパーのPIDが残るため所有者比較には使えない
/// (netstat に出るのは serve 本体のPID)。他人物は殺さずエラーにする。
fn adopt_stale_daemon(port: u16) -> Result<(), String> {
    let busy_msg = format!(
        "ポート {} は使用中です。別の opencode serve を停止してください",
        port
    );
    let listener = listener_pid(port).ok_or_else(|| busy_msg.clone())?;
    let mut targets = vec![listener];
    // PIDファイルのプロセスも同型なら一緒に殺す (生き残った cmd ラッパー対策)
    if let Some(recorded) = read_pid_file() {
        if recorded.port == port && recorded.pid != listener {
            targets.push(recorded.pid);
        }
    }
    let mut adopted = false;
    for pid in targets {
        match process_command_line(pid) {
            Some(cmdline) if is_own_serve_command(&cmdline, port) => {
                kill_pid(pid)?;
                adopted = true;
            }
            _ => {}
        }
    }
    if !adopted {
        return Err(busy_msg);
    }
    // ポートが空くまで待つ
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
    while std::net::TcpStream::connect(format!("127.0.0.1:{}", port)).is_ok() {
        if std::time::Instant::now() >= deadline {
            return Err(format!("ポート {} の解放待ちがタイムアウトしました", port));
        }
        std::thread::sleep(std::time::Duration::from_millis(200));
    }
    remove_pid_file();
    Ok(())
}

/// プロセスのコマンドライン (Windows の CIM 経由。回収時の判定専用)
fn process_command_line(pid: u32) -> Option<String> {
    #[cfg(windows)]
    {
        let out = std::process::Command::new("powershell")
            .args([
                "-NoProfile",
                "-Command",
                &format!(
                    "(Get-CimInstance Win32_Process -Filter 'ProcessId = {}').CommandLine",
                    pid
                ),
            ])
            .output()
            .ok()?;
        if !out.status.success() {
            return None;
        }
        let text = String::from_utf8_lossy(&out.stdout).trim().to_string();
        if text.is_empty() {
            None
        } else {
            Some(text)
        }
    }
    #[cfg(not(windows))]
    {
        let _ = pid;
        None
    }
}

/// 自分が起動した serve のコマンドラインか
/// (例: `"...\opencode.exe"    serve --port 4096 --hostname 127.0.0.1`)
fn is_own_serve_command(cmdline: &str, port: u16) -> bool {
    cmdline.contains("serve") && cmdline.contains(&format!("--port {}", port))
}

/// ポートの LISTENING 所有者PID (Windows の netstat 優先、他は未対応)
fn listener_pid(port: u16) -> Option<u32> {
    #[cfg(windows)]
    {
        let out = std::process::Command::new("netstat").args(["-ano"]).output().ok()?;
        let text = String::from_utf8_lossy(&out.stdout);
        parse_listener_pid(&text, port)
    }
    #[cfg(not(windows))]
    {
        let _ = port;
        None
    }
}

/// netstat -ano 出力から指定ポートの LISTENING 所有者を抜き出す
fn parse_listener_pid(netstat_text: &str, port: u16) -> Option<u32> {
    let want = format!("127.0.0.1:{}", port);
    for line in netstat_text.lines() {
        let cols: Vec<&str> = line.split_whitespace().collect();
        if cols.len() == 5 && cols[0] == "TCP" && cols[1] == want && cols[3] == "LISTENING" {
            return cols[4].parse().ok();
        }
    }
    None
}

fn kill_pid(pid: u32) -> Result<(), String> {
    #[cfg(windows)]
    {
        let out = std::process::Command::new("taskkill")
            .args(["/F", "/PID", &pid.to_string()])
            .output()
            .map_err(|e| format!("プロセスを終了できません ({}): {}", pid, e))?;
        if out.status.success() {
            Ok(())
        } else {
            Err(format!("プロセス {} を終了できませんでした", pid))
        }
    }
    #[cfg(not(windows))]
    {
        let _ = pid;
        Err("このOSでは自動回収に未対応です".to_string())
    }
}

async fn wait_healthy(host: &str, port: u16, password: &str) -> Result<(), String> {
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(25);
    loop {
        match http_json(host, port, password, "GET", "/global/health", None, 3).await {
            Ok(v) if v.get("healthy").and_then(|h| h.as_bool()) == Some(true) => return Ok(()),
            _ => {}
        }
        if std::time::Instant::now() >= deadline {
            return Err("AIサーバの起動確認がタイムアウトしました (ai-serve.log を確認してください)".to_string());
        }
        tokio::time::sleep(std::time::Duration::from_millis(500)).await;
    }
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
    let (host, port) = parse_local_url(&s.ai_backend_url)?;
    let password = settings::generate_token();
    let child = spawn_daemon(&s.opencode_bin, port, &password)?;
    *daemon_guard().lock().map_err(|e| e.to_string())? = Some(Daemon { child, password: password.clone(), port });
    Ok((host, port, password))
}

fn stop_daemon() {
    if let Ok(mut guard) = daemon_guard().lock() {
        if let Some(mut d) = guard.take() {
            let _ = d.child.kill();
            let _ = d.child.wait();
        }
    }
    remove_pid_file();
}

/// モデル指定 "provider/model" を message 用オブジェクトに変換する。
/// 空なら None (serve 側の既定を使う)。'/' 無しは None (呼び出し側でエラーにする)。
fn parse_model(s: &str) -> Option<Value> {
    let s = s.trim();
    if s.is_empty() {
        return None;
    }
    s.split_once('/')
        .map(|(provider, id)| json!({ "providerID": provider, "modelID": id }))
}

/// session作成 → message送信(応答待ち) → session削除。本体処理。
async fn ask_flow(
    host: &str,
    port: u16,
    password: &str,
    mode: AiMode,
    model: &str,
    prompt: &str,
    context: &str,
    timeout_secs: u64,
) -> Result<String, String> {
    let user_text = mode.build_user_text(prompt, context)?;
    let created =
        http_json(host, port, password, "POST", "/session", Some(&json!({ "title": mode.title() })), 15)
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
        if model.trim().is_empty() {
            // 既定モデルのまま
        } else if let Some(m) = parse_model(model) {
            msg["model"] = m;
        } else {
            return Err(
                "モデルは provider/model 形式で指定してください (例: opencode-go/kimi-k3)".to_string(),
            );
        }
        let response = http_json(
            host,
            port,
            password,
            "POST",
            &format!("/session/{}/message", session_id),
            Some(&msg),
            timeout_secs,
        )
        .await?;
        extract_texts(&response)
    }
    .await;
    // 成功失敗に関わらずセッションは消す (溜めない)
    let _ = http_json(host, port, password, "DELETE", &format!("/session/{}", session_id), None, 10).await;
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
        let (host, port, password) = ensure_running()?;
        // デーモン起動待ち (初回のみ最大25秒)
        wait_healthy(&host, port, &password).await?;
        let mut text = ask_flow(&host, port, &password, AiMode::parse(&mode)?, &s.ai_model, &prompt, &context, s.ai_timeout_secs.max(10)).await?;
        if truncated {
            text.push_str("\n(参考: 長い文書のため先頭のみ送信しました)");
        }
        Ok(text)
    }
    .await;
    *busy_guard().lock().map_err(|e| e.to_string())? = false;
    text_to_answer(done)
}

fn text_to_answer(result: Result<String, String>) -> Result<AiAnswer, String> {
    result.map(|text| AiAnswer { text })
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
    let _ = http_json("127.0.0.1", port, &password, "POST", &format!("/session/{}/abort", session_id), None, 10).await;
    Ok(())
}

#[tauri::command]
pub fn ai_status() -> AiServeStatus {
    status_snapshot()
}

/// アプリ起動時の自動開始 (有効時のみ。MCP の mcp_autostart と同型)
#[tauri::command]
pub async fn ai_autostart() -> AiServeStatus {
    if settings::load().ai_call_enabled {
        if ensure_running().is_ok() {
            // ロックは await の前に外す (MutexGuard は Send でないため)
            let pending = daemon_guard()
                .lock()
                .ok()
                .and_then(|guard| guard.as_ref().map(|d| (d.port, d.password.clone())));
            if let Some((port, password)) = pending {
                let _ = wait_healthy("127.0.0.1", port, &password).await;
            }
        } else {
            log::warn!("AIサーバを開始できません");
        }
    }
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
    pub model: Option<String>,
    pub backend_url: Option<String>,
    pub max_chars: Option<usize>,
    pub timeout_secs: Option<u64>,
    pub opencode_bin: Option<String>,
}

#[tauri::command]
pub fn ai_set_config(config: AiCallConfig) -> Result<AiServeStatus, String> {
    let mut s = settings::load();
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

    #[test]
    fn base64_matches_rfc_vector() {
        assert_eq!(base64_encode(b"opencode:pw"), "b3BlbmNvZGU6cHc=");
        assert_eq!(base64_encode(b""), "");
        assert_eq!(base64_encode(b"f"), "Zg==");
        assert_eq!(base64_encode(b"fo"), "Zm8=");
        assert_eq!(base64_encode(b"foo"), "Zm9v");
    }

    #[test]
    fn parse_model_splits_provider_and_id() {
        assert_eq!(parse_model(""), None);
        assert_eq!(parse_model("   "), None);
        assert_eq!(parse_model("noflash"), None);
        assert_eq!(
            parse_model("opencode-go/kimi-k3").unwrap(),
            json!({ "providerID": "opencode-go", "modelID": "kimi-k3" })
        );
    }

    #[test]
    fn mode_parses_and_builds_user_text() {        assert!(AiMode::parse("summary").is_ok());
        assert!(AiMode::parse("unknown").is_err());
        assert!(AiMode::Question.build_user_text("", "ctx").is_err(), "質問は必須");
        assert!(AiMode::Edit.build_user_text("", "ctx").is_err(), "指示は必須");
        let t = AiMode::Question.build_user_text("q?", "文書本文").unwrap();
        assert!(t.contains("文書本文") && t.contains("q?"));
        assert!(!AiMode::Summary.system_prompt().is_empty());
    }

        #[test]
    fn parse_listener_pid_finds_listening_owner() {        let sample = "\
  TCP    127.0.0.1:4096    0.0.0.0:0    LISTENING    5456\r\n\
  TCP    127.0.0.1:56775   127.0.0.1:4096   TIME_WAIT    0\r\n\
  TCP    127.0.0.1:42110   0.0.0.0:0    LISTENING    19284\r\n";
        assert_eq!(parse_listener_pid(sample, 4096), Some(5456));
        assert_eq!(parse_listener_pid(sample, 42110), Some(19284));
        assert_eq!(parse_listener_pid(sample, 9999), None);
    }

    #[test]
    fn own_serve_command_matches_spawn_shapes() {
        assert!(is_own_serve_command(
            "\"C:\\Users\\user\\AppData\\Roaming\\npm\\node_modules\\opencode-ai\\bin\\opencode.exe\"    serve --port 4096 --hostname 127.0.0.1",
            4096
        ));
        assert!(is_own_serve_command(
            "\"cmd\" /C opencode serve --port 4096 --hostname 127.0.0.1",
            4096
        ));
        assert!(!is_own_serve_command(
            "\"C:\\Windows\\System32\\notepad.exe\" C:\\a.txt",
            4096
        ));
        assert!(!is_own_serve_command(
            "\"cmd\" /C opencode serve --port 4097 --hostname 127.0.0.1",
            4096
        ));
    }

    /// chunked 本文の復号 (/message 応答用)。実 serve と同じ枠で検証する。
    #[tokio::test]
    async fn chunked_body_decodes() {
        let part1 = "{\"parts\":[{\"type\":\"text\",";
        let part2 = "\"text\":\"モック\"}]}";
        let raw = format!(
            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n{:x}\r\n{}\r\n{:x}\r\n{}\r\n0\r\n\r\n",
            part1.len(),
            part1,
            part2.len(),
            part2
        );
        let (mut writer, reader) = tokio::io::duplex(65536);
        writer.write_all(raw.as_bytes()).await.unwrap();
        drop(writer);
        let mut reader = BufReader::new(reader);
        // http_json と同じ手順でヘッダを読み飛ばす
        loop {
            let mut line = String::new();
            reader.read_line(&mut line).await.unwrap();
            if line == "\r\n" {
                break;
            }
        }
        let body = read_chunked_body(&mut reader).await.expect("復号できる");
        let v: Value = serde_json::from_slice(&body).expect("JSONとして読める");
        assert_eq!(extract_texts(&v).unwrap(), "モック");
    }

    #[test]
    fn extract_texts_joins_text_parts() {        let v = json!({
            "parts": [
                { "type": "step-start" },
                { "type": "text", "text": "あいう" },
                { "type": "text", "text": "えお" },
                { "type": "step-finish" },
            ]
        });
        assert_eq!(extract_texts(&v).unwrap(), "あいう\nえお");
        assert!(extract_texts(&json!({ "parts": [] })).is_err());
        assert!(extract_texts(&json!({})).is_err());
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
        let text = ask_flow("127.0.0.1", port, "pw", AiMode::Summary, "", "追加", "文書", 10)
            .await
            .expect("モック経由で応答が返る");
        assert_eq!(text, "モック応答");
    }
}
