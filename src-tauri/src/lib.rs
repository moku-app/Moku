mod commands;
mod server;

use std::sync::Mutex;
use tauri::{Manager, WindowEvent};
use tauri_plugin_shell::process::CommandChild;

pub struct ServerState(pub Mutex<Option<CommandChild>>);

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_discord_rpc::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_process::init())
        .manage(ServerState(Mutex::new(None)))
        .invoke_handler(tauri::generate_handler![
            commands::storage::get_storage_info,
            commands::storage::get_default_downloads_path,
            commands::storage::check_path_exists,
            commands::storage::create_directory,
            commands::storage::migrate_downloads,
            commands::server::spawn_server,
            commands::server::kill_server,
            commands::system::get_platform_ui_scale,
            commands::system::restart_app,
            commands::system::open_path,
            commands::system::pick_downloads_folder,
            commands::backup::export_app_data,
            commands::backup::import_app_data,
            commands::backup::auto_backup_app_data,
            commands::backup::get_auto_backup_dir,
            commands::updater::list_releases,
            commands::updater::download_and_install_update,
        ])
        .setup(|_app| Ok(()))
        .on_window_event(|window, event| {
            if let WindowEvent::Destroyed = event {
                server::kill_tachidesk(window.app_handle());
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running moku");
}