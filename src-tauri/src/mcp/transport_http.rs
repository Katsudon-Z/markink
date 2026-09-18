// localhost 限定の最小 HTTP サーバ (Streamable HTTP 用)。
// POST /mcp のみ受け付け、1リクエストずつ処理して接続を閉じる。
// 依存追加なし (tokio のみ)。テストから到達する関数は AppHandle を参照しない
// (transport_ws と同じ理由 - STATUS_ENTRYPOINT_NOT_FOUND 回避)。

use std::sync::{Arc, Mutex as StdMutex};

use serde_json::{json, Value};
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::net::TcpListener as AsyncTcpListener;
use tokio::sync::mpsc;

use crate::mcp::connection::{self, ConnectionSlot};
use crate::mcp::gateway::{EditorGateway, TauriGateway};
use crate::mcp::proto::{self, ProtoContext};
use crate::mcp::transport_ws::ConnNotifier;
use crate::settings;

pub const HTTP_PORT_RANGE: std::ops::Range<u16> = 42120..42130;
pub const MCP_PATH: &str = "/mcp";
const MAX_BODY_SIZE: usize = 8 * 1024 * 1024;
const SESSION_HEADER: &str = "mcp-session-id";

struct ServerHandle {
    stop_tx: mpsc::UnboundedSender<()>,
    join: tauri::async_runtime::JoinHandle<()>,
    port: u16,
}

static SERVER: StdMutex<Option<ServerHandle>> = StdMutex::new(None);

fn server_guard() -> std::sync::MutexGuard<'static, Option<ServerHandle>> {
    SERVER.lock().unwrap_or_else(|e| e.into_inner())
}

use crate::mcp::transport_ws::TauriNotifier;

pub fn start(app: tauri::AppHandle) -> Result<u16, String> {
    stop();
    let token = settings::load()
        .mcp_token
        .clone()
        .ok_or_else(|| "MCPトークンがありません (再有効化してください)".to_string())?;
    let (port, std_listener) = bind_first_available()?;
    let notifier: Arc<dyn ConnNotifier> = Arc::new(TauriNotifier::new(app.clone()));
    let gateway: Arc<dyn EditorGateway> = Arc::new(TauriGateway::new(app));
    let session: Arc<StdMutex<Option<String>>> = Arc::new(StdMutex::new(None));
    let (stop_tx, join) = spawn_server(
        std_listener,
        gateway,
        connection::global(),
        token,
        session,
        notifier,
    );
    *server_guard() = Some(ServerHandle { stop_tx, join, port });
    Ok(port)
}

pub fn stop() {
    if let Some(handle) = server_guard().take() {
        let _ = handle.stop_tx.send(());
        handle.join.abort();
    }
}

pub fn listening_port() -> Option<u16> {
    server_guard().as_ref().map(|h| h.port)
}

fn bind_first_available() -> Result<(u16, std::net::TcpListener), String> {
    for port in HTTP_PORT_RANGE {
        // 明示的に 127.0.0.1 のみ
        if let Ok(std_listener) = std::net::TcpListener::bind(("127.0.0.1", port)) {
            std_listener.set_nonblocking(true).ok();
            return Ok((port, std_listener));
        }
    }
    Err(format!(
        "MCP-HTTP用のポート ({}-{}) を確保できません",
        HTTP_PORT_RANGE.start,
        HTTP_PORT_RANGE.end - 1
    ))
}

/// サーバタスクを起動する (WS 側と同様、同期コマンドから呼んでも安全)。
pub(crate) fn spawn_server(
    std_listener: std::net::TcpListener,
    gateway: Arc<dyn EditorGateway>,
    slot: Arc<ConnectionSlot>,
    token: String,
    session: Arc<StdMutex<Option<String>>>,
    notifier: Arc<dyn ConnNotifier>,
) -> (
    mpsc::UnboundedSender<()>,
    tauri::async_runtime::JoinHandle<()>,
) {
    let (stop_tx, stop_rx) = mpsc::unbounded_channel();
    let join = tauri::async_runtime::spawn(run_http_server(
        std_listener,
        stop_rx,
        gateway,
        slot,
        token,
        session,
        notifier,
    ));
    (stop_tx, join)
}

