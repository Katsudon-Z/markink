// ツール定義の単一ソース: shared/mcp-tools.json (mcp-plan.md §2.1)
// Rust は tools/list 応答に使い、フロントエンド (TS) は同じ JSON を import して
// 実装レジストリと突き合わせる。二重定義にしない。

use std::sync::OnceLock;

use serde_json::Value;

pub const TOOLS_JSON: &str = include_str!("../../../shared/mcp-tools.json");

static TOOLS: OnceLock<Value> = OnceLock::new();

pub fn tools() -> &'static Value {
    TOOLS.get_or_init(|| {
        serde_json::from_str(TOOLS_JSON).expect("shared/mcp-tools.json が壊れています")
    })
}

pub fn find(name: &str) -> Option<&'static Value> {
    tools().as_array()?.iter().find(|t| t.get("name").and_then(|n| n.as_str()) == Some(name))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn manifest_is_wellformed() {
        let tools = tools().as_array().expect("配列であること");
        assert!(!tools.is_empty());
        let mut names: Vec<&str> = Vec::new();
        for tool in tools {
            let name = tool.get("name").and_then(|n| n.as_str()).expect("name 必須");
            assert!(
                tool.get("description").and_then(|d| d.as_str()).is_some_and(|d| !d.is_empty()),
                "{}: description 必須",
                name
            );
            let schema = tool.get("inputSchema").expect("inputSchema 必須");
            assert_eq!(schema.get("type").and_then(|t| t.as_str()), Some("object"));
            assert!(schema.get("properties").is_some());
            assert!(schema.get("required").is_some());
            names.push(name);
        }
        // 名前は一意
        let mut sorted = names.clone();
        sorted.sort_unstable();
        sorted.dedup();
        assert_eq!(sorted.len(), names.len(), "ツール名が重複しています");
    }

    #[test]
    fn manifest_covers_planned_tools() {
        // mcp-plan.md §3 のツール一覧と一致させる
        let expected = [
            "get_document",
            "search",
            "get_outline",
            "insert_text",
            "replace_range",
            "replace_all",
            "apply_markdown",
            "set_heading",
            "set_cursor",
            "get_cursor",
            "save_document",
            "notify_human",
            "disconnect",
        ];
        for name in expected {
            assert!(find(name).is_some(), "{} がマニフェストにありません", name);
        }
        assert_eq!(tools().as_array().unwrap().len(), expected.len());
    }
}
