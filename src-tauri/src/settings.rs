// アプリ設定の永続化 (ローカル領域のみ。SMB には置かない - mcp-plan.md §2.1)
// stdio サブプロセスには AppHandle が無いため、パスは環境変数から直接解決する。

use std::fs;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};

/// tauri.conf.json の identifier と一致させる (テストで検証)
pub const APP_IDENTIFIER: &str = "jp.markink.app";

/// エディタ起点のAI呼び出し (opencode serve) の既定値
pub const DEFAULT_AI_BACKEND_URL: &str = "http://127.0.0.1:4096";
pub const DEFAULT_AI_TIMEOUT_SECS: u64 = 120;
pub const DEFAULT_AI_MAX_CHARS: usize = 8000;
pub const DEFAULT_OPENCODE_BIN: &str = "opencode";
/// AI呼び出しの提供方式: "local" = opencode serve / "api" = OpenAI互換API直呼出
pub const DEFAULT_AI_PROVIDER: &str = "local";

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
    /// エディタ起点のAI呼び出し (opencode serve) を使うか。既定は無効。
    pub ai_call_enabled: bool,
    /// 共同編集で表示する自分の名前 (空なら自動生成)
    pub user_name: String,
    /// AI呼び出しの提供方式: "local" (opencode serve) | "api" (OpenAI互換API)
    pub ai_provider: String,
    /// serve に渡すモデル (local 時。空なら serve 側の既定。例: "opencode-go/kimi-k3")
    pub ai_model: String,
    /// serve のURL (local 時のみ使用。localhost のみ許可)
    pub ai_backend_url: String,
    /// OpenAI互換APIのエンドポイント (api 時。例: https://api.openai.com/v1/chat/completions)
    pub ai_api_url: String,
    /// APIキー (api 時。空なら Authorization ヘッダを付けない)
    pub ai_api_key: String,
    /// APIで使うモデル名 (api 時)
    pub ai_api_model: String,
    /// 応答待ちタイムアウト秒
    pub ai_timeout_secs: u64,
    /// 送信する文書の上限文字数
    pub ai_max_chars: usize,
    /// opencode 実行ファイル名またはパス (local 時)
    pub opencode_bin: String,
    /// 行番号ガターを表示するか。既定は表示。
    pub line_numbers: bool,
    /// エディタの文字サイズ (px)。既定は 14。
    pub font_size: f64,
    /// エディタのフォントファミリ (CSS値。空なら既定)。
    pub font_family: String,
    /// 画像パスの記録方式: "relative" (assetsへコピー。既定) | "absolute" (元の場所を参照)
    pub image_path_mode: String,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            mcp_enabled: false,
            mcp_token: None,
            ai_auto_save: true,
            restore_enabled: false,
            ai_call_enabled: false,
            user_name: String::new(),
            ai_provider: DEFAULT_AI_PROVIDER.to_string(),
            ai_model: String::new(),
            ai_backend_url: DEFAULT_AI_BACKEND_URL.to_string(),
            ai_api_url: String::new(),
            ai_api_key: String::new(),
            ai_api_model: String::new(),
            ai_timeout_secs: DEFAULT_AI_TIMEOUT_SECS,
            ai_max_chars: DEFAULT_AI_MAX_CHARS,
            opencode_bin: DEFAULT_OPENCODE_BIN.to_string(),
            line_numbers: true,
            font_size: 14.0,
            font_family: String::new(),
            image_path_mode: "relative".to_string(),
        }
    }
}

/// Tauri の app_local_data_dir と同じ場所 (AppHandle 無しで解決可能)
/// LOCALAPPDATA が無い制約環境でも、カレント(SMB共有の可能性あり)には書かない。
/// 必ずローカル一時領域へ落とす。
pub fn local_dir() -> PathBuf {
    if let Some(base) = std::env::var_os("LOCALAPPDATA").map(PathBuf::from) {
        if !base.as_os_str().is_empty() {
            return base.join(APP_IDENTIFIER);
        }
    }
    std::env::temp_dir().join(APP_IDENTIFIER)
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

#[tauri::command]
pub fn set_user_name(name: String) -> Result<(), String> {
    let mut s: Settings = load();
    s.user_name = name.trim().to_string();
    save(&s)
}

/// OSのログインユーザ名 (共同編集の表示名の既定値用。未設定時は None)
#[tauri::command]
pub fn os_username() -> Option<String> {
    std::env::var("USERNAME")
        .or_else(|_| std::env::var("USER"))
        .or_else(|_| std::env::var("LOGNAME"))
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

#[tauri::command]
pub fn set_line_numbers(enabled: bool) -> Result<(), String> {
    let mut s: Settings = load();
    s.line_numbers = enabled;
    save(&s)
}

#[tauri::command]
pub fn set_image_path_mode(mode: String) -> Result<(), String> {
    if mode != "relative" && mode != "absolute" {
        return Err("画像パスは relative か absolute で指定してください".to_string());
    }
    let mut s: Settings = load();
    s.image_path_mode = mode;
    save(&s)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EditorFont {
    pub size_px: Option<f64>,
    pub family: Option<String>,
}

/// エディタの文字サイズ・種類を変更する (表示設定。文書内容には影響しない)
#[tauri::command]
pub fn set_editor_font(font: EditorFont) -> Result<(), String> {
    let mut s: Settings = load();
    if let Some(px) = font.size_px {
        if !px.is_finite() {
            return Err("文字サイズが不正です".to_string());
        }
        s.font_size = px.clamp(10.0, 32.0);
    }
    if let Some(family) = font.family {
        s.font_family = family.trim().to_string();
    }
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

    #[test]
    fn ai_call_defaults_off_for_old_files() {
        // エディタ起点のAI呼び出しは既定で無効。旧設定ファイルでも補完される
        assert!(!Settings::default().ai_call_enabled);
        let parsed: Settings = serde_json::from_str(r#"{"mcpEnabled":true}"#).unwrap();
        assert!(!parsed.ai_call_enabled);
        assert_eq!(parsed.ai_backend_url, DEFAULT_AI_BACKEND_URL);
        assert_eq!(parsed.ai_timeout_secs, DEFAULT_AI_TIMEOUT_SECS);
        assert_eq!(parsed.ai_max_chars, DEFAULT_AI_MAX_CHARS);
        assert!(parsed.ai_model.is_empty());
        // 新項目も旧ファイルでは既定値で補完される
        assert_eq!(parsed.ai_provider, DEFAULT_AI_PROVIDER);
        assert!(parsed.ai_api_url.is_empty());
        assert!(parsed.ai_api_key.is_empty());
        assert!(parsed.ai_api_model.is_empty());
        assert!(parsed.user_name.is_empty());
        assert_eq!(parsed.image_path_mode, "relative");
    }
}
