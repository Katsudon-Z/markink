//! One-time migration from the former built-in AI/MCP settings.
use std::fs;
use std::sync::Mutex;

const PLUGIN_ID: &str = "markink.ai-http";
static MIGRATION_LOCK: Mutex<()> = Mutex::new(());
const LEGACY_KEYS: &[&str] = &[
    "mcpEnabled",
    "mcpToken",
    "aiAutoSave",
    "aiCallEnabled",
    "aiProvider",
    "aiModel",
    "aiBackendUrl",
    "aiApiUrl",
    "aiApiKey",
    "aiApiModel",
    "aiTimeoutSecs",
    "aiMaxChars",
    "opencodeBin",
];

pub fn run() -> Result<(), String> {
    let _guard = MIGRATION_LOCK
        .lock()
        .map_err(|_| "設定移行を開始できません".to_string())?;
    let path = crate::settings::settings_path();
    let bytes = match fs::read(&path) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(format!("旧設定を読み取れません: {error}")),
    };
    let mut value: serde_json::Value =
        serde_json::from_slice(&bytes).map_err(|_| "旧設定JSONを解釈できません".to_string())?;
    let object = value.as_object_mut().ok_or("旧設定の形式が不正です")?;
    if !LEGACY_KEYS.iter().any(|key| object.contains_key(*key)) {
        return Ok(());
    }

    let settings_dir = crate::settings::local_dir()
        .join("plugins")
        .join("settings")
        .join(PLUGIN_ID);
    let plugins_root = crate::settings::local_dir().join("plugins");
    let settings_root = plugins_root.join("settings");
    for directory in [&plugins_root, &settings_root, &settings_dir] {
        match fs::symlink_metadata(directory) {
            Ok(metadata) if metadata.is_dir() && !metadata.file_type().is_symlink() => {}
            Ok(_) => return Err("プラグイン設定の保存先が不正です".into()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(format!("プラグイン設定の保存先を確認できません: {error}")),
        }
    }
    fs::create_dir_all(&settings_dir)
        .map_err(|e| format!("プラグイン設定領域を作成できません: {e}"))?;
    for (legacy, current) in [("aiApiUrl", "apiUrl"), ("aiApiModel", "model")] {
        if let Some(text) = object.get(legacy).and_then(|item| item.as_str()) {
            let target = settings_dir.join(format!("{current}.txt"));
            if !text.is_empty() && !target.exists() {
                crate::settings::atomic_write(&target, text.as_bytes())?;
            }
        }
    }
    if let Some(key) = object.get("aiApiKey").and_then(|item| item.as_str()) {
        if key.len() > 2048 || key.contains(['\r', '\n']) {
            return Err("旧APIキーの形式が不正なため移行できません".into());
        }
        if !key.is_empty() && crate::plugin_secrets::read(PLUGIN_ID, "api-key")?.is_none() {
            crate::plugin_secrets::write(PLUGIN_ID, "api-key", key)?;
        }
    }
    for key in LEGACY_KEYS {
        object.remove(*key);
    }
    let cleaned =
        serde_json::to_vec_pretty(&value).map_err(|_| "旧設定を変換できません".to_string())?;
    crate::settings::atomic_write(&path, &cleaned)
}
