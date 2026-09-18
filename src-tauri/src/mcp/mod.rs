// AI共同編集 (MCPサーバ) requirements.md §10 / mcp-plan.md
//
// モジュール境界 (mcp-plan.md §2.1):
// - proto / connection / catalog: I/O 無しの純粋層 (単体テスト可能)
// - gateway: EditorGateway トレイトでフロントエンド実行部へ RPC (モック可能)
// - transport_*: 運ぶだけ (プロトコル判断をしない)
// - 依存方向: transport → proto → connection / catalog / gateway (一方向)
//
// 既存の共同編集シグナリング (collab_host, 0.0.0.0:42100) とは完全分離し、
// MCP は 127.0.0.1 の 42110-42119 のみを使う。

pub mod catalog;
pub mod connection;
pub mod gateway;
pub mod notify;
pub mod proto;
pub mod transport_http;
pub mod transport_stdio;
pub mod transport_ws;

use serde::Serialize;
use tauri::AppHandle;

use crate::settings::{self, Settings};

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct McpStatus {
    pub enabled: bool,
    /// stdio ブリッジ用 WS のポート
    pub port: Option<u16>,
    /// Streamable HTTP 用のポート
    pub http_port: Option<u16>,
    /// 接続中のAI表示名 (例: "AI: Claude Desktop")
    pub connection: Option<String>,
}

pub fn status() -> McpStatus {
    let s = settings::load();
    McpStatus {
        enabled: s.mcp_enabled,
        port: transport_ws::listening_port(),
        http_port: transport_http::listening_port(),
        connection: connection::global().current_name(),
    }
}

/// WS + HTTP の両エンドポイントを開始する (片方でも失敗したら両方止める)
fn start_all(app: &AppHandle) -> Result<(), String> {
    let ws = transport_ws::start(app.clone());
    let http = transport_http::start(app.clone());
    match (ws, http) {
        (Ok(_), Ok(_)) => Ok(()),
        (Err(e), _) | (_, Err(e)) => {
            stop_all();
            Err(e)
        }
    }
}

fn stop_all() {
    transport_ws::stop();
    transport_http::stop();
}

/// アプリ起動時の自動開始。フロントエンドのマウント後にコマンドとして呼ぶ。
/// (.setup() 直下では Tokio ランタイムのコンテキストが無く from_std が
/// panic するため、非同期コマンド経由に限定する)
#[tauri::command]
pub async fn mcp_autostart(app: AppHandle) -> McpStatus {
    let mut s = settings::load();
    if !s.mcp_enabled {
        return status();
    }
    // 初回有効化時にトークンが無い場合は発行しておく
    if s.mcp_token.is_none() {
        s.mcp_token = Some(settings::generate_token());
        let _ = settings::save(&s);
    }
    if let Err(e) = start_all(&app) {
        log::warn!("MCPエンドポイントを開始できません: {}", e);
    }
    status()
}

#[tauri::command]
pub fn mcp_set_enabled(enabled: bool, app: AppHandle) -> Result<McpStatus, String> {
    let mut s = settings::load();
    s.mcp_enabled = enabled;
    if enabled && s.mcp_token.is_none() {
        s.mcp_token = Some(settings::generate_token());
    }
    settings::save(&s)?;
    if enabled {
        start_all(&app)?;
    } else {
        stop_all();
    }
    Ok(status())
}

#[tauri::command]
pub fn mcp_regenerate_token(app: AppHandle) -> Result<String, String> {
    let mut s = settings::load();
    let token = settings::generate_token();
    s.mcp_token = Some(token.clone());
    settings::save(&s)?;
    // 稼働中なら新しいトークンで待ち受けをやり直す
    if s.mcp_enabled {
        start_all(&app)?;
    }
    Ok(token)
}

/// stdio ブリッジ用の実行ファイルパス (Claude Desktop の設定に貼る)
#[tauri::command]
pub fn mcp_exe_path() -> Result<String, String> {
    std::env::current_exe()
        .map(|p| p.to_string_lossy().to_string())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn mcp_status() -> McpStatus {
    status()
}

/// AI接続をUIから切断する
#[tauri::command]
pub fn mcp_disconnect_ai() {
    connection::global().release();
}

#[tauri::command]
pub fn mcp_get_ai_auto_save() -> bool {
    settings::load().ai_auto_save
}

#[tauri::command]
pub fn mcp_set_ai_auto_save(enabled: bool) -> Result<(), String> {
    let mut s: Settings = settings::load();
    s.ai_auto_save = enabled;
    settings::save(&s)
}
