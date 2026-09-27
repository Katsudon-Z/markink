//! Application settings without plugin-specific data.
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

use serde::{Deserialize, Serialize};

pub const APP_IDENTIFIER: &str = "jp.markink.app";
static NEXT_WRITE: AtomicU64 = AtomicU64::new(0);

#[derive(Serialize, Deserialize, Clone, PartialEq, Debug)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    pub restore_enabled: bool,
    pub user_name: String,
    pub line_numbers: bool,
    pub font_size: f64,
    pub font_family: String,
    pub image_path_mode: String,
    pub file_logging_enabled: bool,
    pub file_logging_level: String,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            restore_enabled: false,
            user_name: String::new(),
            line_numbers: true,
            font_size: 14.0,
            font_family: String::new(),
            image_path_mode: "relative".to_string(),
            file_logging_enabled: false,
            file_logging_level: "warn".to_string(),
        }
    }
}

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

pub fn load() -> Settings {
    fs::read_to_string(settings_path())
        .ok()
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default()
}

/// Write beside the destination, then replace it on the same volume.
pub fn atomic_write(path: &Path, contents: &[u8]) -> Result<(), String> {
    let parent = path.parent().ok_or("設定の保存先が不正です")?;
    fs::create_dir_all(parent).map_err(|e| format!("設定フォルダを作成できません: {e}"))?;
    let temp = parent.join(format!(
        ".settings-{}-{}.tmp",
        std::process::id(),
        NEXT_WRITE.fetch_add(1, Ordering::Relaxed)
    ));
    let result = (|| {
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temp)
            .map_err(|e| format!("一時設定ファイルを作成できません: {e}"))?;
        file.write_all(contents)
            .and_then(|_| file.sync_all())
            .map_err(|e| format!("設定を書き込めません: {e}"))?;
        drop(file);
        replace_file(&temp, path)
    })();
    if result.is_err() {
        let _ = fs::remove_file(temp);
    }
    result
}

#[cfg(windows)]
fn replace_file(from: &Path, to: &Path) -> Result<(), String> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::{
        MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
    };
    let from_wide: Vec<u16> = from.as_os_str().encode_wide().chain(Some(0)).collect();
    let to_wide: Vec<u16> = to.as_os_str().encode_wide().chain(Some(0)).collect();
    // SAFETY: both paths are NUL-terminated UTF-16 buffers alive for this call.
    if unsafe {
        MoveFileExW(
            from_wide.as_ptr(),
            to_wide.as_ptr(),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    } == 0
    {
        return Err(format!(
            "設定ファイルを置き換えられません: {}",
            std::io::Error::last_os_error()
        ));
    }
    Ok(())
}

#[cfg(not(windows))]
fn replace_file(from: &Path, to: &Path) -> Result<(), String> {
    fs::rename(from, to).map_err(|e| format!("設定ファイルを置き換えられません: {e}"))
}

pub fn save(settings: &Settings) -> Result<(), String> {
    crate::legacy_migration::run()?;
    let json = serde_json::to_vec_pretty(settings).map_err(|e| e.to_string())?;
    atomic_write(&settings_path(), &json)
}

#[tauri::command]
pub fn get_settings() -> Settings {
    load()
}

#[tauri::command]
pub fn set_restore_enabled(enabled: bool) -> Result<(), String> {
    let mut settings = load();
    settings.restore_enabled = enabled;
    save(&settings)
}

#[tauri::command]
pub fn set_user_name(name: String) -> Result<(), String> {
    let mut settings = load();
    settings.user_name = name.trim().to_string();
    save(&settings)
}

#[tauri::command]
pub fn os_username() -> Option<String> {
    std::env::var("USERNAME")
        .or_else(|_| std::env::var("USER"))
        .or_else(|_| std::env::var("LOGNAME"))
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

#[tauri::command]
pub fn set_line_numbers(enabled: bool) -> Result<(), String> {
    let mut settings = load();
    settings.line_numbers = enabled;
    save(&settings)
}

#[tauri::command]
pub fn set_image_path_mode(mode: String) -> Result<(), String> {
    if mode != "relative" && mode != "absolute" {
        return Err("画像パスは relative か absolute で指定してください".into());
    }
    let mut settings = load();
    settings.image_path_mode = mode;
    save(&settings)
}

#[tauri::command]
pub fn set_file_logging(enabled: bool, level: String) -> Result<(), String> {
    if !matches!(level.as_str(), "error" | "warn" | "info" | "debug") {
        return Err("ログレベルが不正です".into());
    }
    let previous = load();
    let mut next = previous.clone();
    next.file_logging_enabled = enabled;
    next.file_logging_level = level.clone();
    save(&next)?;
    if let Err(error) = crate::logging::configure(enabled, &level) {
        let _ = save(&previous);
        return Err(error);
    }
    Ok(())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EditorFont {
    pub size_px: Option<f64>,
    pub family: Option<String>,
}

#[tauri::command]
pub fn set_editor_font(font: EditorFont) -> Result<(), String> {
    let mut settings = load();
    if let Some(px) = font.size_px {
        if !px.is_finite() {
            return Err("文字サイズが不正です".into());
        }
        settings.font_size = px.clamp(10.0, 32.0);
    }
    if let Some(family) = font.family {
        settings.font_family = family.trim().to_string();
    }
    save(&settings)
}
