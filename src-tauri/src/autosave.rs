use std::fs;
use std::path::PathBuf;

use tauri::Manager;

/// 自動保存ファイルの場所 (ローカル一時領域) requirements.md:48,101
fn autosave_path(app: &tauri::AppHandle) -> PathBuf {
    let dir = app.path().app_local_data_dir().unwrap();
    let _ = fs::create_dir_all(&dir);
    dir.join("autosave.md")
}

#[tauri::command]
pub fn autosave(content: String, app: tauri::AppHandle) -> Result<(), String> {
    fs::write(autosave_path(&app), content).map_err(|_| "自動保存に失敗しました".into())
}

#[tauri::command]
pub fn read_autosave(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let file = autosave_path(&app);
    if file.exists() {
        fs::read_to_string(file)
            .map(Some)
            .map_err(|_| "復元データを読み込めませんでした".into())
    } else {
        Ok(None)
    }
}

#[tauri::command]
pub fn delete_autosave(app: tauri::AppHandle) {
    fs::remove_file(autosave_path(&app)).ok();
}
