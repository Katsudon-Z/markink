use std::fs;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use tauri::Manager;

/// 復元候補 (本文 + 共同編集のルーム名 + 文書パス) requirements.md:48,101
#[derive(Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct AutosaveData {
    pub content: String,
    #[serde(default)]
    pub room: Option<String>,
    #[serde(default)]
    pub path: Option<String>,
}

#[derive(Serialize, Deserialize, Default)]
struct AutosaveMeta {
    #[serde(default)]
    room: Option<String>,
    #[serde(default)]
    path: Option<String>,
}

/// 自動保存ファイルの場所 (ローカル一時領域)
fn autosave_dir(app: &tauri::AppHandle) -> PathBuf {
    let dir = app.path().app_local_data_dir().unwrap();
    let _ = fs::create_dir_all(&dir);
    dir
}

fn content_path(app: &tauri::AppHandle) -> PathBuf {
    autosave_dir(app).join("autosave.md")
}

/// ルーム名などの付帯情報 (本文とは分けて保存し、旧形式とも互換を保つ)
fn meta_path(app: &tauri::AppHandle) -> PathBuf {
    autosave_dir(app).join("autosave.meta.json")
}

#[tauri::command]
pub fn autosave(
    content: String,
    room: Option<String>,
    path: Option<String>,
    app: tauri::AppHandle,
) -> Result<(), String> {
    fs::write(content_path(&app), content).map_err(|_| "自動保存に失敗しました".to_string())?;
    let file = meta_path(&app);
    let room = room.filter(|r| !r.is_empty());
    let path = path.filter(|p| !p.is_empty());
    if room.is_none() && path.is_none() {
        let _ = fs::remove_file(file);
        return Ok(());
    }
    let json = serde_json::to_string(&AutosaveMeta { room, path })
        .map_err(|_| "自動保存に失敗しました".to_string())?;
    fs::write(file, json).map_err(|_| "自動保存に失敗しました".to_string())
}

#[tauri::command]
pub fn read_autosave(app: tauri::AppHandle) -> Result<Option<AutosaveData>, String> {
    let file = content_path(&app);
    if !file.exists() {
        return Ok(None);
    }
    let content =
        fs::read_to_string(file).map_err(|_| "復元データを読み込めませんでした".to_string())?;
    let meta = fs::read_to_string(meta_path(&app))
        .ok()
        .and_then(|json| serde_json::from_str::<AutosaveMeta>(&json).ok())
        .unwrap_or_default();
    Ok(Some(AutosaveData {
        content,
        room: meta.room.filter(|r| !r.is_empty()),
        path: meta.path.filter(|p| !p.is_empty()),
    }))
}

#[tauri::command]
pub fn delete_autosave(app: tauri::AppHandle) {
    fs::remove_file(content_path(&app)).ok();
    fs::remove_file(meta_path(&app)).ok();
}
