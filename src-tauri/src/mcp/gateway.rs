// フロントエンド (EditorView) でツールを実行させるためのブリッジ。
// EditorGateway トレイトに抽象化し、Tauri が無い環境でもモックでテストできる (mcp-plan.md §2.1)

use std::collections::HashMap;
use std::future::Future;
use std::pin::Pin;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::Duration;

use serde_json::{json, Value};
use tauri::{AppHandle, Emitter};
use tokio::sync::oneshot;

pub type GatewayResult = Result<Value, String>;
pub type BoxFuture<'a, T> = Pin<Box<dyn Future<Output = T> + Send + 'a>>;

pub trait EditorGateway: Send + Sync {
    fn call(&self, tool: &str, args: Value) -> BoxFuture<'_, GatewayResult>;
}

const REQUEST_TIMEOUT: Duration = Duration::from_secs(30);

static NEXT_ID: AtomicU64 = AtomicU64::new(1);
static PENDING: OnceLock<Mutex<HashMap<u64, oneshot::Sender<GatewayResult>>>> = OnceLock::new();

fn pending() -> std::sync::MutexGuard<'static, HashMap<u64, oneshot::Sender<GatewayResult>>> {
    PENDING
        .get_or_init(|| Mutex::new(HashMap::new()))
        .lock()
        .unwrap_or_else(|e| e.into_inner())
}

pub struct TauriGateway {
    app: AppHandle,
}

impl TauriGateway {
    pub fn new(app: AppHandle) -> Self {
        Self { app }
    }
}

impl EditorGateway for TauriGateway {
    fn call(&self, tool: &str, args: Value) -> BoxFuture<'_, GatewayResult> {
        let app = self.app.clone();
        let tool = tool.to_string();
        Box::pin(async move {
            let id = NEXT_ID.fetch_add(1, Ordering::Relaxed);
            let (tx, rx) = oneshot::channel();
            pending().insert(id, tx);
            let payload = json!({ "id": id, "tool": tool, "args": args });
            if app.emit("mcp:request", payload).is_err() {
                pending().remove(&id);
                return Err("フロントエンドに到達できません".to_string());
            }
            match tokio::time::timeout(REQUEST_TIMEOUT, rx).await {
                Ok(Ok(result)) => result,
                Ok(Err(_)) => Err("応答チャネルが閉じられました".to_string()),
                Err(_) => {
                    pending().remove(&id);
                    Err("エディタが応答しません (タイムアウト)。ウィンドウが開いているか確認してください".to_string())
                }
            }
        })
    }
}

/// フロントエンドからの実行結果受信 (Tauri command)
#[tauri::command]
pub fn mcp_response(id: u64, ok: bool, data: Value, error: Option<String>) {
    let tx = pending().remove(&id);
    if let Some(tx) = tx {
        let result = if ok {
            Ok(data)
        } else {
            Err(error.unwrap_or_else(|| "ツール実行に失敗しました".to_string()))
        };
        let _ = tx.send(result);
    }
}

#[cfg(test)]
pub struct MockGateway {
    pub reply: Value,
}

#[cfg(test)]
impl EditorGateway for MockGateway {
    fn call(&self, _tool: &str, _args: Value) -> BoxFuture<'_, GatewayResult> {
        Box::pin(async move { Ok(self.reply.clone()) })
    }
}
