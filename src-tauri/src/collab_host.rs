// 共同編集シグナリング (C案):
// 最初に起動したアプリが LAN 内シグナリング WS サーバとなり、
// その接続情報を SMB 共有上の文書フォルダに置くことで他端末が発見する。
// ホスト選定の仲裁は「既知 TCP ポートの bind 成功」。

use std::collections::{HashMap, HashSet};
use std::net::{IpAddr, SocketAddr, TcpStream};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex as StdMutex};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::Manager;
use tokio::net::TcpListener as AsyncTcpListener;
use tokio::sync::mpsc;

use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::tungstenite::handshake::server::{Request, Response};
use futures_util::{SinkExt, StreamExt};
use crate::collab_relay;

pub const SIGNAL_PORT: u16 = 42100;
const MARKER_DIR: &str = ".mdnotepad";
const MARKER_FILE: &str = "signaling.json";

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct HostMarker {
    pub ip: String,
    pub port: u16,
    #[serde(default)]
    pub room: String,
    /// 同時起動の競合解決用トークン (マーカーを最後に書いた側を勝者にする)
    #[serde(default)]
    pub token: String,
}

#[derive(Debug, Serialize)]
pub struct SignalInfo {
    pub role: String, // "host" | "client"
    pub url: String,
}

#[derive(Default)]
struct SignalingOwned {
    marker_path: Option<PathBuf>,
    stop_tx: Option<mpsc::UnboundedSender<()>>,
}

static OWNED: StdMutex<Option<SignalingOwned>> = StdMutex::new(None);

fn marker_path_for(doc_dir: &Path) -> Result<PathBuf, String> {
    let dir = doc_dir.join(MARKER_DIR);
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join(MARKER_FILE))
}

fn probe_host(ip: &str, port: u16) -> bool {
    let Some(addr) = ip
        .parse::<IpAddr>()
        .ok()
        .map(|a| SocketAddr::new(a, port))
    else {
        return false;
    };
    TcpStream::connect_timeout(&addr, Duration::from_millis(500)).is_ok()
}

fn read_marker(path: &Path) -> Option<HostMarker> {
    let content = std::fs::read_to_string(path).ok()?;
    serde_json::from_str::<HostMarker>(&content).ok()
}

fn write_marker(path: &Path, marker: &HostMarker) -> Result<(), String> {
    std::fs::write(path, serde_json::to_string(marker).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())
}

/// 別プロセス・別端末と衝突しない一意なトークン
fn new_token() -> String {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    format!("{}-{}", std::process::id(), nanos)
}

/// LAN 上での自 IP 取得: インターフェース列挙から非ループバック IPv4 を選択
fn local_lan_ip() -> Option<String> {
    match local_ip_address::local_ip() {
        Ok(IpAddr::V4(v4)) if !v4.is_loopback() => return Some(v4.to_string()),
        _ => {}
    }
    // local_ip() は経路優先の 1 候補のみ。フォールバックとして全インターフェースを確認
    let mut candidates: Vec<std::net::Ipv4Addr> = local_ip_address::list_afinet_netifas()
        .unwrap_or_default()
        .into_iter()
        .filter_map(|(_, ip)| match ip {
            IpAddr::V4(v4) if !v4.is_loopback() => Some(v4),
            _ => None,
        })
        .collect();
    candidates.sort_by_key(|v4| {
        let octets = v4.octets();
        // 192.168/10/172.16 を優先
        if octets[0] == 192 && octets[1] == 168 { 0 } else { 1 }
    });
    candidates.first().map(|v4| v4.to_string())
}

