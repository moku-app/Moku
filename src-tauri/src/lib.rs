use std::path::PathBuf;
use std::sync::Mutex;
use std::io::Write;
use sysinfo::Disks;
use serde::Serialize;
use tauri::{Manager, WindowEvent};
#[cfg(target_os = "windows")]
use tauri::Emitter;
use tauri_plugin_shell::{ShellExt, process::CommandChild};
use walkdir::WalkDir;

struct ServerState(Mutex<Option<CommandChild>>);

#[derive(Serialize)]
pub struct StorageInfo {
    manga_bytes: u64,
    total_bytes: u64,
    free_bytes:  u64,
    path:        String,
}

#[derive(Serialize, Debug)]
#[serde(tag = "kind", content = "message")]
pub enum SpawnError {
    NotConfigured(String),
    SpawnFailed(String),
}

#[derive(Serialize, Clone)]
pub struct ReleaseInfo {
    pub tag_name:     String,
    pub name:         String,
    pub body:         String,
    pub published_at: String,
    pub html_url:     String,
}

#[derive(Clone, serde::Serialize)]
#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
struct UpdateProgress {
    downloaded: u64,
    total:      Option<u64>,
}

fn strip_unc(path: PathBuf) -> PathBuf {
    let s = path.to_string_lossy();
    if let Some(stripped) = s.strip_prefix(r"\\?\") {
        PathBuf::from(stripped)
    } else {
        path
    }
}

fn resolve_downloads_path(downloads_path: &str) -> PathBuf {
    if !downloads_path.trim().is_empty() {
        return PathBuf::from(downloads_path);
    }
    let base = std::env::var("XDG_DATA_HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|_| dirs::data_dir().unwrap_or_else(|| PathBuf::from("/")));
    base.join("Tachidesk").join("downloads")
}

#[tauri::command]
fn get_storage_info(downloads_path: String) -> Result<StorageInfo, String> {
    let path = resolve_downloads_path(&downloads_path);

    let manga_bytes = if path.exists() {
        WalkDir::new(&path)
            .into_iter()
            .filter_map(|e| e.ok())
            .filter_map(|e| e.metadata().ok())
            .filter(|m| m.is_file())
            .map(|m| m.len())
            .sum()
    } else {
        0
    };

    let stat_path = if path.exists() {
        path.clone()
    } else {
        dirs::home_dir().unwrap_or_else(|| PathBuf::from("/"))
    };

    let disks = Disks::new_with_refreshed_list();
    let disk = disks
        .iter()
        .filter(|d| stat_path.starts_with(d.mount_point()))
        .max_by_key(|d| d.mount_point().as_os_str().len())
        .ok_or_else(|| "Could not find disk for path".to_string())?;

    Ok(StorageInfo {
        manga_bytes,
        total_bytes: disk.total_space(),
        free_bytes:  disk.available_space(),
        path: path.to_string_lossy().into_owned(),
    })
}

#[tauri::command]
fn get_default_downloads_path() -> String {
    resolve_downloads_path("").to_string_lossy().into_owned()
}

#[tauri::command]
fn check_path_exists(path: String) -> bool {
    std::path::Path::new(path.trim()).is_dir()
}

#[tauri::command]
fn create_directory(path: String) -> Result<(), String> {
    std::fs::create_dir_all(path.trim()).map_err(|e| e.to_string())
}

#[tauri::command]
async fn migrate_downloads(app: tauri::AppHandle, src: String, dst: String) -> Result<(), String> {
    use tauri::Emitter;
    use std::fs;

    let src_path = std::path::PathBuf::from(src.trim());
    let dst_path = std::path::PathBuf::from(dst.trim());

    if !src_path.is_dir() {
        return Ok(());
    }

    let total: u64 = WalkDir::new(&src_path)
        .into_iter()
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().is_file())
        .count() as u64;

    let _ = app.emit("migrate_progress", serde_json::json!({ "done": 0u64, "total": total, "current": "" }));

    let mut done: u64 = 0;

    for entry in WalkDir::new(&src_path).into_iter().filter_map(|e| e.ok()) {
        let rel    = entry.path().strip_prefix(&src_path).map_err(|e| e.to_string())?;
        let target = dst_path.join(rel);

        if entry.file_type().is_dir() {
            fs::create_dir_all(&target).map_err(|e| e.to_string())?;
        } else {
            if let Some(parent) = target.parent() {
                fs::create_dir_all(parent).map_err(|e| e.to_string())?;
            }
            fs::copy(entry.path(), &target).map_err(|e| e.to_string())?;
            done += 1;
            let _ = app.emit("migrate_progress", serde_json::json!({
                "done": done, "total": total, "current": rel.to_string_lossy()
            }));
        }
    }

    fs::remove_dir_all(&src_path).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn get_platform_ui_scale(window: tauri::Window) -> f64 {
    window.scale_factor().unwrap_or(1.0)
}

fn kill_tachidesk(app: &tauri::AppHandle) {
    let state = app.state::<ServerState>();
    if let Some(child) = state.0.lock().unwrap().take() {
        let _ = child.kill();
    }

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;

        let _ = std::process::Command::new("taskkill")
            .args(["/F", "/FI", "IMAGENAME eq java.exe"])
            .creation_flags(CREATE_NO_WINDOW)
            .status();

        for _ in 0..30 {
            let still_running = std::process::Command::new("tasklist")
                .args(["/FI", "IMAGENAME eq java.exe", "/NH"])
                .creation_flags(CREATE_NO_WINDOW)
                .output()
                .map(|o| String::from_utf8_lossy(&o.stdout).contains("java.exe"))
                .unwrap_or(false);

            if !still_running { break; }
            std::thread::sleep(std::time::Duration::from_millis(100));
        }
    }

    #[cfg(not(target_os = "windows"))]
    let _ = std::process::Command::new("pkill").args(["-f", "tachidesk"]).status();
}

