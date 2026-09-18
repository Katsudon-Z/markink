// アプリ設定の永続化 (ローカル領域のみ。SMB には置かない - mcp-plan.md §2.1)
// stdio サブプロセスには AppHandle が無いため、パスは環境変数から直接解決する。

use std::fs;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};

/// tauri.conf.json の identifier と一致させる (テストで検証)
pub const APP_IDENTIFIER: &str = "com.mdnotepad.app";

#[derive(Serialize, Deserialize, Clone, PartialEq, Debug)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    /// AI共同編集 (MCPサーバ) の有効/無効。既定は無効 (requirements.md §10.2)
    pub mcp_enabled: bool,
    /// MCP 接続用トークン (localhost 限定の追加防御)
    pub mcp_token: Option<String>,
    /// AI編集時に自動保存を発火させるか (requirements.md §10.5)
    pub ai_auto_save: bool,
    /// 前回保存していない内容の復元機能を使うか。既定は無効 (OFF)。
    /// 無効時は自動保存の書き込みも復元提案も行わない。
    pub restore_enabled: bool,
}

impl Default for Settings {
    fn default() -> Self {
        Self { mcp_enabled: false, mcp_token: None, ai_auto_save: true, restore_enabled: false }
    }
}

/// Tauri の app_local_data_dir と同じ場所 (AppHandle 無しで解決可能)
pub fn local_dir() -> PathBuf {
    std::env::var_os("LOCALAPPDATA")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."))
        .join(APP_IDENTIFIER)
}

pub fn settings_path() -> PathBuf {
    local_dir().join("settings.json")
}

/// stdio サブプロセスが接続先を知るためのエンドポイント情報
pub fn endpoint_path() -> PathBuf {
    local_dir().join("mcp.json")
}

pub fn load() -> Settings {
    fs::read_to_string(settings_path())
        .ok()
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default()
}

pub fn save(settings: &Settings) -> Result<(), String> {
    let dir = local_dir();
    fs::create_dir_all(&dir).map_err(|e| format!("設定フォルダを作成できません: {}", e))?;
    let json = serde_json::to_string_pretty(settings).map_err(|e| e.to_string())?;
    fs::write(settings_path(), json).map_err(|e| format!("設定を保存できません: {}", e))
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct EndpointInfo {
    pub port: u16,
    pub token: String,
    pub pid: u32,
}

pub fn read_endpoint() -> Option<EndpointInfo> {
    fs::read_to_string(endpoint_path())
        .ok()
        .and_then(|text| serde_json::from_str(&text).ok())
}

pub fn write_endpoint(info: &EndpointInfo) -> Result<(), String> {
    let dir = local_dir();
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let json = serde_json::to_string(info).map_err(|e| e.to_string())?;
    fs::write(endpoint_path(), json).map_err(|e| e.to_string())
}

pub fn remove_endpoint() {
    let _ = fs::remove_file(endpoint_path());
}

/// ランダムな 16 進トークン (ローカル接続限定の簡易防御。暗号学的強度は不要)
pub fn generate_token() -> String {
    use std::collections::hash_map::RandomState;
    use std::hash::{BuildHasher, Hasher};
    let mut hasher = RandomState::new().build_hasher();
    hasher.write_u128(
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0),
    );
    hasher.write_u32(std::process::id());
    let a = hasher.finish();
    let mut hasher2 = RandomState::new().build_hasher();
    hasher2.write_u64(a);
    format!("{:016x}{:016x}", a, hasher2.finish())
}

#[tauri::command]
pub fn mcp_get_settings() -> Settings {
    load()
}

#[tauri::command]
pub fn set_restore_enabled(enabled: bool) -> Result<(), String> {
    let mut s: Settings = load();
    s.restore_enabled = enabled;
    save(&s)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn identifier_matches_tauri_conf() {
        let conf: serde_json::Value =
            serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        assert_eq!(conf["identifier"].as_str().unwrap(), APP_IDENTIFIER);
    }

    #[test]
    fn settings_roundtrip_json() {
        let json = serde_json::to_string(&Settings::default()).unwrap();
        let parsed: Settings = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed, Settings::default());
        // 旧ファイルにトークンが無くてもデフォルトで補完される
        let partial: Settings = serde_json::from_str(r#"{"mcpEnabled":true}"#).unwrap();
        assert!(partial.mcp_enabled);
        assert!(partial.ai_auto_save);
        assert_eq!(partial.mcp_token, None);
    }

    #[test]
    fn restore_defaults_off_for_old_files() {
        // 復元機能は既定で無効。旧設定ファイルに項目が無くても false になる
        assert!(!Settings::default().restore_enabled);
        let parsed: Settings = serde_json::from_str(r#"{"mcpEnabled":true}"#).unwrap();
        assert!(parsed.mcp_enabled);
        assert!(!parsed.restore_enabled);
        let enabled: Settings =
            serde_json::from_str(r#"{"restoreEnabled":true}"#).unwrap();
        assert!(enabled.restore_enabled);
    }

    #[test]
    fn token_is_random_hex() {        let t1 = generate_token();
        let t2 = generate_token();
        assert_eq!(t1.len(), 32);
        assert!(t1.chars().all(|c| c.is_ascii_hexdigit()));
        assert_ne!(t1, t2);
    }
}
