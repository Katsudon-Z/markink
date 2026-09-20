// GUI プロセス内の MCP エンドポイント (対 stdio ブリッジ用 WebSocket)
// - 127.0.0.1 のみ bind (LAN 向けの collab_host 42100 とは完全分離 - mcp-plan.md §2.0)
// - トークン照合・レート制限・フレームサイズ上限
// - 切断時は AI 接続スロットを解放し、フロントへ通知
//
// 注意: テストから到達する関数は AppHandle を参照しないこと。
// 参照するとテストバイナリに GUI DLL 一式がリンクされ、環境によっては
// ロードに失敗する (STATUS_ENTRYPOINT_NOT_FOUND)。通知は ConnNotifier に抽象化する。

use std::sync::{Arc, Mutex as StdMutex};
use std::time::{Duration, Instant};

use futures_util::{SinkExt, StreamExt};
use tokio::net::TcpListener as AsyncTcpListener;
use tokio::sync::mpsc;
use tokio_tungstenite::tungstenite::handshake::server::{Request, Response};
use tokio_tungstenite::tungstenite::http::StatusCode;
use tokio_tungstenite::tungstenite::protocol::WebSocketConfig;
use tokio_tungstenite::tungstenite::Message;

use crate::mcp::connection::{self, ConnectionSlot};
use crate::mcp::gateway::{EditorGateway, TauriGateway};
use crate::mcp::notify;
use crate::mcp::proto::{self, ProtoContext};
use crate::settings;

pub const PORT_RANGE: std::ops::Range<u16> = 42110..42120;
pub const WS_PATH: &str = "/mcp-bridge";
const MAX_MESSAGE_SIZE: usize = 8 * 1024 * 1024;
const MAX_FRAME_SIZE: usize = 2 * 1024 * 1024;
const MAX_REQUESTS_PER_SEC: u32 = 64;

/// AI接続/切断をUIへ通知する口 (テストでは Noop を使う)
pub trait ConnNotifier: Send + Sync + 'static {
    fn connected(&self, ai_name: &str);
    fn disconnected(&self);
    /// 2本目の接続要求を拒否した (UIに理由を表示するため)
    fn rejected(&self, reason: &str);
}

#[cfg(test)]
pub struct NoopNotifier;

#[cfg(test)]
impl ConnNotifier for NoopNotifier {
    fn connected(&self, _ai_name: &str) {}
    fn disconnected(&self) {}
    fn rejected(&self, _reason: &str) {}
}

pub struct TauriNotifier {
    app: tauri::AppHandle,
}

impl TauriNotifier {
    pub fn new(app: tauri::AppHandle) -> Self {
        Self { app }
    }
}

impl ConnNotifier for TauriNotifier {
    fn connected(&self, ai_name: &str) {
        use tauri::Emitter;
        let _ = self.app.emit("mcp:connected", ai_name.to_string());
    }
    fn disconnected(&self) {
        use tauri::Emitter;
        let _ = self.app.emit("mcp:disconnected", ());
    }
    fn rejected(&self, reason: &str) {
        use tauri::Emitter;
        let _ = self.app.emit("mcp:rejected", reason.to_string());
    }
}

struct ServerHandle {
    stop_tx: mpsc::UnboundedSender<()>,
    join: tauri::async_runtime::JoinHandle<()>,
    port: u16,
}

static SERVER: StdMutex<Option<ServerHandle>> = StdMutex::new(None);

fn server_guard() -> std::sync::MutexGuard<'static, Option<ServerHandle>> {
    SERVER.lock().unwrap_or_else(|e| e.into_inner())
}

/// エンドポイントを開始し、実ポートを返す (mcp.json に接続先情報を書く)
///
/// 注意: 同期 Tauri コマンドは Tokio コンテキスト外で実行されるため、
/// この関数内では AsyncTcpListener::from_std を呼ばないこと。
/// 変換は spawn したタスク内 (run_ws_server の先頭) で行う。
pub fn start(app: tauri::AppHandle) -> Result<u16, String> {
    stop();
    let token = settings::load()
        .mcp_token
        .clone()
        .ok_or_else(|| "MCPトークンがありません (再有効化してください)".to_string())?;
    let (port, std_listener) = bind_first_available()?;
    let notifier: Arc<dyn ConnNotifier> = Arc::new(TauriNotifier::new(app.clone()));
    let gateway: Arc<dyn EditorGateway> = Arc::new(TauriGateway::new(app));
    let slot = connection::global();
    let (stop_tx, join) = spawn_server(
        std_listener,
        gateway,
        Arc::clone(&slot),
        token.clone(),
        notifier,
    );
    settings::write_endpoint(&settings::EndpointInfo {
        port,
        token,
        pid: std::process::id(),
    })?;
    *server_guard() = Some(ServerHandle { stop_tx, join, port });
    Ok(port)
}