pub(crate) async fn run_http_server(
    std_listener: std::net::TcpListener,
    mut stop_rx: mpsc::UnboundedReceiver<()>,
    gateway: Arc<dyn EditorGateway>,
    slot: Arc<ConnectionSlot>,
    token: String,
    session: Arc<StdMutex<Option<String>>>,
    notifier: Arc<dyn ConnNotifier>,
) {
    // from_std は Tokio コンテキストを要求するため、タスク内で変換する (WS 側と同様)
    let listener = match AsyncTcpListener::from_std(std_listener) {
        Ok(listener) => listener,
        Err(e) => {
            log::warn!("mcp http listener 作成に失敗: {}", e);
            return;
        }
    };
    loop {
        tokio::select! {
            _ = stop_rx.recv() => break,
            res = listener.accept() => {
                match res {
                    Ok((stream, _peer)) => {
                        let gw = Arc::clone(&gateway);
                        let slot = Arc::clone(&slot);
                        let token = token.clone();
                        let session = Arc::clone(&session);
                        let notifier = Arc::clone(&notifier);
                        tauri::async_runtime::spawn(async move {
                            if let Err(err) = handle_http(stream, gw, slot, token, session, notifier).await {
                                log::debug!("mcp http request ended: {}", err);
                            }
                        });
                    }
                    Err(e) => {
                        log::warn!("mcp http accept error: {}", e);
                        break;
                    }
                }
            }
        }
    }
}

struct HttpRequest {
    method: String,
    path: String,
    authorization: Option<String>,
    session_id: Option<String>,
    content_length: usize,
    expect_continue: bool,
}

async fn read_request<R>(reader: &mut BufReader<R>) -> Result<HttpRequest, String>
where
    R: tokio::io::AsyncRead + Unpin,
{
    let mut request_line = String::new();
    let n = reader.read_line(&mut request_line).await.map_err(|e| e.to_string())?;
    if n == 0 {
        return Err("empty request".into());
    }
    let parts: Vec<&str> = request_line.trim_end().split_whitespace().collect();
    if parts.len() != 3 {
        return Err("不正なリクエスト行です".into());
    }
    let mut req = HttpRequest {
        method: parts[0].to_string(),
        path: parts[1].to_string(),
        authorization: None,
        session_id: None,
        content_length: 0,
        expect_continue: false,
    };
    loop {
        let mut line = String::new();
        reader.read_line(&mut line).await.map_err(|e| e.to_string())?;
        let line = line.trim_end();
        if line.is_empty() {
            break;
        }
        if let Some((name, value)) = line.split_once(':') {
            match name.trim().to_ascii_lowercase().as_str() {
                "content-length" => req.content_length = value.trim().parse().unwrap_or(0),
                "authorization" => req.authorization = Some(value.trim().to_string()),
                "mcp-session-id" => req.session_id = Some(value.trim().to_string()),
                "expect" => {
                    if value.trim().eq_ignore_ascii_case("100-continue") {
                        req.expect_continue = true;
                    }
                }
                _ => {}
            }
        }
    }
    Ok(req)
}