/// 非同期: マーカー参照 + bind 競争でホスト/参加を決める
pub async fn resolve_signal(doc_dir: &Path, room: &str) -> Result<SignalInfo, String> {
    let marker_path = marker_path_for(doc_dir)?;

    // 1. 既存マーカー: 生きたホストなら参加
    if let Some(marker) = read_marker(&marker_path) {
        if probe_host(&marker.ip, marker.port) {
            return Ok(SignalInfo {
                role: "client".into(),
                url: format!("ws://{}:{}", marker.ip, marker.port),
            });
        }
        // 死んだホスト → 再選出
        let _ = std::fs::remove_file(&marker_path);
    }

    // 2. 既知ポートの bind に勝った者がホスト (同一マシン内の仲裁)
    let spawned = spawn_signaling_server(SIGNAL_PORT);
    if spawned.is_err() {
        return Ok(SignalInfo {
            role: "client".into(),
            url: format!("ws://127.0.0.1:{}", SIGNAL_PORT),
        });
    }

    // 3. マーカーを公開する。別端末が同時に起動した場合は bind が互いに成功して
    //    しまうため、書き込みが交差したときは最後に書いた側を勝者にする。
    let ip = local_lan_ip().unwrap_or_else(|| "127.0.0.1".to_string());
    let url = format!("ws://{}:{}", ip, SIGNAL_PORT);
    let token = new_token();
    write_marker(
        &marker_path,
        &HostMarker { ip: ip.clone(), port: SIGNAL_PORT, room: room.to_string(), token: token.clone() },
    )?;

    // 書き込みが反映されるのを待って再確認 (相手のマーカーが生きていれば降格)
    tokio::time::sleep(Duration::from_millis(400)).await;
    match read_marker(&marker_path) {
        Some(marker) if marker.token == token => {}
        Some(marker) if probe_host(&marker.ip, marker.port) => {
            release_server();
            return Ok(SignalInfo {
                role: "client".into(),
                url: format!("ws://{}:{}", marker.ip, marker.port),
            });
        }
        _ => {
            // 相手のマーカーが死んでいる/消えている → 自分の情報を書き直してホスト継続
            write_marker(
                &marker_path,
                &HostMarker { ip, port: SIGNAL_PORT, room: room.to_string(), token },
            )?;
        }
    }

    Ok(SignalInfo { role: "host".into(), url })
}

/// セッション終了: ホストなら停止してマーカーを消す
pub fn release() {
    let taken = {
        let mut owned = OWNED.lock().unwrap();
        owned.take()
    };
    if let Some(owned) = taken {
        if let Some(tx) = owned.stop_tx {
            let _ = tx.send(());
        }
        if let Some(path) = owned.marker_path {
            let _ = std::fs::remove_file(path);
        }
    }
}

// ── WebSocket シグナリング (y-webrtc 互換 relay) ─────────────────────

type Tx = mpsc::UnboundedSender<Message>;
type Registry = Arc<StdMutex<HashMap<u64, Client>>>;

struct Client {
    topics: HashSet<String>,
    tx: Tx,
}

fn next_client_id() -> u64 {
    static ID: AtomicU64 = AtomicU64::new(1);
    ID.fetch_add(1, Ordering::Relaxed)
}

async fn run_signaling(listener: AsyncTcpListener, mut stop_rx: mpsc::UnboundedReceiver<()>) {
    let registry: Registry = Arc::new(StdMutex::new(HashMap::new()));
    loop {
        tokio::select! {
            _ = stop_rx.recv() => break,
            res = listener.accept() => {
                match res {
                    Ok((stream, _)) => {
                        let reg = Arc::clone(&registry);
                        let client_id = next_client_id();
                        tauri::async_runtime::spawn(async move {
                            if let Err(err) = handle_client(stream, reg, client_id).await {
                                log::debug!("signaling client ended: {}", err);
                            }
                        });
                    }
                    Err(e) => {
                        log::warn!("signaling accept error: {}", e);
                        break;
                    }
                }
            }
        }
    }
    registry.lock().unwrap().clear();
}

async fn handle_client(stream: tokio::net::TcpStream, registry: Registry, client_id: u64) -> Result<(), String> {
    // パスで用途を振り分け: "/" は y-webrtc シグナリング、"/<room>" は Yjs 中継
    let mut raw_path = String::new();
    let ws = tokio_tungstenite::accept_hdr_async(stream, |req: &Request, resp: Response| {
        raw_path = req.uri().path().to_string();
        Ok(resp)
    })
    .await
    .map_err(|e| e.to_string())?;
    if let Some(room_name) = collab_relay::relay_route(&raw_path) {
        return handle_relay_client(ws, room_name, client_id).await;
    }
    let (mut sink, mut source) = ws.split();
    let (tx, mut rx) = mpsc::unbounded_channel::<Message>();
    {
        let mut clients = registry.lock().unwrap();
        clients.insert(client_id, Client { topics: HashSet::new(), tx });
    }

    let writer = tauri::async_runtime::spawn(async move {
        while let Some(msg) = rx.recv().await {
            if sink.send(msg).await.is_err() {
                break;
            }
        }
    });

    while let Some(msg) = source.next().await {
        if let Ok(Message::Text(text)) = msg {
            handle_text(&registry, client_id, &text);
        } else if msg.is_err() {
            break;
        }
    }

    registry.lock().unwrap().remove(&client_id);
    writer.abort();
    Ok(())
}

