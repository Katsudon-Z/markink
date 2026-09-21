// markink バックエンド: 各関心ごとにモジュール分割し、ここは編成のみを行う
mod ai_serve;
mod autosave;
mod collab_host;
mod collab_relay;
mod document;
mod fsutil;
mod mcp;
mod settings;
mod startup;

use collab_host::{collab_probe_signal, collab_release_signal, collab_resolve_signal};
use document::CurrentDocument;

#[tauri::command]
fn collab_relay_stats(room: String) -> Option<collab_relay::RelayStats> {
    collab_relay::relay_stats(&room)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // mcp-stdio モード: GUI を起動せず、stdin/stdout ⇄ 本体WS の中継専用プロセスとして動く。
    // single-instance プラグインより前で分岐すること (mcp-plan.md §2.0)。
    if mcp::transport_stdio::is_stdio_mode() {
        mcp::transport_stdio::run_stdio_mode();
    }

    startup::init_from_args();

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            // 開発版では画面キャプチャしやすいようにコンテンツ保護を解除する。
            // リリースビルドではこのブロック自体をコンパイルしない。
            #[cfg(debug_assertions)]
            {
                use tauri::Manager;
                if let Some(window) = app.get_webview_window("main") {
                    window.set_content_protected(false)?;
                }
            }
            Ok(())
        })
        // 複数起動を許可する (単一起動プラグインは使わない)。
        // 文書フォルダごとに .markink マーカーで合流するため、別文書は干渉しない。
        .manage(CurrentDocument::default())
        // 終了時にAIデーモンを掃除する (孤児化すると次回起動時のポート競合になる)
        .on_window_event(|_win, event| {
            if matches!(event, tauri::WindowEvent::CloseRequested { .. }) {
                ai_serve::shutdown();
            }
        })
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
            // AI共同編集 (MCP)
            settings::mcp_get_settings,
            settings::set_restore_enabled,
            settings::set_user_name,
            settings::os_username,
            settings::set_line_numbers,
            settings::set_image_path_mode,
            settings::set_editor_font,
            mcp::mcp_autostart,
            mcp::mcp_set_enabled,
            mcp::mcp_regenerate_token,
            mcp::mcp_status,
            mcp::mcp_disconnect_ai,
            mcp::mcp_get_ai_auto_save,
            mcp::mcp_set_ai_auto_save,
            mcp::mcp_exe_path,
            mcp::notify::mcp_doc_changed,
            mcp::gateway::mcp_response,
            // エディタ起点のAI呼び出し (opencode serve)
            ai_serve::ai_status,
            ai_serve::ai_set_enabled,
            ai_serve::ai_set_config,
            ai_serve::ai_ask,
            ai_serve::ai_abort
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