async fn handle_http(
    stream: tokio::net::TcpStream,
    gateway: Arc<dyn EditorGateway>,
    slot: Arc<ConnectionSlot>,
    token: String,
    session: Arc<StdMutex<Option<String>>>,
    notifier: Arc<dyn ConnNotifier>,
) -> Result<(), String> {
    let (reader_half, mut writer) = stream.into_split();
    let mut reader = BufReader::new(reader_half);

    let req = match read_request(&mut reader).await {
        Ok(req) => req,
        Err(e) => {
            respond(&mut writer, 400, json!({ "error": e })).await?;
            return Ok(());
        }
    };

    if !(req.method == "POST" && req.path == MCP_PATH) {
        if req.method == "GET" && req.path == MCP_PATH {
            // SSE ストリームは初期版対象外
            respond(&mut writer, 405, json!({ "error": "GET には対応していません。POST /mcp を使用してください" })).await?;
        } else {
            respond(&mut writer, 404, json!({ "error": "見つかりません" })).await?;
        }
        return Ok(());
    }

    // Bearer トークン認証 (常時必須)
    let authorized = req
        .authorization
        .as_deref()
        .is_some_and(|a| a == format!("Bearer {}", token));
    if !authorized {
        respond(&mut writer, 401, json!({ "error": "認証が必要です (Bearer トークン)" })).await?;
        return Ok(());
    }

    if req.content_length > MAX_BODY_SIZE {
        respond(&mut writer, 413, json!({ "error": "リクエストが大きすぎます" })).await?;
        return Ok(());
    }
    if req.expect_continue {
        writer.write_all(b"HTTP/1.1 100 Continue\r\n\r\n").await.map_err(|e| e.to_string())?;
    }
    let mut body = vec![0u8; req.content_length];
    reader.read_exact(&mut body).await.map_err(|e| e.to_string())?;
    let text = String::from_utf8(body).map_err(|_| "UTF-8 ではありません".to_string())?;

    // セッション検証: ヘッダがあれば一致必須 (不一致・失効は再 initialize を促す)
    let stored = session.lock().unwrap_or_else(|e| e.into_inner()).clone();
    if let Some(given) = req.session_id.as_deref() {
        if stored.as_deref() != Some(given) {
            respond(
                &mut writer,
                400,
                json!({ "error": "セッションが無効です。initialize からやり直してください" }),
            )
            .await?;
            return Ok(());
        }
    }

    let was_connected = slot.is_connected();
    let ctx = ProtoContext { connection: &slot, gateway: gateway.as_ref() };
    let replies = proto::handle_line(&text, &ctx).await;
    // 満員拒否はUIに理由を通知する (requirements.md §10.1, §10.6)
    if let Some(reason) = proto::initialize_rejection(&text, &replies) {
        notifier.rejected(&reason);
    }
    // disconnect ツールで解放されたらセッションも捨て、フロントへ通知する
    if was_connected && !slot.is_connected() {
        *session.lock().unwrap_or_else(|e| e.into_inner()) = None;
        notifier.disconnected();
    }

    if replies.is_empty() {
        respond_status(&mut writer, 202, "Accepted", &[], &[]).await?;
        return Ok(());
    }
    let reply = replies.join("\n");

    // initialize 成功時は新しいセッションIDを発行し、フロントへ接続を通知する
    // (WS側と同様にAI名バッジ・AIカーソル・版通知の送り先が有効になる)
    let mut extra = Vec::new();
    if is_initialize_success(&text, &reply) {
        let id = settings::generate_token();
        extra.push((SESSION_HEADER, id.clone()));
        *session.lock().unwrap_or_else(|e| e.into_inner()) = Some(id);
        if let Some(name) = slot.current_name() {
            notifier.connected(&name);
        }
    }
    respond_status(&mut writer, 200, "OK", &extra, reply.as_bytes()).await?;
    Ok(())
}

/// リクエストが initialize で、応答が成功 (result あり) か
fn is_initialize_success(request_text: &str, reply_text: &str) -> bool {
    let is_init = serde_json::from_str::<Value>(request_text)
        .ok()
        .and_then(|v| v.get("method").and_then(|m| m.as_str()).map(|m| m == "initialize"))
        .unwrap_or(false);
    if !is_init {
        return false;
    }
    serde_json::from_str::<Value>(reply_text)
        .ok()
        .is_some_and(|v| v.get("result").is_some())
}

async fn respond(
    writer: &mut tokio::net::tcp::OwnedWriteHalf,
    status: u16,
    body: Value,
) -> Result<(), String> {
    let reason = match status {
        400 => "Bad Request",
        401 => "Unauthorized",
        404 => "Not Found",
        405 => "Method Not Allowed",
        413 => "Content Too Large",
        _ => "Error",
    };
    respond_status(writer, status, reason, &[], body.to_string().as_bytes()).await
}

