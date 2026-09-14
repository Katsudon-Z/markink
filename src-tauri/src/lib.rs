use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{Manager, State};

#[derive(Default)]
struct CurrentDocument {
    path: Mutex<Option<PathBuf>>,
}

#[tauri::command]
fn read_markdown(path: String) -> Result<String, String> {
    let p = Path::new(&path);
    if !p.exists() {
        return Err("指定されたファイルが見つかりません。保存先を確認してください。".into());
    }
    fs::read_to_string(p)
        .map_err(|_| "ファイルを読み込めませんでした。別のアプリが使用中の可能性があります。".into())
}

#[tauri::command]
fn write_markdown(path: String, content: String, state: State<CurrentDocument>) -> Result<(), String> {
    let p = Path::new(&path);
    // 親ディレクトリが存在するか確認し、無ければ案内を返す
    if let Some(parent) = p.parent() {
        if !parent.exists() {
            return Err("保存先のフォルダが見つかりません。保存場所を確認してください。".into());
        }
    }
    fs::write(p, content)
        .map_err(|_| "保存できませんでした。書き込み権限を確認してください。".to_string())?;
    *state.path.lock().unwrap() = Some(p.to_path_buf());
    Ok(())
}

#[tauri::command]
fn set_document_path(path: String, state: State<CurrentDocument>) {
    *state.path.lock().unwrap() = Some(PathBuf::from(path));
}

#[tauri::command]
fn get_current_path(state: State<CurrentDocument>) -> Option<String> {
    state.path.lock().unwrap().as_ref().map(|p| p.display().to_string())
}

#[tauri::command]
fn get_current_dir(state: State<CurrentDocument>) -> Option<String> {
    state
        .path
        .lock()
        .unwrap()
        .as_ref()
        .and_then(|p| p.parent().map(|d| d.display().to_string()))
}

// 自動保存データを削除 (正規保存や破棄後に呼ぶ)
#[tauri::command]
fn delete_autosave(app: tauri::AppHandle) {
    let dir = app.path().app_local_data_dir().unwrap();
    fs::remove_file(dir.join("autosave.md")).ok();
}

// 画像をassetsフォルダに保存し、相対パスを返す (requirements.md:57)
#[tauri::command]
fn write_asset(doc_dir: String, file_name: String, bytes: Vec<u8>) -> Result<String, String> {
    let assets_dir = Path::new(&doc_dir).join("assets");
    fs::create_dir_all(&assets_dir)
        .map_err(|_| "画像保存用フォルダを作成できませんでした。保存先の権限を確認してください。".to_string())?;
    let target = assets_dir.join(&file_name);
    fs::write(&target, &bytes)
        .map_err(|_| "画像を保存できませんでした。ディスク容量と権限を確認してください。".to_string())?;
    Ok(format!("assets/{}", file_name))
}

// 自動保存用: ローカル一時領域に保存し、異常終了後の復元に使用 (requirements.md:48,101)
#[tauri::command]
fn autosave(content: String, app: tauri::AppHandle) -> Result<(), String> {
    let dir = app.path().app_local_data_dir().unwrap();
    fs::create_dir_all(&dir).ok();
    let file = dir.join("autosave.md");
    fs::write(file, content)
        .map_err(|_| "自動保存に失敗しました".into())
}

// 復元提案の確認: 前回異常終了時に自動保存データがあるか (requirements.md:48)
#[tauri::command]
fn read_autosave(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let dir = app.path().app_local_data_dir().unwrap();
    let file = dir.join("autosave.md");
    if file.exists() {
        fs::read_to_string(file)
            .map(Some)
            .map_err(|_| "復元データを読み込めませんでした".into())
    } else {
        Ok(None)
    }
}

mod collab_host;
use collab_host::{collab_release_signal, collab_resolve_signal};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(CurrentDocument::default())
        .invoke_handler(tauri::generate_handler![
            read_markdown,
            write_markdown,
            set_document_path,
            get_current_path,
            get_current_dir,
            write_asset,
            autosave,
            read_autosave,
            delete_autosave,
            collab_resolve_signal,
            collab_release_signal
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