/// Yjs 中継クライアント (y-websocket 互換バイナリ)
async fn handle_relay_client(
    ws: tokio_tungstenite::WebSocketStream<tokio::net::TcpStream>,
    room_name: String,
    client_id: u64,
) -> Result<(), String> {
    let (mut sink, mut source) = ws.split();
    let (tx, mut rx) = mpsc::unbounded_channel::<Message>();
    collab_relay::relay_subscribe(&room_name, client_id, tx);

    let writer = tauri::async_runtime::spawn(async move {
        while let Some(msg) = rx.recv().await {
            if sink.send(msg).await.is_err() {
                break;
            }
        }
    });

    while let Some(msg) = source.next().await {
        match msg {
            Ok(Message::Binary(data)) => {
                let (replies, others) = collab_relay::relay_handle(&room_name, client_id, &data);
                // 応答は送信者へ
                if let Some(own) = collab_relay::relay_own_tx(&room_name, client_id) {
                    for reply in replies {
                        let _ = own.send(Message::Binary(reply.into()));
                    }
                }
                // 他者へ素通し転送
                let payload = Message::Binary(data);
                let mut forwarded: u64 = 0;
                for other in &others {
                    if other.send(payload.clone()).is_ok() {
                        forwarded += 1;
                    }
                }
                collab_relay::relay_count_forwarded(&room_name, forwarded);
            }
            Ok(Message::Close(_)) | Err(_) => break,
            _ => {}
        }
    }

    collab_relay::relay_unsubscribe(client_id);
    writer.abort();
    Ok(())
}

fn handle_text(registry: &Registry, client_id: u64, text: &str) {
    let Ok(v) = serde_json::from_str::<serde_json::Value>(text) else {
        return;
    };
    match v.get("type").and_then(|t| t.as_str()).unwrap_or("") {
        "subscribe" => {
            let mut clients = registry.lock().unwrap();
            if let Some(c) = clients.get_mut(&client_id) {
                for t in v
                    .get("topics")
                    .and_then(|t| t.as_array())
                    .into_iter()
                    .flatten()
                    .filter_map(|t| t.as_str().map(str::to_string))
                {
                    c.topics.insert(t);
                }
            }
        }
        "publish" => {
            if let Some(topic) = v.get("topic").and_then(|t| t.as_str()) {
                let payload = Message::Text(text.to_string().into());
                let clients = registry.lock().unwrap();
                for (other_id, client) in clients.iter() {
                    if *other_id != client_id && client.topics.contains(topic) {
                        let _ = client.tx.send(payload.clone());
                    }
                }
            }
        }
        _ => {}
    }
}

struct ServerHandle {
    stop_tx: mpsc::UnboundedSender<()>,
    join: tauri::async_runtime::JoinHandle<()>,
}

static SERVER: StdMutex<Option<ServerHandle>> = StdMutex::new(None);

fn spawn_signaling_server(port: u16) -> Result<(), String> {
    let bound = std::net::TcpListener::bind(("0.0.0.0", port)).map_err(|e| e.to_string())?;
    bound.set_nonblocking(true).ok();
    let listener = AsyncTcpListener::from_std(bound).map_err(|e| e.to_string())?;
    let (stop_tx, stop_rx) = mpsc::unbounded_channel::<()>();
    let join = tauri::async_runtime::spawn(async move {
        run_signaling(listener, stop_rx).await;
    });
    let mut hold = SERVER.lock().unwrap();
    *hold = Some(ServerHandle { stop_tx, join });
    Ok(())
}

// ── Tauri コマンド ────────────────────────────────────────

#[tauri::command]
pub async fn collab_resolve_signal(app: tauri::AppHandle, doc_dir: String, room: String) -> Result<SignalInfo, String> {
    let dir: PathBuf = if doc_dir.is_empty() {
        fallback_dir(&app)
    } else {
        PathBuf::from(doc_dir)
    };
    let info = resolve_signal(&dir, &room).await?;
    Ok(info)
}

#[tauri::command]
pub fn collab_release_signal() {
    release();
    release_server();
}

/// 参照のみ: 既存ホストが生きていれば参加 URL を返す (bind しない・書き込まない)
pub async fn probe_signal(doc_dir: &Path) -> Option<SignalInfo> {
    let marker_path = marker_path_for(doc_dir).ok()?;
    let content = std::fs::read_to_string(&marker_path).ok()?;
    let marker = serde_json::from_str::<HostMarker>(&content).ok()?;
    if probe_host(&marker.ip, marker.port) {
        Some(SignalInfo {
            role: "client".into(),
            url: format!("ws://{}:{}", marker.ip, marker.port),
        })
    } else {
        None
    }
}

