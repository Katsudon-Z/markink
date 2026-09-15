use std::path::Path;
use std::sync::Mutex;

use tauri::{Emitter, Manager};

/// .md 関連付けのダブルクリック起動用: 起動引数からファイルを受け取る
static STARTUP_FILE: Mutex<Option<String>> = Mutex::new(None);

/// 引数が存在する Markdown ファイルを指す場合のみ採用する
pub fn markdown_file_arg(arg: &str) -> Option<String> {
    let lower = arg.to_lowercase();
    if (lower.ends_with(".md") || lower.ends_with(".markdown")) && Path::new(arg).exists() {
        Some(arg.to_string())
    } else {
        None
    }
}

/// 起動時に一度だけ呼ぶ。診断用に引数を一時フォルダへ記録する。
pub fn init_from_args() {
    let args: Vec<String> = std::env::args_os()
        .map(|a| a.to_string_lossy().to_string())
        .collect();
    let detected = args.iter().skip(1).find_map(|a| markdown_file_arg(a));
    *STARTUP_FILE.lock().unwrap() = detected.clone();

    if let Ok(mut log) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(std::env::temp_dir().join("mdnotepad-startup.log"))
    {
        use std::io::Write;
        let _ = writeln!(
            log,
            "[{:?}] args={:?} detected={:?}",
            std::time::SystemTime::now(),
            args,
            detected
        );
    }
}

/// 単一起動プラグインから呼ぶ: 2重起動時に既存ウィンドウへファイルを渡す
pub fn forward_open_file(app: &tauri::AppHandle, argv: &[String]) {
    if let Some(path) = argv.iter().skip(1).find_map(|a| markdown_file_arg(a)) {
        let _ = app.emit("open-file", path);
    }
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.set_focus();
    }
}

#[tauri::command]
pub fn take_startup_file() -> Option<String> {
    STARTUP_FILE.lock().unwrap().take()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn filters_markdown_args() {
        let dir = std::env::temp_dir();
        let md = dir.join("mdn-startup-test.md");
        std::fs::write(&md, "test").unwrap();
        let s = md.to_string_lossy().to_string();
        assert_eq!(markdown_file_arg(&s), Some(s.clone()));
        assert!(markdown_file_arg("C:\\no-such-dir\\x.md").is_none());
        assert!(markdown_file_arg("--port").is_none());
        assert!(markdown_file_arg(&md.with_extension("txt").to_string_lossy().to_string()).is_none());
        let _ = std::fs::remove_file(&md);
    }
}
