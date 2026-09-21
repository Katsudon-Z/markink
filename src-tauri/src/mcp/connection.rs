// AI接続スロット: 同時1本限定 (requirements.md §10.1)
// I/O を持たない純粋な状態機械とし、テストは socket 無しで成立させる (mcp-plan.md §2.1)

use std::sync::{Arc, Mutex, MutexGuard, OnceLock};
use std::time::{Duration, Instant};

use serde_json::Value;

/// 一定時間操作が無い接続の自動解放 (HTTP は切断検知ができないための安全策)
pub const DEFAULT_IDLE_TIMEOUT: Duration = Duration::from_secs(30 * 60);

pub struct Connection {
    /// 表示名 ("AI: <クライアント名>")
    pub name: String,
    /// clientInfo.name の生値 (UIの接続情報表示で使う)
    #[allow(dead_code)]
    pub client_name: String,
    last_active: Instant,
}

pub struct ConnectionSlot {
    inner: Mutex<Option<Connection>>,
    idle_timeout: Duration,
}

impl ConnectionSlot {
    pub const fn new() -> Self {
        Self { inner: Mutex::new(None), idle_timeout: DEFAULT_IDLE_TIMEOUT }
    }

    #[cfg(test)]
    pub fn new_for_test() -> Self {
        Self { inner: Mutex::new(None), idle_timeout: Duration::from_millis(80) }
    }

    pub fn try_connect(&self, name: &str, client_name: &str) -> Result<(), String> {
        let mut guard = self.lock();
        self.reap_locked(&mut guard);
        if let Some(existing) = guard.as_ref() {
            return Err(format!(
                "別のAIクライアント ({}) が接続中のため、新しいAI接続は拒否されました",
                existing.name
            ));
        }
        *guard = Some(Connection {
            name: name.to_string(),
            client_name: client_name.to_string(),
            last_active: Instant::now(),
        });
        Ok(())
    }

    pub fn release(&self) {
        *self.lock() = None;
    }

    pub fn current_name(&self) -> Option<String> {
        self.lock().as_ref().map(|c| c.name.clone())
    }

    pub fn is_connected(&self) -> bool {
        let mut guard = self.lock();
        self.reap_locked(&mut guard);
        guard.is_some()
    }

    /// 操作時刻を更新する (プロトコル層がメッセージ処理時に呼ぶ)
    pub fn touch(&self) {
        if let Some(conn) = self.lock().as_mut() {
            conn.last_active = Instant::now();
        }
    }

    fn reap_locked(&self, guard: &mut MutexGuard<'_, Option<Connection>>) {
        let expired = guard
            .as_ref()
            .is_some_and(|c| c.last_active.elapsed() > self.idle_timeout);
        if expired {
            **guard = None;
        }
    }

    fn lock(&self) -> MutexGuard<'_, Option<Connection>> {
        // パニックで毒化しても接続状態の管理は止めない
        self.inner.lock().unwrap_or_else(|e| e.into_inner())
    }
}

static GLOBAL: OnceLock<Arc<ConnectionSlot>> = OnceLock::new();

/// アプリ全体で共有する単一スロット
pub fn global() -> Arc<ConnectionSlot> {
    Arc::clone(GLOBAL.get_or_init(|| Arc::new(ConnectionSlot::new())))
}

/// MCP initialize の clientInfo から表示名を作る (要件: カーソルタグはAI名)
pub fn ai_display_name(client_info: Option<&Value>) -> String {
    let raw = client_info
        .and_then(|ci| {
            ci.get("title")
                .and_then(|t| t.as_str())
                .filter(|s| !s.is_empty())
                .or_else(|| ci.get("name").and_then(|n| n.as_str()).filter(|s| !s.is_empty()))
        })
        .unwrap_or("AIクライアント");
    format!("AI: {}", raw)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn single_slot_rejects_second_ai() {
        let slot = ConnectionSlot::new();
        assert!(slot.try_connect("AI: A", "a").is_ok());
        assert!(slot.is_connected());
        let err = slot.try_connect("AI: B", "b").unwrap_err();
        assert!(err.contains("AI: A"), "拒否理由に既存のAI名を含める: {}", err);
        assert_eq!(slot.current_name().as_deref(), Some("AI: A"));
        slot.release();
        assert!(!slot.is_connected());
        assert!(slot.try_connect("AI: B", "b").is_ok());
    }

    #[test]
    fn idle_connection_is_reaped() {
        let slot = ConnectionSlot::new_for_test();
        assert!(slot.try_connect("AI: A", "a").is_ok());
        assert!(slot.is_connected());
        slot.touch();
        assert!(slot.is_connected());
        std::thread::sleep(Duration::from_millis(150));
        assert!(!slot.is_connected(), "放置された接続は自動解放される");
        assert!(slot.try_connect("AI: B", "b").is_ok());
    }

    #[test]
    fn display_name_prefers_title_then_name() {
        assert_eq!(
            ai_display_name(Some(&json!({"name": "claude-desktop", "title": "Claude"}))),
            "AI: Claude"
        );
        assert_eq!(ai_display_name(Some(&json!({"name": "opencode"}))), "AI: opencode");
        assert_eq!(ai_display_name(Some(&json!({"name": ""}))), "AI: AIクライアント");
        assert_eq!(ai_display_name(None), "AI: AIクライアント");
    }
}