#[tauri::command]
pub async fn collab_probe_signal(app: tauri::AppHandle, doc_dir: String) -> Result<Option<SignalInfo>, String> {
    let dir: PathBuf = if doc_dir.is_empty() {
        fallback_dir(&app)
    } else {
        PathBuf::from(doc_dir)
    };
    Ok(probe_signal(&dir).await)
}

fn release_server() {
    let hold = SERVER.lock().unwrap().take();
    if let Some(ServerHandle { stop_tx, join }) = hold {
        let _ = stop_tx.send(());
        join.abort();
    }
}

fn fallback_dir(app: &tauri::AppHandle) -> PathBuf {
    let dir = app.path().app_local_data_dir().unwrap_or_else(|_| PathBuf::from("."));
    std::fs::create_dir_all(&dir).ok();
    dir
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio_tungstenite::connect_async;

    #[tokio::test]
    async fn signaling_relay_between_clients() {
        let bound = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = bound.local_addr().unwrap().port();
        bound.set_nonblocking(true).unwrap();
        let listener = AsyncTcpListener::from_std(bound).unwrap();
        let (_stop_tx, stop_rx) = mpsc::unbounded_channel::<()>();
        tauri::async_runtime::spawn(run_signaling(listener, stop_rx));
        tokio::time::sleep(Duration::from_millis(200)).await;

        let url = format!("ws://127.0.0.1:{}", port);
        let (aws, _) = connect_async(&url).await.unwrap();
        let (mut a_sink, mut a) = aws.split();
        let (bws, _) = connect_async(&url).await.unwrap();
        let (mut b, _) = bws.split();

        let topic = serde_json::json!({"type":"subscribe","topics":["roomA"]}).to_string();
        a_sink.send(Message::Text(topic.clone().into())).await.unwrap();
        b.send(Message::Text(topic.into())).await.unwrap();
        tokio::time::sleep(Duration::from_millis(200)).await;

        let announce = serde_json::json!({"type":"publish","topic":"roomA","data":{"type":"announce","from":"peerB"}}).to_string();
        b.send(Message::Text(announce.clone().into())).await.unwrap();

        let received = tokio::time::timeout(Duration::from_secs(3), async move {
            while let Some(msg) = a.next().await {
                if let Message::Text(t) = msg.expect("ws error") {
                    return t.to_string();
                }
            }
            panic!("stream closed");
        })
        .await
        .unwrap();
        assert_eq!(received, announce);
    }

    #[tokio::test]
    async fn marker_write_parse_roundtrip() {
        let marker = HostMarker { ip: "10.1.2.3".into(), port: 42100, room: "r".into(), ..Default::default() };
        let json = serde_json::to_string(&marker).unwrap();
        let parsed: HostMarker = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.port, 42100);
        assert!(parsed.token.is_empty());
    }

    #[tokio::test]
    async fn probe_returns_client_url_when_marker_points_to_live_host() {
        let dir = std::env::temp_dir().join("mdn-probe-test");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();

        // ダミーの生きたホスト (TCP だけ受け付ける)
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        std::thread::spawn(move || {
            for _ in 0..4 {
                if let Ok((stream, _)) = listener.accept() {
                    // probe 用の接続を受けて即閉じる
                    drop(stream);
                }
            }
        });
        let marker_dir = dir.join(".mdnotepad");
        std::fs::create_dir_all(&marker_dir).unwrap();
        std::fs::write(
            marker_dir.join("signaling.json"),
            serde_json::to_string(&HostMarker { ip: "127.0.0.1".into(), port, room: "doc".into(), ..Default::default() }).unwrap(),
        )
        .unwrap();

        let found = probe_signal(&dir).await.expect("生きたホストは検出される");
        assert_eq!(found.role, "client");
        assert_eq!(found.url, format!("ws://127.0.0.1:{}", port));

        // 死んだマーカーは検出されない
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&marker_dir).unwrap();
        std::fs::write(
            marker_dir.join("signaling.json"),
            serde_json::to_string(&HostMarker { ip: "127.0.0.1".into(), port: 1, room: "doc".into(), ..Default::default() }).unwrap(),
        )
        .unwrap();
        assert!(probe_signal(&dir).await.is_none());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
