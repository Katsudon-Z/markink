// JSON-RPC 2.0 / MCP プロトコル処理。I/O を持たない純粋層 (mcp-plan.md §2.1)
// 対応メソッド: initialize / notifications/* / ping / tools/list / tools/call
// resources / prompts / sampling は初期版対象外 (requirements.md §10)

use serde_json::{json, Value};

use crate::mcp::catalog;
use crate::mcp::connection::{self, ConnectionSlot};
use crate::mcp::gateway::EditorGateway;

pub const SERVER_NAME: &str = "MDNotepad";
pub const SERVER_VERSION: &str = env!("CARGO_PKG_VERSION");
pub const DEFAULT_PROTOCOL_VERSION: &str = "2025-06-18";
pub const SUPPORTED_VERSIONS: &[&str] = &["2025-06-18", "2025-03-26", "2024-11-05"];

// JSON-RPC 標準エラー
const PARSE_ERROR: i64 = -32700;
const INVALID_REQUEST: i64 = -32600;
const METHOD_NOT_FOUND: i64 = -32601;
/// アプリ固有: AI接続スロットが使用中 / 未接続
pub(crate) const CONNECTION_REJECTED: i64 = -32002;

pub struct ProtoContext<'a> {
    pub connection: &'a ConnectionSlot,
    pub gateway: &'a dyn EditorGateway,
}

/// 1行 (1メッセージ) を処理し、返信すべき行を返す。通知の場合は空。
pub async fn handle_line(line: &str, ctx: &ProtoContext<'_>) -> Vec<String> {
    let trimmed = line.trim();
    if trimmed.is_empty() {
        return Vec::new();
    }
    let parsed: Value = match serde_json::from_str(trimmed) {
        Ok(v) => v,
        Err(_) => return vec![error_line(Value::Null, PARSE_ERROR, "JSONを解釈できません")],
    };
    if parsed.is_array() {
        return vec![error_line(Value::Null, INVALID_REQUEST, "バッチリクエストには対応していません")];
    }
    if !parsed.is_object() {
        return vec![error_line(Value::Null, INVALID_REQUEST, "リクエストはオブジェクトである必要があります")];
    }
    let id = parsed.get("id").cloned().unwrap_or(Value::Null);
    let is_notification = parsed.get("id").is_none();
    let Some(method) = parsed.get("method").and_then(|m| m.as_str()) else {
        return vec![error_line(id, INVALID_REQUEST, "methodがありません")];
    };
    let params = parsed.get("params").cloned().unwrap_or_else(|| json!({}));

    // 接続中のスロットは操作時刻を更新する (放置タイムアウト用)。
    // initialize の成否は try_connect 側で判定する。
    if method != "initialize" && ctx.connection.is_connected() {
        ctx.connection.touch();
    }

    match method {
        "initialize" => vec![handle_initialize(id, &params, ctx)],
        "ping" => vec![ok_line(id, json!({}))],
        "tools/list" => vec![ok_line(id, json!({ "tools": catalog::tools() }))],
        "tools/call" => vec![handle_tool_call(id, &params, ctx).await],
        m if m.starts_with("notifications/") => Vec::new(),
        _ => {
            if is_notification {
                Vec::new()
            } else {
                vec![error_line(id, METHOD_NOT_FOUND, format!("未対応のメソッド: {}", method))]
            }
        }
    }
}

fn handle_initialize(id: Value, params: &Value, ctx: &ProtoContext<'_>) -> String {
    let client_info = params.get("clientInfo");
    let name = connection::ai_display_name(client_info);
    let client_name = client_info
        .and_then(|c| c.get("name"))
        .and_then(|n| n.as_str())
        .unwrap_or("")
        .to_string();

    // 同時1本限定: 2本目はここで拒否される (requirements.md §10.1)
    if let Err(reason) = ctx.connection.try_connect(&name, &client_name) {
        return error_line(id, CONNECTION_REJECTED, reason);
    }

    let requested = params
        .get("protocolVersion")
        .and_then(|v| v.as_str())
        .unwrap_or(DEFAULT_PROTOCOL_VERSION);
    let chosen = if SUPPORTED_VERSIONS.contains(&requested) {
        requested
    } else {
        DEFAULT_PROTOCOL_VERSION
    };

    ok_line(
        id,
        json!({
            "protocolVersion": chosen,
            "capabilities": { "tools": { "listChanged": false } },
            "serverInfo": { "name": SERVER_NAME, "version": SERVER_VERSION, "title": "MDNotepad" }
        }),
    )
}