const DEFAULT_SERVER_CONF: &str = r#"server.ip = "127.0.0.1"
server.port = 4567
server.webUIEnabled = false
server.initialOpenInBrowserEnabled = false
server.systemTrayEnabled = false
server.webUIInterface = "browser"
server.webUIFlavor = "WebUI"
server.webUIChannel = "stable"
server.electronPath = ""
server.debugLogsEnabled = false
server.downloadAsCbz = true
server.autoDownloadNewChapters = false
server.globalUpdateInterval = 12
server.maxSourcesInParallel = 6
server.extensionRepos = []
"#;

fn seed_server_conf(data_dir: &PathBuf) {
    let conf_path = data_dir.join("server.conf");

    if !conf_path.exists() {
        if let Err(e) = std::fs::create_dir_all(data_dir) {
            eprintln!("Could not create Suwayomi data dir: {e}");
            return;
        }
        if let Err(e) = std::fs::write(&conf_path, DEFAULT_SERVER_CONF) {
            eprintln!("Could not write server.conf: {e}");
        }
        return;
    }

    let Ok(contents) = std::fs::read_to_string(&conf_path) else { return };

    let patched = patch_conf_key(
        patch_conf_key(
            patch_conf_key(contents, "server.webUIEnabled", "false"),
            "server.initialOpenInBrowserEnabled", "false",
        ),
        "server.systemTrayEnabled", "false",
    );

    let _ = std::fs::write(&conf_path, patched);
}

fn patch_conf_key(text: String, key: &str, value: &str) -> String {
    let replacement = format!("{key} = {value}");
    let lines: Vec<&str> = text.lines().collect();

    if let Some(pos) = lines.iter().position(|l| l.trim_start().starts_with(key)) {
        let mut out = lines
            .iter()
            .enumerate()
            .map(|(i, l)| if i == pos { replacement.as_str() } else { l })
            .collect::<Vec<_>>()
            .join("\n");
        out.push('\n');
        return out;
    }

    let mut out = text;
    if !out.ends_with('\n') { out.push('\n'); }
    out.push_str(&replacement);
    out.push('\n');
    out
}

