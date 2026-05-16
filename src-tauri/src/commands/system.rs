#[cfg(target_os = "windows")]
use crate::server::resolve::strip_unc;
#[cfg(target_os = "windows")]
use std::path::PathBuf;
use tauri::Manager;
use std::path::PathBuf;

#[tauri::command]
pub fn get_platform_ui_scale(window: tauri::Window) -> f64 {
    window.scale_factor().unwrap_or(1.0)
}

#[tauri::command]
pub fn restart_app(app: tauri::AppHandle) {
    tauri::process::restart(&app.env());
}

#[tauri::command]
pub fn open_path(path: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        let p = strip_unc(PathBuf::from(path.trim()));
        std::process::Command::new("explorer")
            .arg(p)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "macos")]
    {
        let p = std::path::Path::new(path.trim());
        std::process::Command::new("open")
            .arg(p)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        let p = std::path::Path::new(path.trim());
        std::process::Command::new("xdg-open")
            .arg(p)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub async fn pick_downloads_folder(app: tauri::AppHandle) -> Option<String> {
    use tauri_plugin_dialog::DialogExt;
    app.dialog()
        .file()
        .set_title("Choose Downloads Folder")
        .blocking_pick_folder()
        .map(|p| p.to_string())
}

#[tauri::command]
pub fn exit_app(app: tauri::AppHandle) {
    app.exit(0);
}

#[tauri::command]
pub fn clear_moku_cache(app: tauri::AppHandle) -> Result<(), String> {
    use tauri::Manager;
    let cache_dir = app.path().app_cache_dir().map_err(|e| e.to_string())?;
    if cache_dir.exists() {
        std::fs::remove_dir_all(&cache_dir).map_err(|e| e.to_string())?;
        std::fs::create_dir_all(&cache_dir).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn clear_suwayomi_cache() -> Result<(), String> {
    use crate::server::resolve::suwayomi_data_dir;
    let data_dir = suwayomi_data_dir();
    for dir in &["cache", "bin/kcef", "cache/kcef"] {
        let p = data_dir.join(dir);
        if p.exists() {
            std::fs::remove_dir_all(&p).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

#[tauri::command]
pub fn reset_suwayomi_data(app: tauri::AppHandle) -> Result<(), String> {
    use crate::server::resolve::suwayomi_data_dir;

    crate::server::kill_tachidesk(&app);
    std::thread::sleep(std::time::Duration::from_millis(500));

    let data_dir = suwayomi_data_dir();
    for entry_name in &["database.mv.db", "extensions", "settings", "logs", "local"] {
        let p = data_dir.join(entry_name);
        if p.is_dir() {
            std::fs::remove_dir_all(&p).map_err(|e| format!("{entry_name}: {e}"))?;
        } else if p.exists() {
            std::fs::remove_file(&p).map_err(|e| format!("{entry_name}: {e}"))?;
        }
    }
    Ok(())
}
