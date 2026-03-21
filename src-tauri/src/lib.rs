use std::path::PathBuf;
use std::sync::Mutex;
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

#[derive(Serialize)]
#[serde(tag = "kind", content = "message")]
pub enum SpawnError {
    NotConfigured(String),
    SpawnFailed(String),
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
fn get_scale_factor(window: tauri::Window) -> f64 {
    window.scale_factor().unwrap_or(1.0)
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
    // Absolute path to java/javaw (bundled JRE) or a PATH-resident binary name.
    // All platforms use app.shell().command() — no externalBin/sidecar needed.
    bin:         String,
    // Ordered args. rootdir_flag is inserted at position 0 by spawn_server
    // so -D flags always precede -jar for the JVM.
    args:        Vec<String>,
    // Set to the bundle dir so the jar can resolve its relative lib paths.
    working_dir: Option<PathBuf>,
}

// Returns the platform-appropriate java binary inside a bundled JRE tree,
// or None if the expected path doesn't exist.
fn find_java_in_bundle(bundle_dir: &PathBuf) -> Option<PathBuf> {
    #[cfg(target_os = "windows")]
    let java = bundle_dir.join("jre").join("bin").join("javaw.exe");

    #[cfg(not(target_os = "windows"))]
    let java = bundle_dir.join("jre").join("bin").join("java");

    if java.exists() { Some(java) } else { None }
}

fn resolve_server_binary(
    binary: &str,
    app: &tauri::AppHandle,
) -> Result<ServerInvocation, SpawnError> {
    // User-supplied explicit path — pass straight through.
    if !binary.trim().is_empty() {
        return Ok(ServerInvocation {
            bin:         binary.to_string(),
            args:        vec![],
            working_dir: None,
        });
    }

    let resource_dir = app
        .path()
        .resource_dir()
        .map_err(|e| SpawnError::SpawnFailed(format!("resource_dir error: {e}")))?;

    // ── Windows & Linux: bundled JRE ─────────────────────────────────────────
    // CI stages the Suwayomi linux-x64 / windows-x64 bundle as a resource at
    // resource_dir/suwayomi-bundle/ (jar + JRE tree). We invoke the bundled
    // java binary directly with -jar.
    //
    // Final arg order (rootdir_flag prepended by spawn_server):
    //   java  -Dsuwayomi...rootDir=<path>  -jar  Suwayomi-Launcher.jar
    //
    // -D flags MUST precede -jar or the JVM silently ignores them.
    #[cfg(not(target_os = "macos"))]
    {
        let bundle_dir = resource_dir.join("suwayomi-bundle");
        let jar        = bundle_dir.join("Suwayomi-Launcher.jar");

        if let Some(java) = find_java_in_bundle(&bundle_dir) {
            if jar.exists() {
                return Ok(ServerInvocation {
                    bin: java.to_string_lossy().into_owned(),
                    args: vec![
                        "-jar".to_string(),
                        jar.to_string_lossy().into_owned(),
                    ],
                    working_dir: Some(bundle_dir),
                });
            }
        }
    }

    // ── macOS: bundled launcher script ───────────────────────────────────────
    // The macOS workflow stages arch-specific .command launcher scripts as
    // externalBin sidecars. They are self-contained (handle JVM invocation
    // internally) so we exec the script directly with no extra args.
    #[cfg(target_os = "macos")]
    {
        let candidates = [
            "suwayomi-server-aarch64-apple-darwin",
            "suwayomi-server-x86_64-apple-darwin",
            "suwayomi-server",
        ];
        for name in &candidates {
            let p = resource_dir.join(name);
            if p.exists() {
                return Ok(ServerInvocation {
                    bin:         p.to_string_lossy().into_owned(),
                    args:        vec![],
                    working_dir: None,
                });
            }
        }
    }

    // ── PATH fallback (all platforms) ────────────────────────────────────────
    // Covers:
    //   - nix develop  (tachidesk-server in devShell.nativeBuildInputs)
    //   - nix run .#moku  (wrapProgram --prefix PATH injects tachidesk-server)
    //   - Distro package installs
    //   - Manual system installs
    //
    // The Nix wrapper script accepts "$@" passthrough so the rootdir -D flag
    // forwarded by spawn_server reaches the underlying JVM correctly.
    for name in &["suwayomi-server", "tachidesk-server"] {
        let found = std::process::Command::new("which")
            .arg(name)
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false);

        if found {
            return Ok(ServerInvocation {
                bin:         name.to_string(),
                args:        vec![],
                working_dir: None,
            });
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
    seed_server_conf(&data_dir);

    let mut invocation = resolve_server_binary(&binary, &app)?;
    let bin_display    = invocation.bin.clone();

    let rootdir_flag = format!(
        "-Dsuwayomi.tachidesk.config.server.rootDir={}",
        data_dir.to_string_lossy()
    );

    // Insert rootdir at position 0 so it always precedes -jar for the JVM.
    // For PATH-resident Nix wrapper scripts the flag is forwarded via "$@".
    invocation.args.insert(0, rootdir_flag);

    let working_dir = invocation.working_dir
        .unwrap_or_else(|| std::env::current_dir().unwrap_or_default());

    let cmd = app.shell()
        .command(&invocation.bin)
        .env("JAVA_TOOL_OPTIONS", "-Djava.awt.headless=true")
        .args(&invocation.args)
        .current_dir(&working_dir);

    match cmd.spawn() {
        Ok((_rx, child)) => {
            println!("Spawned server: {}", bin_display);
            *app.state::<ServerState>().0.lock().unwrap() = Some(child);
            Ok(())
        }
        Err(e) => {
            eprintln!("Failed to spawn {}: {}", bin_display, e);
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
            get_scale_factor,
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