async fn respond_status(
    writer: &mut tokio::net::tcp::OwnedWriteHalf,
    status: u16,
    reason: &str,
    extra_headers: &[(&str, String)],
    body: &[u8],
) -> Result<(), String> {
    let mut head = format!(
        "HTTP/1.1 {} {}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n",
        status,
        reason,
        body.len()
    );
    for (name, value) in extra_headers {
        head.push_str(&format!("{}: {}\r\n", name, value));
    }
    head.push_str("\r\n");
    writer.write_all(head.as_bytes()).await.map_err(|e| e.to_string())?;
    writer.write_all(body).await.map_err(|e| e.to_string())?;
    writer.flush().await.map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::mcp::gateway::MockGateway;
    use crate::mcp::transport_ws::{ConnNotifier, NoopNotifier};
    use std::time::Duration;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    async fn spawn_test_server(token: &str) -> (u16, Arc<ConnectionSlot>) {
        spawn_test_server_with(token, Arc::new(NoopNotifier)).await
    }

    async fn spawn_test_server_with(
        token: &str,
        notifier: Arc<dyn ConnNotifier>,
    ) -> (u16, Arc<ConnectionSlot>) {
        let std_listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        std_listener.set_nonblocking(true).unwrap();
        let port = std_listener.local_addr().unwrap().port();
        let gateway: Arc<dyn EditorGateway> = Arc::new(MockGateway { reply: json!({"ok": true}) });
        let slot = Arc::new(ConnectionSlot::new());
        let session: Arc<StdMutex<Option<String>>> = Arc::new(StdMutex::new(None));
        let (stop_tx, _join) = spawn_server(
            std_listener,
            gateway,
            Arc::clone(&slot),
            token.to_string(),
            session,
            notifier,
        );
        std::mem::forget(stop_tx);
        tokio::time::sleep(Duration::from_millis(100)).await;
        (port, slot)
    }

    /// 接続通知の記録用 (initialize/disconnect でフロント通知が出ることの検証)
    #[derive(Default, Clone)]
    struct RecNotifier {
        events: Arc<StdMutex<Vec<String>>>,
    }

    impl ConnNotifier for RecNotifier {
        fn connected(&self, name: &str) {
            self.events.lock().unwrap().push(format!("connected:{}", name));
        }
        fn disconnected(&self) {
            self.events.lock().unwrap().push("disconnected".to_string());
        }
        fn rejected(&self, reason: &str) {
            self.events.lock().unwrap().push(format!("rejected:{}", reason));
        }
    }

    struct HttpResponse {
        status: u16,
        headers: Vec<(String, String)>,
        body: String,
    }

    async fn post(port: u16, path: &str, token: Option<&str>, session: Option<&str>, body: &str) -> HttpResponse {
        let mut stream = tokio::net::TcpStream::connect(("127.0.0.1", port)).await.unwrap();
        let mut req = format!(
            "POST {} HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n",
            path,
            body.len()
        );
        if let Some(t) = token {
            req.push_str(&format!("Authorization: Bearer {}\r\n", t));
        }
        if let Some(s) = session {
            req.push_str(&format!("{}: {}\r\n", SESSION_HEADER, s));
        }
        req.push_str("\r\n");
        stream.write_all(req.as_bytes()).await.unwrap();
        stream.write_all(body.as_bytes()).await.unwrap();
        read_response(&mut stream).await
    }

    async fn read_response(stream: &mut tokio::net::TcpStream) -> HttpResponse {
        let mut buf = Vec::new();
        stream.read_to_end(&mut buf).await.unwrap();
        let text = String::from_utf8_lossy(&buf).to_string();
        let (head, body) = text.split_once("\r\n\r\n").unwrap_or((text.as_str(), ""));
        let mut lines = head.lines();
        let status_line = lines.next().unwrap_or("");
        let status: u16 = status_line.split_whitespace().nth(1).unwrap_or("0").parse().unwrap_or(0);
        let mut headers = Vec::new();
        for line in lines {
            if let Some((name, value)) = line.split_once(':') {
                headers.push((name.trim().to_ascii_lowercase(), value.trim().to_string()));
            }
        }
        HttpResponse { status, headers, body: body.to_string() }
    }

    fn session_header(resp: &HttpResponse) -> Option<String> {
        resp.headers.iter().find(|(n, _)| n == SESSION_HEADER).map(|(_, v)| v.clone())
    }

    #[tokio::test]
    async fn http_initialize_issues_session() {
        let (port, _slot) = spawn_test_server("tok").await;
        let body = json!({
            "jsonrpc": "2.0", "id": 1, "method": "initialize",
            "params": { "clientInfo": { "name": "http-ai" } }
        })
        .to_string();
        let resp = post(port, MCP_PATH, Some("tok"), None, &body).await;
        assert_eq!(resp.status, 200);
        let v: Value = serde_json::from_str(&resp.body).unwrap();
        assert_eq!(v["result"]["serverInfo"]["name"], "MDNotepad");
        assert!(session_header(&resp).is_some(), "セッションIDを発行する");
    }

    #[tokio::test]
    async fn http_rejects_bad_token_and_path() {
        let (port, _slot) = spawn_test_server("tok").await;
        let body = json!({ "jsonrpc": "2.0", "id": 1, "method": "ping" }).to_string();
        let resp = post(port, MCP_PATH, Some("wrong"), None, &body).await;
        assert_eq!(resp.status, 401);
        let resp = post(port, MCP_PATH, None, None, &body).await;
        assert_eq!(resp.status, 401);
        let resp = post(port, "/other", Some("tok"), None, &body).await;
        assert_eq!(resp.status, 404);
    }

    #[tokio::test]
    async fn http_second_initialize_is_rejected_in_band() {
        let (port, _slot) = spawn_test_server("tok").await;
        let init = |id: u64, name: &str| {
            json!({
                "jsonrpc": "2.0", "id": id, "method": "initialize",
                "params": { "clientInfo": { "name": name } }
            })
            .to_string()
        };
        let first = post(port, MCP_PATH, Some("tok"), None, &init(1, "a")).await;
        assert_eq!(first.status, 200);
        let second = post(port, MCP_PATH, Some("tok"), None, &init(2, "b")).await;
        assert_eq!(second.status, 200);
        let v: Value = serde_json::from_str(&second.body).unwrap();
        assert!(v["error"]["message"].as_str().unwrap().contains("AI: a"));
    }

    #[tokio::test]
    async fn http_stale_session_requires_reinitialize() {
        let (port, _slot) = spawn_test_server("tok").await;
        let ping = json!({ "jsonrpc": "2.0", "id": 1, "method": "ping" }).to_string();
        // 存在しないセッションID付きは 400
        let resp = post(port, MCP_PATH, Some("tok"), Some("stale-id"), &ping).await;
        assert_eq!(resp.status, 400);
        // 無しは通る (寛容)
        let resp = post(port, MCP_PATH, Some("tok"), None, &ping).await;
        assert_eq!(resp.status, 200);
    }

    #[tokio::test]
    async fn http_disconnect_tool_releases_slot() {
        let (port, slot) = spawn_test_server("tok").await;
        let init = json!({
            "jsonrpc": "2.0", "id": 1, "method": "initialize",
            "params": { "clientInfo": { "name": "a" } }
        })
        .to_string();
        let resp = post(port, MCP_PATH, Some("tok"), None, &init).await;
        let session = session_header(&resp).expect("セッション発行");
        assert!(slot.is_connected());

        let disc = json!({
            "jsonrpc": "2.0", "id": 2, "method": "tools/call",
            "params": { "name": "disconnect", "arguments": {} }
        })
        .to_string();
        let resp = post(port, MCP_PATH, Some("tok"), Some(&session), &disc).await;
        assert_eq!(resp.status, 200);
        assert!(!slot.is_connected());
        // 古いセッションIDは失効する
        let ping = json!({ "jsonrpc": "2.0", "id": 3, "method": "ping" }).to_string();
        let resp = post(port, MCP_PATH, Some("tok"), Some(&session), &ping).await;
        assert_eq!(resp.status, 400);
    }

    #[tokio::test]
    async fn http_initialize_and_disconnect_notify_frontend() {
        let rec = Arc::new(RecNotifier::default());
        let notifier: Arc<dyn ConnNotifier> = Arc::clone(&rec) as Arc<dyn ConnNotifier>;
        let (port, _slot) = spawn_test_server_with("tok", notifier).await;
        let init = json!({
            "jsonrpc": "2.0", "id": 1, "method": "initialize",
            "params": { "clientInfo": { "name": "http-ai" } }
        })
        .to_string();
        let resp = post(port, MCP_PATH, Some("tok"), None, &init).await;
        assert_eq!(resp.status, 200);
        let session = session_header(&resp).expect("セッション発行");
        let events = rec.events.lock().unwrap().clone();
        assert!(
            events.iter().any(|e| e == "connected:AI: http-ai"),
            "initialize成功で接続通知: {:?}",
            events
        );

        let disc = json!({
            "jsonrpc": "2.0", "id": 2, "method": "tools/call",
            "params": { "name": "disconnect", "arguments": {} }
        })
        .to_string();
        let resp = post(port, MCP_PATH, Some("tok"), Some(&session), &disc).await;
        assert_eq!(resp.status, 200);
        let events = rec.events.lock().unwrap().clone();
        assert!(
            events.iter().any(|e| e == "disconnected"),
            "disconnectで切断通知: {:?}",
            events
        );
    }

    #[tokio::test]
    async fn http_rejects_oversize_body() {
        let (port, _slot) = spawn_test_server("tok").await;
        let mut stream = tokio::net::TcpStream::connect(("127.0.0.1", port)).await.unwrap();
        let req = format!(
            "POST {} HTTP/1.1\r\nHost: x\r\nAuthorization: Bearer tok\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
            MCP_PATH,
            MAX_BODY_SIZE + 1
        );
        stream.write_all(req.as_bytes()).await.unwrap();
        let resp = read_response(&mut stream).await;
        assert_eq!(resp.status, 413);
    }
}
