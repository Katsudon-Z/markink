// 文書変更の版通知 (バージョン通知 P2)
//
// フロントエンドが dispatch 監視で検知した変更を `mcp_doc_changed` で受け取り、
// 接続中のAIへ JSON-RPC 通知として転送する。本文は送らず「版が進んだ」の
// 合図のみ。本文が必要なAIは get_changes で取りに行く (5MB文書対策)。
//
// 転送路:
// - WS (stdioブリッジ用): 本モジュールの broadcast を handle_conn が購読し push。
//   stdio中継は WS→stdout を素通しするため、そのままAIクライアントに届く。
// - HTTP: push不可のため対象外。AIは get_version ポーリングで検知する。

use std::sync::OnceLock;

use serde::Serialize;
use tokio::sync::broadcast;

#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct DocChangedEvent {
    pub version: u64,
    pub origin: String,
    pub cursor_from: Option<i64>,
    pub cursor_to: Option<i64>,
}

/// サーバ→AI の通知メソッド名
pub const DOC_CHANGED_METHOD: &str = "notifications/document/changed";

static BUS: OnceLock<broadcast::Sender<DocChangedEvent>> = OnceLock::new();

fn bus() -> &'static broadcast::Sender<DocChangedEvent> {
    BUS.get_or_init(|| broadcast::channel(16).0)
}

pub fn subscribe() -> broadcast::Receiver<DocChangedEvent> {
    bus().subscribe()
}

pub fn publish(event: DocChangedEvent) {
    // 受信者がいなければ捨てる (AI未接続時の通常動作)
    let _ = bus().send(event);
}

/// WS/stdio で AI へ送る JSON-RPC 通知行 (id無し)
pub fn doc_changed_notification(event: &DocChangedEvent) -> String {
    serde_json::json!({
        "jsonrpc": "2.0",
        "method": DOC_CHANGED_METHOD,
        "params": {
            "version": event.version,
            "origin": event.origin,
            "cursor": {
                "from": event.cursor_from,
                "to": event.cursor_to
            }
        }
    })
    .to_string()
}

/// フロントエンドからの版通知受信 (Tauri command。AppHandle 不要)
#[tauri::command]
pub fn mcp_doc_changed(
    version: u64,
    origin: String,
    cursor_from: Option<i64>,
    cursor_to: Option<i64>,
) {
    publish(DocChangedEvent { version, origin, cursor_from, cursor_to });
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Value;

    #[test]
    fn notification_line_has_no_id_and_carries_version() {
        let line = doc_changed_notification(&DocChangedEvent {
            version: 42,
            origin: "human".to_string(),
            cursor_from: Some(10),
            cursor_to: Some(15),
        });
        let v: Value = serde_json::from_str(&line).unwrap();
        assert_eq!(v["jsonrpc"], "2.0");
        assert!(v.get("id").is_none(), "通知にidを付けない");
        assert_eq!(v["method"], DOC_CHANGED_METHOD);
        assert_eq!(v["params"]["version"], 42);
        assert_eq!(v["params"]["origin"], "human");
        assert_eq!(v["params"]["cursor"]["from"], 10);
        assert_eq!(v["params"]["cursor"]["to"], 15);
    }

    #[test]
    fn publish_reaches_subscriber() {
        let mut rx = subscribe();
        publish(DocChangedEvent {
            version: 7,
            origin: "ai".to_string(),
            cursor_from: None,
            cursor_to: None,
        });
        // 他テストとバスを共有するため、目的の版まで読み飛ばす
        let got = std::iter::from_fn(|| rx.try_recv().ok())
            .find(|e| e.version == 7)
            .expect("購読者に届く");
        assert_eq!(got.origin, "ai");
    }

    #[test]
    fn command_publishes_without_apphandle() {
        let mut rx = subscribe();
        mcp_doc_changed(99, "human".to_string(), Some(1), Some(2));
        let got = std::iter::from_fn(|| rx.try_recv().ok())
            .find(|e| e.version == 99)
            .expect("コマンド経由で届く");
        assert_eq!(got.origin, "human");
    }
}