fn suwayomi_data_dir() -> PathBuf {
    #[cfg(target_os = "windows")]
    {
        dirs::data_dir()
            .unwrap_or_else(|| PathBuf::from("C:\\ProgramData"))
            .join("moku\\tachidesk")
    }
    #[cfg(target_os = "macos")]
    {
        dirs::data_dir()
            .unwrap_or_else(|| dirs::home_dir().unwrap_or_else(|| PathBuf::from("~")))
            .join("io.github.Youwes09.Moku.app/tachidesk")
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        let base = std::env::var("XDG_DATA_HOME")
            .map(PathBuf::from)
            .unwrap_or_else(|_| dirs::data_dir().unwrap_or_else(|| PathBuf::from("/tmp")));
        base.join("moku/tachidesk")
    }
}

struct ServerInvocation {
    bin:         String,
    args:        Vec<String>,
    working_dir: Option<PathBuf>,
}

#[cfg(not(target_os = "macos"))]
fn find_java_in_bundle(bundle_dir: &PathBuf, log: &mut Option<std::fs::File>) -> Option<PathBuf> {
    #[cfg(target_os = "windows")]
    let java = strip_unc(bundle_dir.join("jre").join("bin").join("java.exe"));
    #[cfg(not(target_os = "windows"))]
    let java = bundle_dir.join("jre").join("bin").join("java");

    do_log(log, &format!("[find_java] path: {:?} exists: {}", java, java.exists()));
    if java.exists() { Some(java) } else { None }
}

fn do_log(log: &mut Option<std::fs::File>, msg: &str) {
    eprintln!("{}", msg);
    if let Some(f) = log {
        let _ = writeln!(f, "{}", msg);
    }
}

