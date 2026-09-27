//! Persistent opt-in state for installed plugins.
use std::collections::BTreeSet;
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;

static STATE_LOCK: Mutex<()> = Mutex::new(());
const MAX_STATE_BYTES: u64 = 32 * 1024;

fn state_path() -> PathBuf {
    crate::settings::local_dir()
        .join("plugins")
        .join("enabled.json")
}

fn valid_id(id: &str) -> bool {
    (3..=64).contains(&id.len())
        && id
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b"._-".contains(&b))
        && id
            .as_bytes()
            .first()
            .is_some_and(|b| b.is_ascii_lowercase() || b.is_ascii_digit())
}

fn read() -> Result<BTreeSet<String>, String> {
    let path = state_path();
    let metadata = match fs::symlink_metadata(&path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(BTreeSet::new()),
        Err(error) => return Err(format!("有効状態を確認できません: {error}")),
    };
    if !metadata.is_file() || metadata.file_type().is_symlink() || metadata.len() > MAX_STATE_BYTES
    {
        return Err("プラグインの有効状態ファイルが不正です".into());
    }
    let bytes = fs::read(&path).map_err(|e| format!("有効状態を読み取れません: {e}"))?;
    let ids: Vec<String> = serde_json::from_slice(&bytes)
        .map_err(|_| "プラグインの有効状態JSONが不正です".to_string())?;
    if ids.len() > 256 || ids.iter().any(|id| !valid_id(id)) {
        return Err("プラグインの有効状態に不正なIDがあります".into());
    }
    Ok(ids.into_iter().collect())
}

#[tauri::command]
pub fn plugin_enabled_ids() -> Result<Vec<String>, String> {
    let _guard = STATE_LOCK.lock().map_err(|_| "有効状態を読み取れません")?;
    Ok(read()?.into_iter().collect())
}

#[tauri::command]
pub fn plugin_set_enabled(id: String, enabled: bool) -> Result<(), String> {
    if !valid_id(&id) {
        return Err("プラグインIDの形式が不正です".into());
    }
    let _guard = STATE_LOCK.lock().map_err(|_| "有効状態を保存できません")?;
    let mut ids = read()?;
    if enabled {
        crate::plugins::plugin_read_entry(id.clone())?;
        if ids.len() >= 256 && !ids.contains(&id) {
            return Err("有効なプラグイン数が上限を超えています".into());
        }
        ids.insert(id);
    } else {
        ids.remove(&id);
    }
    let bytes = serde_json::to_vec(&ids).map_err(|e| e.to_string())?;
    crate::settings::atomic_write(&state_path(), &bytes)
}