async fn handle_tool_call(id: Value, params: &Value, ctx: &ProtoContext<'_>) -> String {
    if !ctx.connection.is_connected() {
        return error_line(id, CONNECTION_REJECTED, "initializeが完了していません");
    }
    let Some(name) = params.get("name").and_then(|n| n.as_str()) else {
        return error_line(id, INVALID_REQUEST, "ツール名がありません");
    };
    // disconnect は Rust 側で完結する (フロントエンドへ転送しない)
    if name == "disconnect" {
        ctx.connection.release();
        return ok_line(
            id,
            json!({ "content": [{ "type": "text", "text": "AI接続を終了しました" }], "isError": false }),
        );
    }
    if catalog::find(name).is_none() {
        return error_line(id, METHOD_NOT_FOUND, format!("未知のツール: {}", name));
    }
    let args = params.get("arguments").cloned().unwrap_or_else(|| json!({}));
    // ツール実行エラーは JSON-RPC error ではなく isError:true の結果で返す (MCP仕様)
    match ctx.gateway.call(name, args).await {
        Ok(value) => ok_line(
            id,
            json!({ "content": [{ "type": "text", "text": value.to_string() }], "isError": false }),
        ),
        Err(err) => ok_line(
            id,
            json!({ "content": [{ "type": "text", "text": err }], "isError": true }),
        ),
    }
}

fn ok_line(id: Value, result: Value) -> String {
    json!({ "jsonrpc": "2.0", "id": id, "result": result }).to_string()
}

/// initialize 要求に対する「満員拒否」の理由を取り出す (UI通知用)。
/// initialize 以外・成功時は None。
pub(crate) fn initialize_rejection(request_text: &str, replies: &[String]) -> Option<String> {
    let is_init = serde_json::from_str::<Value>(request_text)
        .ok()
        .and_then(|v| v.get("method").and_then(|m| m.as_str()).map(|m| m == "initialize"))
        .unwrap_or(false);
    if !is_init {
        return None;
    }
    for reply in replies {
        let rejected = serde_json::from_str::<Value>(reply)
            .ok()
            .and_then(|v| {
                let code = v.get("error")?.get("code")?.as_i64()?;
                let message = v.get("error")?.get("message")?.as_str()?.to_string();
                (code == CONNECTION_REJECTED).then_some(message)
            });
        if rejected.is_some() {
            return rejected;
        }
    }
    None
}

