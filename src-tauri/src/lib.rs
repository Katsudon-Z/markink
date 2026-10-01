// markink バックエンド: 各関心ごとにモジュール分割し、ここは編成のみを行う
mod autosave;
mod collab_host;
mod collab_relay;
mod document;
mod fsutil;
mod legacy_migration;
mod logging;
mod plugin_secrets;
mod office_copy;
mod plugin_state;
mod plugins;
mod settings;
mod startup;

use collab_host::{collab_probe_signal, collab_release_signal, collab_resolve_signal};
use document::CurrentDocument;
use tauri::Manager;

#[tauri::command]
fn collab_relay_stats(room: String) -> Option<collab_relay::RelayStats> {
    collab_relay::relay_stats(&room)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    startup::init_from_args();

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .on_window_event(|window, event| {
            if window.label() == "main" && matches!(event, tauri::WindowEvent::Destroyed) {
                for (label, editor) in window.app_handle().webview_windows() {
                    if label != "main" {
                        let _ = editor.destroy();
                    }
                }
            }
        })
        .setup(|_app| {
            plugins::recover_interrupted_updates();
            if let Err(error) = legacy_migration::run() {
                eprintln!("markink: 旧設定の移行に失敗しました: {error}");
            }
            let settings = settings::load();
            let _ =
                logging::initialize(settings.file_logging_enabled, &settings.file_logging_level);
            // 開発版では画面キャプチャしやすいようにコンテンツ保護を解除する。
            // リリースビルドではこのブロック自体をコンパイルしない。
            #[cfg(debug_assertions)]
            {
                use tauri::Manager;
                if let Some(window) = _app.get_webview_window("main") {
                    window.set_content_protected(false)?;
                }
            }
            Ok(())
        })
        // 複数起動を許可する (単一起動プラグインは使わない)。
        // 文書フォルダごとに .markink マーカーで合流するため、別文書は干渉しない。
        .manage(CurrentDocument::default())
        .invoke_handler(tauri::generate_handler![
            // document
            document::read_markdown,
            document::write_markdown,
            document::write_text_file,
            document::write_asset,
            document::read_file_bytes,
            document::set_document_path,
            document::get_current_path,
            document::get_current_dir,
            // autosave
            autosave::autosave,
            autosave::read_autosave,
            autosave::delete_autosave,
            // startup
            startup::take_startup_file,
            // collaboration
            collab_relay_stats,
            collab_resolve_signal,
            collab_probe_signal,
            collab_release_signal,
            settings::get_settings,
            settings::set_restore_enabled,
            settings::set_user_name,
            settings::os_username,
            settings::set_line_numbers,
            settings::set_image_path_mode,
            settings::set_editor_font,
            settings::set_file_logging,
            plugins::plugin_install_zip,
            plugins::plugin_list,
            plugins::plugin_preview_zip,
            plugins::plugin_read_entry,
            plugins::plugin_read_package_text,
            plugins::plugin_get_setting,
            plugins::plugin_set_setting,
            plugins::plugin_request_json,
            plugins::plugin_has_api_key,
            plugins::plugin_set_api_key,
            plugins::plugin_delete_api_key,
            plugins::plugin_uninstall,
            plugins::plugin_has_pending_update,
            plugins::plugin_commit_update,
            plugins::plugin_rollback_update,
            plugin_state::plugin_enabled_ids,
            plugin_state::plugin_set_enabled,
            logging::plugin_log,
            office_copy::copy_office_drawing,
            office_copy::copy_clipboard_data
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