fn resolve_server_binary(
    binary: &str,
    app: &tauri::AppHandle,
    log: &mut Option<std::fs::File>,
) -> Result<ServerInvocation, SpawnError> {
    do_log(log, &format!("[resolve] binary = {:?}", binary));

    if !binary.trim().is_empty() {
        let path = strip_unc(PathBuf::from(binary.trim()));
        do_log(log, &format!("[resolve] user path: {:?} exists={}", path, path.exists()));
        if path.exists() {
            return Ok(ServerInvocation {
                bin:         path.to_string_lossy().into_owned(),
                args:        vec![],
                working_dir: path.parent().map(|p| p.to_path_buf()),
            });
        }
        do_log(log, "[resolve] user path not found, falling through");
    }

    if let Ok(exe) = std::env::current_exe() {
        if let Some(bin_dir) = exe.parent() {
            for name in &["tachidesk-server", "suwayomi-launcher"] {
                let p = bin_dir.join(name);
                do_log(log, &format!("[resolve] sibling: {:?} exists={}", p, p.exists()));
                if p.exists() {
                    return Ok(ServerInvocation {
                        bin:         p.to_string_lossy().into_owned(),
                        args:        vec![],
                        working_dir: Some(bin_dir.to_path_buf()),
                    });
                }
            }
        }
    }

    #[cfg(not(target_os = "macos"))]
    let resource_dir = {
        let raw = app.path().resource_dir().unwrap_or_default();
        let stripped = strip_unc(raw);
        do_log(log, &format!("[resolve] resource_dir = {:?}", stripped));
        stripped
    };

    #[cfg(not(target_os = "macos"))]
    {
        let bundle_dir = resource_dir.join("binaries").join("suwayomi-bundle");
        let jar        = bundle_dir.join("bin").join("Suwayomi-Server.jar");

        do_log(log, &format!("[resolve] bundle_dir={:?} exists={}", bundle_dir, bundle_dir.exists()));
        do_log(log, &format!("[resolve] jar={:?} exists={}", jar, jar.exists()));

        match find_java_in_bundle(&bundle_dir, log) {
            Some(java) if jar.exists() => {
                do_log(log, "[resolve] using bundled JRE");
                return Ok(ServerInvocation {
                    bin:  java.to_string_lossy().into_owned(),
                    args: vec!["-jar".to_string(), jar.to_string_lossy().into_owned()],
                    working_dir: Some(bundle_dir),
                });
            }
            _ => do_log(log, "[resolve] bundled JRE/jar not found, falling through"),
        }
    }

    #[cfg(not(target_os = "macos"))]
    {
        for name in &["suwayomi-launcher", "suwayomi-launcher.sh", "tachidesk-server"] {
            let p = resource_dir.join(name);
            do_log(log, &format!("[resolve] sidecar: {:?} exists={}", p, p.exists()));
            if p.exists() {
                return Ok(ServerInvocation {
                    bin:         p.to_string_lossy().into_owned(),
                    args:        vec![],
                    working_dir: Some(resource_dir.clone()),
                });
            }
        }

        if let Some(java) = find_java_in_bundle(&resource_dir, log) {
            let jar = std::fs::read_dir(&resource_dir)
                .ok()
                .and_then(|mut rd| {
                    rd.find(|e| e.as_ref().map(|e| e.file_name().to_string_lossy().ends_with(".jar")).unwrap_or(false))
                        .and_then(|e| e.ok())
                        .map(|e| e.path())
                });

            if let Some(jar_path) = jar {
                do_log(log, &format!("[resolve] generic JRE java={:?} jar={:?}", java, jar_path));
                return Ok(ServerInvocation {
                    bin:  java.to_string_lossy().into_owned(),
                    args: vec!["-jar".to_string(), jar_path.to_string_lossy().into_owned()],
                    working_dir: Some(resource_dir),
                });
            }
        }
    }

    #[cfg(target_os = "macos")]
    {
        let resource_dir = app.path().resource_dir().unwrap_or_default();
        let macos_dir    = resource_dir.parent().map(|p| p.join("MacOS")).unwrap_or_default();

        let candidates = [
            "suwayomi-server",
            "suwayomi-server-aarch64-apple-darwin",
            "suwayomi-server-x86_64-apple-darwin",
            "suwayomi-launcher",
            "suwayomi-launcher.sh",
            "tachidesk-server",
        ];

        for search_dir in &[&macos_dir, &resource_dir] {
            for name in &candidates {
                let p = search_dir.join(name);
                do_log(log, &format!("[resolve] macOS candidate: {:?} exists={}", p, p.exists()));
                if p.exists() {
                    return Ok(ServerInvocation {
                        bin:         p.to_string_lossy().into_owned(),
                        args:        vec![],
                        working_dir: None,
                    });
                }
            }
        }
    }

    for name in &["suwayomi-server", "tachidesk-server"] {
        #[cfg(target_os = "windows")]
        let found = std::process::Command::new("where").arg(name).output().map(|o| o.status.success()).unwrap_or(false);
        #[cfg(not(target_os = "windows"))]
        let found = std::process::Command::new("which").arg(name).output().map(|o| o.status.success()).unwrap_or(false);

        if found {
            return Ok(ServerInvocation { bin: name.to_string(), args: vec![], working_dir: None });
        }
    }

    Err(SpawnError::NotConfigured(
        "Server binary not found. Install Suwayomi-Server or set the path in Settings.".to_string(),
    ))
}

#[tauri::command]
fn spawn_server(binary: String, app: tauri::AppHandle) -> Result<(), SpawnError> {
    {
        let state = app.state::<ServerState>();
        if state.0.lock().unwrap().is_some() {
            return Ok(());
        }
    }

    let data_dir = suwayomi_data_dir();
    let log_path = data_dir.join("moku-spawn.log");
    let _ = std::fs::create_dir_all(&data_dir);
    let mut log = std::fs::OpenOptions::new().create(true).append(true).open(&log_path).ok();

    do_log(&mut log, &format!("[spawn_server] binary={:?} data_dir={:?}", binary, data_dir));

    seed_server_conf(&data_dir);

    let mut invocation = resolve_server_binary(&binary, &app, &mut log).map_err(|e| {
        do_log(&mut log, &format!("[spawn_server] resolve failed: {:?}", e));
        e
    })?;

    if invocation.bin.ends_with("java") || invocation.bin.ends_with("java.exe") {
        let rootdir_flag = format!(
            "-Dsuwayomi.tachidesk.config.server.rootDir={}",
            data_dir.to_string_lossy()
        );
        invocation.args.insert(0, rootdir_flag);
    }

    let working_dir = invocation.working_dir.unwrap_or_else(|| std::env::current_dir().unwrap_or_default());

    do_log(&mut log, &format!("[spawn_server] bin={:?} args={:?} cwd={:?}", invocation.bin, invocation.args, working_dir));

    let cmd = app.shell()
        .command(&invocation.bin)
        .env("JAVA_TOOL_OPTIONS", "-Djava.awt.headless=true")
        .args(&invocation.args)
        .current_dir(&working_dir);

    match cmd.spawn() {
        Ok((_rx, child)) => {
            *app.state::<ServerState>().0.lock().unwrap() = Some(child);
            Ok(())
        }
        Err(e) => {
            do_log(&mut log, &format!("[spawn_server] spawn failed: {}", e));
            Err(SpawnError::SpawnFailed(e.to_string()))
        }
    }
}