pub fn stop() {
    if let Some(handle) = server_guard().take() {
        let _ = handle.stop_tx.send(());
        handle.join.abort();
    }
    connection::global().release();
    settings::remove_endpoint();
}

pub fn listening_port() -> Option<u16> {
    server_guard().as_ref().map(|h| h.port)
}

fn bind_first_available() -> Result<(u16, std::net::TcpListener), String> {
    for port in PORT_RANGE {
        // 明示的に 127.0.0.1 のみ (0.0.0.0 にしない)
        if let Ok(std_listener) = std::net::TcpListener::bind(("127.0.0.1", port)) {
            std_listener.set_nonblocking(true).ok();
            return Ok((port, std_listener));
        }
    }
    Err(format!(
        "MCP用のポート ({}-{}) を確保できません",
        PORT_RANGE.start,
        PORT_RANGE.end - 1
    ))
}

/// サーバタスクを起動する (本番 start() とテストで同一経路を使うため)。
/// tauri::async_runtime::spawn はグローバルランタイムを使うため、
/// Tokio コンテキスト外 (同期コマンド相当) から呼んでも安全。
pub(crate) fn spawn_server(
    std_listener: std::net::TcpListener,
    gateway: Arc<dyn EditorGateway>,
    slot: Arc<ConnectionSlot>,
    token: String,
    notifier: Arc<dyn ConnNotifier>,
) -> (
    mpsc::UnboundedSender<()>,
    tauri::async_runtime::JoinHandle<()>,
) {
    let (stop_tx, stop_rx) = mpsc::unbounded_channel();
    let join = tauri::async_runtime::spawn(run_ws_server(
        std_listener,
        stop_rx,
        gateway,
        slot,
        token,
        notifier,
    ));
    (stop_tx, join)
}

pub(crate) async fn run_ws_server(
    std_listener: std::net::TcpListener,
    mut stop_rx: mpsc::UnboundedReceiver<()>,
    gateway: Arc<dyn EditorGateway>,
    slot: Arc<ConnectionSlot>,
    token: String,
    notifier: Arc<dyn ConnNotifier>,
) {
    // from_std は Tokio コンテキストを要求するため、タスク内で変換する。
    // (同期コマンドから直接呼ぶと panic する = 有効化クラッシュの原因だった)
    let listener = match AsyncTcpListener::from_std(std_listener) {
        Ok(listener) => listener,
        Err(e) => {
            log::warn!("mcp ws listener 作成に失敗: {}", e);
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
                        let notifier = Arc::clone(&notifier);
                        tauri::async_runtime::spawn(async move {
                            if let Err(err) = handle_conn(stream, gw, slot, token, notifier).await {
                                log::debug!("mcp ws client ended: {}", err);
                            }
                        });
                    }
                    Err(e) => {
                        log::warn!("mcp ws accept error: {}", e);
                        break;
                    }
                }
            }
        }
    }
}

