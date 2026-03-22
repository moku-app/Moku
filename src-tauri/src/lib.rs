use std::path::PathBuf;
use std::sync::Mutex;
use std::io::Write;
use sysinfo::Disks;
use serde::Serialize;
use tauri::{Manager, WindowEvent};
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

/// Strip the \\?\ extended-length path prefix that Windows adds to long paths.
/// Java and many other tools do not accept this prefix and will fail silently.
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
    base.join("Tachidesk/downloads")
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
fn get_platform_ui_scale() -> f64 {
    #[cfg(target_os = "windows")]
    return 1.0;
    #[cfg(target_os = "macos")]
    return 1.0;
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    return 1.5;
}

fn kill_tachidesk(app: &tauri::AppHandle) {
    let state = app.state::<ServerState>();
    if let Some(child) = state.0.lock().unwrap().take() {
        let _ = child.kill();
    }

    #[cfg(target_os = "windows")]
    let _ = std::process::Command::new("taskkill")
        .args(["/F", "/FI", "IMAGENAME eq java*"])
        .status();

    #[cfg(not(target_os = "windows"))]
    let _ = std::process::Command::new("pkill")
        .args(["-f", "tachidesk"])
        .status();
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
            .join("dev.moku.app/tachidesk")
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

fn find_java_in_bundle(bundle_dir: &PathBuf, log: &mut Option<std::fs::File>) -> Option<PathBuf> {
    #[cfg(target_os = "windows")]
    let java = bundle_dir.join("jre").join("bin").join("java.exe");

    #[cfg(not(target_os = "windows"))]
    let java = bundle_dir.join("jre").join("bin").join("java");

    do_log(log, &format!("[find_java] checking path: {:?}", java));
    do_log(log, &format!("[find_java] exists: {}", java.exists()));

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
    do_log(log, &format!("[resolve] binary arg = {:?}", binary));

    if !binary.trim().is_empty() {
        do_log(log, "[resolve] using user-supplied binary path");
        return Ok(ServerInvocation {
            bin:         binary.to_string(),
            args:        vec![],
            working_dir: None,
        });
    }

    let resource_dir = match app.path().resource_dir() {
        Ok(p) => {
            let stripped = strip_unc(p);
            do_log(log, &format!("[resolve] resource_dir (stripped) = {:?}", stripped));
            stripped
        }
        Err(e) => {
            let msg = format!("resource_dir error: {e}");
            do_log(log, &format!("[resolve] ERROR: {}", msg));
            return Err(SpawnError::SpawnFailed(msg));
        }
    };

    #[cfg(not(target_os = "macos"))]
    {
        let bundle_dir = resource_dir.join("binaries").join("suwayomi-bundle");
        let jar        = bundle_dir.join("bin").join("Suwayomi-Server.jar");

        do_log(log, &format!("[resolve] bundle_dir = {:?}", bundle_dir));
        do_log(log, &format!("[resolve] bundle_dir exists: {}", bundle_dir.exists()));
        do_log(log, &format!("[resolve] jar = {:?}", jar));
        do_log(log, &format!("[resolve] jar exists: {}", jar.exists()));

        match find_java_in_bundle(&bundle_dir, log) {
            Some(java) => {
                do_log(log, &format!("[resolve] java found: {:?}", java));
                if jar.exists() {
                    do_log(log, "[resolve] both java and jar found — using bundled JRE");
                    return Ok(ServerInvocation {
                        bin: java.to_string_lossy().into_owned(),
                        args: vec![
                            "-jar".to_string(),
                            jar.to_string_lossy().into_owned(),
                        ],
                        working_dir: Some(bundle_dir),
                    });
                } else {
                    do_log(log, "[resolve] java found but jar MISSING — skipping bundled path");
                }
            }
            None => {
                do_log(log, "[resolve] java NOT found in bundle — skipping bundled path");
            }
        }
    }

    #[cfg(target_os = "macos")]
    {
        let candidates = [
            "suwayomi-server-aarch64-apple-darwin",
            "suwayomi-server-x86_64-apple-darwin",
            "suwayomi-server",
        ];
        for name in &candidates {
            let p = resource_dir.join(name);
            do_log(log, &format!("[resolve] macOS candidate: {:?} exists={}", p, p.exists()));
            if p.exists() {
                do_log(log, &format!("[resolve] using macOS candidate: {:?}", p));
                return Ok(ServerInvocation {
                    bin:         p.to_string_lossy().into_owned(),
                    args:        vec![],
                    working_dir: None,
                });
            }
        }
    }

    do_log(log, "[resolve] trying PATH fallback");
    for name in &["suwayomi-server", "tachidesk-server"] {
        let found = std::process::Command::new("which")
            .arg(name)
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false);

        do_log(log, &format!("[resolve] PATH check {:?}: found={}", name, found));

        if found {
            do_log(log, &format!("[resolve] using PATH binary: {}", name));
            return Ok(ServerInvocation {
                bin:         name.to_string(),
                args:        vec![],
                working_dir: None,
            });
        }
    }

    do_log(log, "[resolve] FAILED — no binary found anywhere");
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
    let mut log = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_path)
        .ok();

    do_log(&mut log, "");
    do_log(&mut log, "========================================");
    do_log(&mut log, &format!("[spawn_server] called at {:?}", std::time::SystemTime::now()));
    do_log(&mut log, &format!("[spawn_server] binary arg = {:?}", binary));
    do_log(&mut log, &format!("[spawn_server] data_dir = {:?}", data_dir));
    do_log(&mut log, &format!("[spawn_server] log file = {:?}", log_path));
    do_log(&mut log, &format!("[spawn_server] APPDATA = {:?}", std::env::var("APPDATA")));
    do_log(&mut log, &format!("[spawn_server] LOCALAPPDATA = {:?}", std::env::var("LOCALAPPDATA")));
    do_log(&mut log, &format!("[spawn_server] current_dir = {:?}", std::env::current_dir()));

    seed_server_conf(&data_dir);
    do_log(&mut log, "[spawn_server] server.conf seeded");

    let mut invocation = match resolve_server_binary(&binary, &app, &mut log) {
        Ok(i) => i,
        Err(e) => {
            do_log(&mut log, &format!("[spawn_server] resolve FAILED: {:?}", e));
            return Err(e);
        }
    };

    let bin_display = invocation.bin.clone();
    let rootdir_flag = format!(
        "-Dsuwayomi.tachidesk.config.server.rootDir={}",
        data_dir.to_string_lossy()
    );

    invocation.args.insert(0, rootdir_flag);

    let working_dir = invocation.working_dir
        .unwrap_or_else(|| std::env::current_dir().unwrap_or_default());

    do_log(&mut log, &format!("[spawn_server] bin = {:?}", bin_display));
    do_log(&mut log, &format!("[spawn_server] args = {:?}", invocation.args));
    do_log(&mut log, &format!("[spawn_server] working_dir = {:?}", working_dir));

    let cmd = app.shell()
        .command(&invocation.bin)
        .env("JAVA_TOOL_OPTIONS", "-Djava.awt.headless=true")
        .args(&invocation.args)
        .current_dir(&working_dir);

    do_log(&mut log, "[spawn_server] calling cmd.spawn()...");

    match cmd.spawn() {
        Ok((_rx, child)) => {
            do_log(&mut log, &format!("[spawn_server] SUCCESS — spawned: {}", bin_display));
            *app.state::<ServerState>().0.lock().unwrap() = Some(child);
            Ok(())
        }
        Err(e) => {
            do_log(&mut log, &format!("[spawn_server] SPAWN FAILED: {}", e));
            do_log(&mut log, &format!("[spawn_server] error kind: {:?}", e));
            Err(SpawnError::SpawnFailed(e.to_string()))
        }
    }
}

#[tauri::command]
fn kill_server(app: tauri::AppHandle) -> Result<(), String> {
    kill_tachidesk(&app);
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(ServerState(Mutex::new(None)))
        .invoke_handler(tauri::generate_handler![
            get_storage_info,
            spawn_server,
            kill_server,
            get_platform_ui_scale,
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
