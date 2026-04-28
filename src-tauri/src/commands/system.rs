use tauri::Manager;
#[cfg(target_os = "windows")]
use crate::server::resolve::strip_unc;

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