fn error_line(id: Value, code: i64, message: impl AsRef<str>) -> String {
    json!({
        "jsonrpc": "2.0",
        "id": id,
        "error": { "code": code, "message": message.as_ref() }
    })
    .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::mcp::gateway::MockGateway;

    fn ctx<'a>(slot: &'a ConnectionSlot, gateway: &'a MockGateway) -> ProtoContext<'a> {
        ProtoContext { connection: slot, gateway }
    }

    fn parse(line: &str) -> Value {
        serde_json::from_str(line).unwrap()
    }

    #[tokio::test]
    async fn initialize_handshake_returns_server_info() {
        let slot = ConnectionSlot::new();
        let gateway = MockGateway { reply: json!({}) };
        let req = json!({
            "jsonrpc": "2.0", "id": 1, "method": "initialize",
            "params": {
                "protocolVersion": "2025-03-26",
                "clientInfo": { "name": "claude-desktop", "title": "Claude Desktop" }
            }
        });
        let replies = handle_line(&req.to_string(), &ctx(&slot, &gateway)).await;
        assert_eq!(replies.len(), 1);
        let v = parse(&replies[0]);
        assert_eq!(v["id"], 1);
        // クライアントの要求バージョンが対応済みならそのまま返す
        assert_eq!(v["result"]["protocolVersion"], "2025-03-26");
        assert_eq!(v["result"]["serverInfo"]["name"], SERVER_NAME);
        assert_eq!(v["result"]["capabilities"]["tools"]["listChanged"], false);
        // 接続スロットにAI名が入る
        assert_eq!(slot.current_name().as_deref(), Some("AI: Claude Desktop"));
    }

    #[tokio::test]
    async fn unsupported_protocol_version_falls_back() {
        let slot = ConnectionSlot::new();
        let gateway = MockGateway { reply: json!({}) };
        let req = json!({
            "jsonrpc": "2.0", "id": 1, "method": "initialize",
            "params": { "protocolVersion": "1999-01-01", "clientInfo": { "name": "x" } }
        });
        let replies = handle_line(&req.to_string(), &ctx(&slot, &gateway)).await;
        let v = parse(&replies[0]);
        assert_eq!(v["result"]["protocolVersion"], DEFAULT_PROTOCOL_VERSION);
    }

    #[tokio::test]
    async fn second_initialize_is_rejected() {
        let slot = ConnectionSlot::new();
        let gateway = MockGateway { reply: json!({}) };
        let first = json!({
            "jsonrpc": "2.0", "id": 1, "method": "initialize",
            "params": { "clientInfo": { "name": "ai-1" } }
        });
        let second = json!({
            "jsonrpc": "2.0", "id": 2, "method": "initialize",
            "params": { "clientInfo": { "name": "ai-2" } }
        });
        let _ = handle_line(&first.to_string(), &ctx(&slot, &gateway)).await;
        let replies = handle_line(&second.to_string(), &ctx(&slot, &gateway)).await;
        let v = parse(&replies[0]);
        assert_eq!(v["error"]["code"], CONNECTION_REJECTED);
        assert!(v["error"]["message"].as_str().unwrap().contains("ai-1"));
        // 1本目の接続は維持される
        assert_eq!(slot.current_name().as_deref(), Some("AI: ai-1"));
    }

    #[tokio::test]
    async fn tools_list_comes_from_shared_manifest() {
        let slot = ConnectionSlot::new();
        let gateway = MockGateway { reply: json!({}) };
        let req = json!({ "jsonrpc": "2.0", "id": 5, "method": "tools/list" });
        let replies = handle_line(&req.to_string(), &ctx(&slot, &gateway)).await;
        let v = parse(&replies[0]);
        let tools = v["result"]["tools"].as_array().unwrap();
        assert!(tools.iter().any(|t| t["name"] == "get_document"));
        assert_eq!(tools.len(), catalog::tools().as_array().unwrap().len());
    }

    #[tokio::test]
    async fn tool_call_requires_initialize_then_returns_content() {
        let slot = ConnectionSlot::new();
        let gateway = MockGateway { reply: json!({"markdown": "# hi"}) };
        let call = json!({
            "jsonrpc": "2.0", "id": 3, "method": "tools/call",
            "params": { "name": "get_document", "arguments": {} }
        });
        // 未接続 → 拒否
        let replies = handle_line(&call.to_string(), &ctx(&slot, &gateway)).await;
        assert_eq!(parse(&replies[0])["error"]["code"], CONNECTION_REJECTED);

        // initialize 後 → モックの結果が content に入る
        let init = json!({
            "jsonrpc": "2.0", "id": 1, "method": "initialize",
            "params": { "clientInfo": { "name": "ai" } }
        });
        let _ = handle_line(&init.to_string(), &ctx(&slot, &gateway)).await;
        let replies = handle_line(&call.to_string(), &ctx(&slot, &gateway)).await;
        let v = parse(&replies[0]);
        assert_eq!(v["result"]["isError"], false);
        let text = v["result"]["content"][0]["text"].as_str().unwrap();
        assert!(text.contains("# hi"));
    }

    #[tokio::test]
    async fn unknown_tool_and_method_and_garbage() {
        let slot = ConnectionSlot::new();
        let gateway = MockGateway { reply: json!({}) };
        let init = json!({
            "jsonrpc": "2.0", "id": 1, "method": "initialize",
            "params": { "clientInfo": { "name": "ai" } }
        });
        let _ = handle_line(&init.to_string(), &ctx(&slot, &gateway)).await;

        let unknown_tool = json!({
            "jsonrpc": "2.0", "id": 2, "method": "tools/call",
            "params": { "name": "no_such_tool", "arguments": {} }
        });
        let replies = handle_line(&unknown_tool.to_string(), &ctx(&slot, &gateway)).await;
        assert_eq!(parse(&replies[0])["error"]["code"], METHOD_NOT_FOUND);

        let unknown_method = json!({ "jsonrpc": "2.0", "id": 3, "method": "resources/list" });
        let replies = handle_line(&unknown_method.to_string(), &ctx(&slot, &gateway)).await;
        assert_eq!(parse(&replies[0])["error"]["code"], METHOD_NOT_FOUND);

        let replies = handle_line("{broken json", &ctx(&slot, &gateway)).await;
        assert_eq!(parse(&replies[0])["error"]["code"], PARSE_ERROR);

        let replies = handle_line("[]", &ctx(&slot, &gateway)).await;
        assert_eq!(parse(&replies[0])["error"]["code"], INVALID_REQUEST);
    }

    #[tokio::test]
    async fn disconnect_tool_releases_slot() {        let slot = ConnectionSlot::new();
        let gateway = MockGateway { reply: json!({}) };
        let init = json!({
            "jsonrpc": "2.0", "id": 1, "method": "initialize",
            "params": { "clientInfo": { "name": "ai" } }
        });
        let _ = handle_line(&init.to_string(), &ctx(&slot, &gateway)).await;
        assert!(slot.is_connected());

        let disc = json!({
            "jsonrpc": "2.0", "id": 2, "method": "tools/call",
            "params": { "name": "disconnect", "arguments": {} }
        });
        let replies = handle_line(&disc.to_string(), &ctx(&slot, &gateway)).await;
        let v = parse(&replies[0]);
        assert_eq!(v["result"]["isError"], false);
        assert!(!slot.is_connected(), "disconnect でスロットが解放される");

        // 再接続できる
        let replies = handle_line(&init.to_string(), &ctx(&slot, &gateway)).await;
        assert!(parse(&replies[0]).get("result").is_some());
    }

    #[tokio::test]
    async fn initialize_rejection_reports_reason() {
        let slot = ConnectionSlot::new();
        let gateway = MockGateway { reply: json!({}) };
        let first = json!({
            "jsonrpc": "2.0", "id": 1, "method": "initialize",
            "params": { "clientInfo": { "name": "ai-1" } }
        })
        .to_string();
        let second = json!({
            "jsonrpc": "2.0", "id": 2, "method": "initialize",
            "params": { "clientInfo": { "name": "ai-2" } }
        })
        .to_string();
        let replies = handle_line(&first, &ctx(&slot, &gateway)).await;
        assert!(initialize_rejection(&first, &replies).is_none());
        let replies = handle_line(&second, &ctx(&slot, &gateway)).await;
        let reason = initialize_rejection(&second, &replies).expect("拒否理由が取れる");
        assert!(reason.contains("ai-1"));
        // initialize 以外では検出しない
        let ping = json!({ "jsonrpc": "2.0", "id": 3, "method": "ping" }).to_string();
        let replies = handle_line(&ping, &ctx(&slot, &gateway)).await;
        assert!(initialize_rejection(&ping, &replies).is_none());
    }

    #[tokio::test]
    async fn notifications_produce_no_reply() {        let slot = ConnectionSlot::new();
        let gateway = MockGateway { reply: json!({}) };
        for msg in [
            json!({ "jsonrpc": "2.0", "method": "notifications/initialized" }).to_string(),
            json!({ "jsonrpc": "2.0", "method": "notifications/cancelled", "params": {} }).to_string(),
            String::new(),
        ] {
            let replies = handle_line(&msg, &ctx(&slot, &gateway)).await;
            assert!(replies.is_empty(), "通知に返信しない: {}", msg);
        }
    }
}
