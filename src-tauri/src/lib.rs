mod commands;
mod server;

use std::sync::Mutex;
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager, WindowEvent,
};
use tauri_plugin_shell::process::CommandChild;

pub struct ServerState(pub Mutex<Option<CommandChild>>);

fn do_quit(app: &tauri::AppHandle) {
    server::kill_tachidesk(app);
    app.exit(0);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::new().build())
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
            commands::system::exit_app,
            commands::system::clear_moku_cache,
            commands::system::clear_suwayomi_cache,
            commands::system::reset_suwayomi_data,
            commands::system::open_path,
            commands::system::pick_downloads_folder,
            commands::backup::export_app_data,
            commands::backup::import_app_data,
            commands::backup::auto_backup_app_data,
            commands::backup::get_auto_backup_dir,
            commands::backup::read_store_files,
            commands::updater::list_releases,
            commands::updater::download_and_install_update,
            commands::biometric::windows_hello_authenticate,
            commands::biometric::windows_hello_available,
        ])
        .setup(|app| {
            let lock_path = app
                .path()
                .app_data_dir()
                .unwrap_or_default()
                .join(".moku.lock");

            let lock_file = std::fs::OpenOptions::new()
                .create(true)
                .write(true)
                .open(&lock_path)
                .ok();

            let already_running = lock_file.as_ref().map(|f| {
                #[cfg(unix)]
                {
                    use std::os::unix::io::AsRawFd;
                    unsafe { libc::flock(f.as_raw_fd(), libc::LOCK_EX | libc::LOCK_NB) != 0 }
                }
                #[cfg(windows)]
                {
                    use std::os::windows::io::AsRawHandle;
                    use windows::Win32::Foundation::HANDLE;
                    use windows::Win32::Storage::FileSystem::{
                        LockFileEx, LOCKFILE_EXCLUSIVE_LOCK, LOCKFILE_FAIL_IMMEDIATELY,
                    };
                    let handle = HANDLE(f.as_raw_handle() as isize);
                    let mut overlapped = windows::Win32::System::IO::OVERLAPPED::default();
                    !unsafe {
                        LockFileEx(handle, LOCKFILE_EXCLUSIVE_LOCK | LOCKFILE_FAIL_IMMEDIATELY, 0, 1, 0, &mut overlapped)
                    }.as_bool()
                }
                #[cfg(not(any(unix, windows)))]
                { false }
            }).unwrap_or(false);

            if already_running {
                app.handle().exit(0);
                return Ok(());
            }

            std::mem::forget(lock_file);

            let show = MenuItem::with_id(app, "show", "Show Moku", true, None::<&str>)?;
            let sep  = PredefinedMenuItem::separator(app)?;
            let quit = MenuItem::with_id(app, "quit", "Quit Moku", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &sep, &quit])?;

            TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .menu(&menu)
                .show_menu_on_left_click(false)
                .tooltip("Moku")
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => {
                        if let Some(win) = app.get_webview_window("main") {
                            let _ = win.show();
                            let _ = win.set_focus();
                        }
                    }
                    "quit" => do_quit(app),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(win) = app.get_webview_window("main") {
                            let _ = win.show();
                            let _ = win.set_focus();
                        }
                    }
                })
                .build(app)?;

            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::Destroyed = event {
                server::kill_tachidesk(window.app_handle());
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running moku");
}