async fn handle_conn(
    stream: tokio::net::TcpStream,
    gateway: Arc<dyn EditorGateway>,
    slot: Arc<ConnectionSlot>,
    token: String,
    notifier: Arc<dyn ConnNotifier>,
) -> Result<(), String> {
    let mut ws_config = WebSocketConfig::default();
    ws_config.max_message_size = Some(MAX_MESSAGE_SIZE);
    ws_config.max_frame_size = Some(MAX_FRAME_SIZE);

    let mut handshake_error: Option<String> = None;
    let ws = tokio_tungstenite::accept_hdr_async_with_config(
        stream,
        |req: &Request, mut resp: Response| {
            // パスとトークンを検証 (ブラウザからの不用意な接続も防ぐ)
            let uri = req.uri().clone();
            let path_ok = uri.path() == WS_PATH;
            let token_ok = uri
                .query()
                .and_then(|q| {
                    q.split('&')
                        .find_map(|kv| kv.strip_prefix("token="))
                        .map(|v| v == token)
                })
                .unwrap_or(false);
            if !path_ok || !token_ok {
                handshake_error = Some(if path_ok { "トークン不一致" } else { "パス不正" }.into());
                *resp.status_mut() = StatusCode::FORBIDDEN;
                return Ok(resp);
            }
            Ok(resp)
        },
        Some(ws_config),
    )
    .await
    .map_err(|e| e.to_string())?;
    if let Some(reason) = handshake_error {
        return Err(reason);
    }

    let (mut sink, mut source) = ws.split();
    // レート制限 (1秒あたりのリクエスト数)
    let mut window_start = Instant::now();
    let mut window_count: u32 = 0;
    // この接続が占有したAI名 (拒否された2本目が1本目の通知を消さないため)
    let mut owned_name: Option<String> = None;
    // 文書変更の版通知 (フロント→Rust の mcp_doc_changed を購読)
    let mut change_rx = notify::subscribe();

    loop {
        tokio::select! {
            msg = source.next() => {
                match msg {
                    Some(Ok(Message::Text(text))) => {
                        if window_start.elapsed() > Duration::from_secs(1) {
                            window_start = Instant::now();
                            window_count = 0;
                        }
                        window_count += 1;
                        if window_count > MAX_REQUESTS_PER_SEC {
                            let _ = sink
                                .send(Message::Text(
                                    r#"{"jsonrpc":"2.0","id":null,"error":{"code":-32003,"message":"レート制限を超えました"}}"#.into(),
                                ))
                                .await;
                            break;
                        }
                        let was_connected = slot.is_connected();
                        let ctx = ProtoContext { connection: &slot, gateway: gateway.as_ref() };
                        let replies = proto::handle_line(text.as_str(), &ctx).await;
                        let mut ended = false;
                        for reply in &replies {
                            if sink.send(Message::Text(reply.clone().into())).await.is_err() {
                                ended = true;
                                break;
                            }
                        }
                        if ended {
                            break;
                        }
                        // 満員拒否はUIに理由を通知する (requirements.md §10.1, §10.6)
                        if let Some(reason) = proto::initialize_rejection(text.as_str(), &replies) {
                            notifier.rejected(&reason);
                        }
                        // 接続確立・解放を遷移として検出し、フロントへ通知 (AI名バッジ表示)
                        let now = slot.current_name();
                        match (&owned_name, &now) {
                            (None, Some(name)) if !was_connected => {
                                owned_name = Some(name.clone());
                                notifier.connected(name);
                            }
                            (Some(_), None) if was_connected => {
                                owned_name = None;
                                notifier.disconnected();
                            }
                            _ => {}
                        }
                    }
                    Some(Ok(Message::Close(_))) | Some(Err(_)) | None => break,
                    _ => {}
                }
            }
            // 文書変更の版通知を AI へ push (受信専聴のAIも生かすため touch する)
            evt = change_rx.recv() => {
                match evt {
                    Ok(event) => {
                        let line = notify::doc_changed_notification(&event);
                        if sink.send(Message::Text(line.into())).await.is_err() {
                            break;
                        }
                        slot.touch();
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => {}
                    Err(_) => break,
                }
            }
        }
    }

    // 自分が占有したスロットだけ解放する (他者の接続を奪わない)
    if let Some(owned) = owned_name {
        if slot.current_name().as_deref() == Some(&owned) {
            slot.release();
            notifier.disconnected();
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::mcp::gateway::MockGateway;
    use serde_json::{json, Value};
    use tokio_tungstenite::connect_async;

    fn ws_url(port: u16, token: &str) -> String {
        format!("ws://127.0.0.1:{}{}?token={}", port, WS_PATH, token)
    }

    async fn spawn_test_server(token: &str) -> u16 {
        let std_listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        std_listener.set_nonblocking(true).unwrap();
        let port = std_listener.local_addr().unwrap().port();
        let gateway: Arc<dyn EditorGateway> =
            Arc::new(MockGateway { reply: json!({"markdown": "テスト"}) });
        let notifier: Arc<dyn ConnNotifier> = Arc::new(NoopNotifier);
        let (stop_tx, _join) = spawn_server(
            std_listener,
            gateway,
            Arc::new(ConnectionSlot::new()),
            token.to_string(),
            notifier,
        );
        std::mem::forget(stop_tx); // テスト中はサーバを止めない
        tokio::time::sleep(Duration::from_millis(100)).await;
        port
    }

    /// 応答IDが一致するまで読み進める (他テストの版通知が混ざっても壊れない)
    async fn read_reply_with_id(
        source: &mut (
            impl futures_util::Stream<Item = Result<Message, tokio_tungstenite::tungstenite::Error>>
            + Unpin
        ),
        id: u64,
    ) -> Value {
        let deadline = Instant::now() + Duration::from_secs(5);
        loop {
            assert!(!deadline.saturating_duration_since(Instant::now()).is_zero(), "応答が届かない");
            let msg = source.next().await.unwrap().unwrap();
            let Message::Text(text) = msg else { continue };
            let v: Value = serde_json::from_str(text.as_str()).unwrap();
            if v.get("id").and_then(|i| i.as_u64()) == Some(id) {
                return v;
            }
        }
    }

    #[tokio::test]
    async fn ws_handshake_then_initialize_and_tool_call() {
        let port = spawn_test_server("tok").await;
        let (ws, _) = connect_async(ws_url(port, "tok")).await.expect("ハンドシェイク成功");
        let (mut sink, mut source) = ws.split();

        let init = json!({
            "jsonrpc": "2.0", "id": 1, "method": "initialize",
            "params": { "clientInfo": { "name": "test-ai" } }
        });
        sink.send(Message::Text(init.to_string().into())).await.unwrap();
        let v = read_reply_with_id(&mut source, 1).await;
        assert_eq!(v["result"]["serverInfo"]["name"], "markink");

        let call = json!({
            "jsonrpc": "2.0", "id": 2, "method": "tools/call",
            "params": { "name": "get_document", "arguments": {} }
        });
        sink.send(Message::Text(call.to_string().into())).await.unwrap();
        let v = read_reply_with_id(&mut source, 2).await;
        assert!(v["result"]["content"][0]["text"].as_str().unwrap().contains("テスト"));
    }

    #[tokio::test]
    async fn ws_pushes_doc_changed_notification() {
        use crate::mcp::notify::{self, DocChangedEvent};
        let port = spawn_test_server("tok").await;
        let (ws, _) = connect_async(ws_url(port, "tok")).await.expect("ハンドシェイク成功");
        let (mut sink, mut source) = ws.split();

        let init = json!({
            "jsonrpc": "2.0", "id": 1, "method": "initialize",
            "params": { "clientInfo": { "name": "push-ai" } }
        });
        sink.send(Message::Text(init.to_string().into())).await.unwrap();
        let reply = source.next().await.unwrap().unwrap();
        let Message::Text(text) = reply else { panic!("text 以外") };
        let v: Value = serde_json::from_str(text.as_str()).unwrap();
        assert!(v.get("result").is_some(), "initialize 成功");

        // 文書変更を発行 → サーバからのpush通知が届く (id無し)
        notify::publish(DocChangedEvent {
            version: 424242,
            origin: "human".to_string(),
            cursor_from: Some(11),
            cursor_to: Some(12),
        });
        let deadline = Instant::now() + Duration::from_secs(5);
        loop {
            let remaining = deadline.saturating_duration_since(Instant::now());
            assert!(!remaining.is_zero(), "版通知が届かない");
            let msg = tokio::time::timeout(remaining, source.next())
                .await
                .expect("受信タイムアウト")
                .unwrap()
                .unwrap();
            let Message::Text(text) = msg else { continue };
            let v: Value = serde_json::from_str(text.as_str()).unwrap();
            // 他テストの通知が混ざる可能性があるため版番号で選別する
            if v.get("id").is_none() && v["params"]["version"] == 424242 {
                assert_eq!(v["method"], "notifications/document/changed");
                assert_eq!(v["params"]["origin"], "human");
                assert_eq!(v["params"]["cursor"]["from"], 11);
                return;
            }
        }
    }

    #[tokio::test]
    async fn ws_rejects_bad_token_and_path() {
        let port = spawn_test_server("tok").await;
        assert!(connect_async(ws_url(port, "wrong")).await.is_err(), "トークン違いは拒否");
        let bad_path = format!("ws://127.0.0.1:{}/other?token=tok", port);
        assert!(connect_async(bad_path).await.is_err(), "パス違いは拒否");
    }

    #[tokio::test]
    async fn ws_boots_from_blocking_thread_like_sync_command() {
        // 回帰テスト: 同期 Tauri コマンド (mcp_set_enabled 等) は Tokio
        // コンテキスト外で実行される。以前は bind 時の from_std が panic し、
        // 有効化でアプリがクラッシュした。起動経路全体がコンテキスト外でも
        // 動作することを検証する。
        let std_listener = tokio::task::spawn_blocking(|| {
            let listener = std::net::TcpListener::bind("127.0.0.1:0").expect("bind はコンテキスト不要");
            listener.set_nonblocking(true).expect("nonblocking 化");
            listener
        })
        .await
        .unwrap();
        let port = std_listener.local_addr().unwrap().port();
        let gateway: Arc<dyn EditorGateway> =
            Arc::new(MockGateway { reply: json!({"ok": true}) });
        let notifier: Arc<dyn ConnNotifier> = Arc::new(NoopNotifier);
        let (stop_tx, _join) = tokio::task::spawn_blocking(move || {
            spawn_server(
                std_listener,
                gateway,
                Arc::new(ConnectionSlot::new()),
                "tok".to_string(),
                notifier,
            )
        })
        .await
        .unwrap();
        std::mem::forget(stop_tx);
        tokio::time::sleep(Duration::from_millis(100)).await;

        let (ws, _) = connect_async(ws_url(port, "tok")).await.expect("ハンドシェイク成功");
        let (mut sink, mut source) = ws.split();
        let init = json!({
            "jsonrpc": "2.0", "id": 1, "method": "initialize",
            "params": { "clientInfo": { "name": "regression" } }
        });
        sink.send(Message::Text(init.to_string().into())).await.unwrap();
        let v = read_reply_with_id(&mut source, 1).await;
        assert_eq!(v["result"]["serverInfo"]["name"], "markink");
    }
}
