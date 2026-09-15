use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use tauri::State;

use crate::fsutil::ensure_parent_dir;

/// 現在開いている文書のパス (画像の相対パス解決などに利用)
#[derive(Default)]
pub struct CurrentDocument {
    path: Mutex<Option<PathBuf>>,
}

#[tauri::command]
pub fn read_markdown(path: String) -> Result<String, String> {
    let p = Path::new(&path);
    if !p.exists() {
        return Err("指定されたファイルが見つかりません。保存先を確認してください。".into());
    }
    fs::read_to_string(p)
        .map_err(|_| "ファイルを読み込めませんでした。別のアプリが使用中の可能性があります。".into())
}

#[tauri::command]
pub fn write_markdown(path: String, content: String, state: State<CurrentDocument>) -> Result<(), String> {
    let p = Path::new(&path);
    ensure_parent_dir(p)?;
    fs::write(p, content)
        .map_err(|_| "保存できませんでした。書き込み権限を確認してください。".to_string())?;
    *state.path.lock().unwrap() = Some(p.to_path_buf());
    Ok(())
}

/// HTML などの書き出し用 (現在の文書パスは変更しない)
#[tauri::command]
pub fn write_text_file(path: String, content: String) -> Result<(), String> {
    let p = Path::new(&path);
    ensure_parent_dir(p)?;
    fs::write(p, content)
        .map_err(|_| "ファイルを書き出せませんでした。書き込み権限を確認してください。".to_string())
}

/// 画像を assets フォルダに保存し、相対パスを返す (requirements.md:57)
#[tauri::command]
pub fn write_asset(doc_dir: String, file_name: String, bytes: Vec<u8>) -> Result<String, String> {
    let assets_dir = Path::new(&doc_dir).join("assets");
    fs::create_dir_all(&assets_dir)
        .map_err(|_| "画像保存用フォルダを作成できませんでした。保存先の権限を確認してください。".to_string())?;
    fs::write(assets_dir.join(&file_name), &bytes)
        .map_err(|_| "画像を保存できませんでした。ディスク容量と権限を確認してください。".to_string())?;
    Ok(format!("assets/{}", file_name))
}

#[tauri::command]
pub fn set_document_path(path: String, state: State<CurrentDocument>) {
    *state.path.lock().unwrap() = Some(PathBuf::from(path));
}

#[tauri::command]
pub fn get_current_path(state: State<CurrentDocument>) -> Option<String> {
    state.path.lock().unwrap().as_ref().map(|p| p.display().to_string())
}

#[tauri::command]
pub fn get_current_dir(state: State<CurrentDocument>) -> Option<String> {
    state
        .path
        .lock()
        .unwrap()
        .as_ref()
        .and_then(|p| p.parent().map(|d| d.display().to_string()))
}