#[tauri::command]
fn kill_server(app: tauri::AppHandle) -> Result<(), String> {
    kill_tachidesk(&app);
    Ok(())
}

#[tauri::command]
async fn list_releases() -> Result<Vec<ReleaseInfo>, String> {
    use tauri_plugin_http::reqwest;

    let client = reqwest::Client::builder()
        .user_agent("Moku")
        .build()
        .map_err(|e| e.to_string())?;

    let resp = client
        .get("https://api.github.com/repos/Youwes09/Moku/releases?per_page=30")
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !resp.status().is_success() {
        return Err(format!("GitHub API returned {}", resp.status()));
    }

    #[derive(serde::Deserialize)]
    struct GhRelease {
        tag_name:     String,
        name:         Option<String>,
        body:         Option<String>,
        published_at: Option<String>,
        html_url:     String,
    }

    let body = resp.text().await.map_err(|e| e.to_string())?;
    let releases: Vec<GhRelease> = serde_json::from_str(&body).map_err(|e| e.to_string())?;

    Ok(releases.into_iter().map(|r| ReleaseInfo {
        tag_name:     r.tag_name.clone(),
        name:         r.name.unwrap_or_else(|| r.tag_name.clone()),
        body:         r.body.unwrap_or_default(),
        published_at: r.published_at.unwrap_or_default(),
        html_url:     r.html_url,
    }).collect())
}

#[tauri::command]
#[allow(unused_variables)]
async fn download_and_install_update(app: tauri::AppHandle) -> Result<(), String> {
    #[cfg(not(target_os = "windows"))]
    return Err("Native install is Windows-only; open the GitHub release page instead.".into());

    #[cfg(target_os = "windows")]
    {
        use tauri_plugin_updater::UpdaterExt;

        let updater = app.updater().map_err(|e| e.to_string())?;
        let update  = updater.check().await.map_err(|e| e.to_string())?;

        let Some(update) = update else {
            return Err("No update available.".into());
        };

        let app_clone = app.clone();
        update
            .download_and_install(
                move |downloaded, total| {
                    let _ = app_clone.emit("update-progress", UpdateProgress { downloaded: downloaded as u64, total });
                },
                || {},
            )
            .await
            .map_err(|e| e.to_string())?;

        Ok(())
    }
}

#[tauri::command]
fn restart_app(app: tauri::AppHandle) {
    tauri::process::restart(&app.env());
}

#[tauri::command]
fn open_path(path: String) -> Result<(), String> {
    let p = std::path::Path::new(path.trim());
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(p)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(p)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        std::process::Command::new("xdg-open")
            .arg(p)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}


#[tauri::command]
async fn pick_downloads_folder(app: tauri::AppHandle) -> Option<String> {
    use tauri_plugin_dialog::DialogExt;
    app.dialog()
        .file()
        .set_title("Choose Downloads Folder")
        .blocking_pick_folder()
        .map(|p| p.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_discord_rpc::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(ServerState(Mutex::new(None)))
        .invoke_handler(tauri::generate_handler![
            get_storage_info,
            get_default_downloads_path,
            check_path_exists,
            create_directory,
            migrate_downloads,
            spawn_server,
            kill_server,
            get_platform_ui_scale,
            list_releases,
            download_and_install_update,
            restart_app,
            open_path,
            pick_downloads_folder,
        ])
        .setup(|_app| Ok(()))
        .on_window_event(|window, event| {
            if let WindowEvent::Destroyed = event {
                kill_tachidesk(window.app_handle());
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running moku");
}