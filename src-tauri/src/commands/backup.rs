use std::path::PathBuf;
use tauri::Manager;

fn backup_dir(app: &tauri::AppHandle) -> PathBuf {
    app.path()
        .app_data_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
        .join("backups")
}

fn unix_now() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

#[tauri::command]
pub async fn export_app_data(app: tauri::AppHandle, json: String) -> Result<String, String> {
    use tauri_plugin_dialog::DialogExt;

    let filename = format!("moku-backup-{}.json", unix_now());

    let path = app
        .dialog()
        .file()
        .set_title("Save Moku app data backup")
        .set_file_name(&filename)
        .blocking_save_file()
        .ok_or("Cancelled")?;

    let dest = PathBuf::from(path.to_string());
    std::fs::write(&dest, json.as_bytes()).map_err(|e| e.to_string())?;

    Ok(dest.to_string_lossy().into_owned())
}

#[tauri::command]
pub async fn import_app_data(app: tauri::AppHandle) -> Result<String, String> {
    use tauri_plugin_dialog::DialogExt;

    let path = app
        .dialog()
        .file()
        .set_title("Open Moku app data backup")
        .blocking_pick_file()
        .ok_or("Cancelled")?;

    std::fs::read_to_string(PathBuf::from(path.to_string())).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn auto_backup_app_data(app: tauri::AppHandle, json: String) -> Result<(), String> {
    let dir = backup_dir(&app);
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;

    let dest = dir.join(format!("auto-moku-backup-{}.json", unix_now()));
    std::fs::write(&dest, json.as_bytes()).map_err(|e| e.to_string())?;

    let mut entries: Vec<_> = std::fs::read_dir(&dir)
        .map_err(|e| e.to_string())?
        .filter_map(|e| e.ok())
        .filter(|e| {
            e.file_name()
                .to_string_lossy()
                .starts_with("auto-moku-backup-")
        })
        .collect();

    entries.sort_by_key(|e| e.file_name());

    for old in entries.iter().take(entries.len().saturating_sub(5)) {
        let _ = std::fs::remove_file(old.path());
    }

    Ok(())
}

#[tauri::command]
pub fn get_auto_backup_dir(app: tauri::AppHandle) -> String {
    backup_dir(&app).to_string_lossy().into_owned()
}
