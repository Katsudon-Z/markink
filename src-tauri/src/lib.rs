// MDNotepad バックエンド: 各関心ごとにモジュール分割し、ここは編成のみを行う
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
        // 2重起動時は既存ウィンドウにファイルを開かせる
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            startup::forward_open_file(app, &argv);
        }))
        .manage(CurrentDocument::default())
        .invoke_handler(tauri::generate_handler![
            // document
            document::read_markdown,
            document::write_markdown,
            document::write_text_file,
            document::write_asset,
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
            mcp::mcp_autostart,
            mcp::mcp_set_enabled,
            mcp::mcp_regenerate_token,
            mcp::mcp_status,
            mcp::mcp_disconnect_ai,
            mcp::mcp_get_ai_auto_save,
            mcp::mcp_set_ai_auto_save,
            mcp::mcp_exe_path,
            mcp::notify::mcp_doc_changed,
            mcp::gateway::mcp_response
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
