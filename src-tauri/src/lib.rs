pub mod catalog;
pub mod ops;
pub mod providers;

use tauri::{AppHandle, State};

use ops::{Job, OpKind, OpsState};
use providers::{InstalledPackage, ManagerStatus};

fn current_platform() -> &'static str {
    if cfg!(target_os = "windows") {
        "windows"
    } else if cfg!(target_os = "macos") {
        "macos"
    } else {
        "linux"
    }
}

#[tauri::command]
fn get_platform() -> &'static str {
    current_platform()
}

#[tauri::command]
fn get_catalog() -> Result<serde_json::Value, String> {
    catalog::catalog_value()
}

// Async + spawn_blocking: these probe/spawn package-manager binaries, which
// must never block the main thread (sync commands run on it).
#[tauri::command]
async fn get_manager_status() -> Result<Vec<ManagerStatus>, String> {
    tauri::async_runtime::spawn_blocking(providers::manager_statuses)
        .await
        .map_err(|e| format!("manager status task failed: {e}"))
}

#[tauri::command]
async fn detect_installed() -> Result<Vec<InstalledPackage>, String> {
    tauri::async_runtime::spawn_blocking(providers::detect_installed_all)
        .await
        .map_err(|e| format!("detection task failed: {e}"))
}

#[tauri::command]
fn install_app(
    app: AppHandle,
    state: State<'_, OpsState>,
    app_id: String,
    manager: String,
    package_id: String,
) -> Result<(), String> {
    enqueue(&app, &state, OpKind::Install, app_id, manager, package_id)
}

#[tauri::command]
fn uninstall_app(
    app: AppHandle,
    state: State<'_, OpsState>,
    app_id: String,
    manager: String,
    package_id: String,
) -> Result<(), String> {
    enqueue(&app, &state, OpKind::Uninstall, app_id, manager, package_id)
}

fn enqueue(
    app: &AppHandle,
    state: &OpsState,
    kind: OpKind,
    app_id: String,
    manager: String,
    package_id: String,
) -> Result<(), String> {
    catalog::validate_source(current_platform(), &app_id, &manager, &package_id)?;
    if providers::by_name(&manager).is_none() {
        return Err(format!(
            "manager '{manager}' is not supported on this platform"
        ));
    }
    state.enqueue(
        app,
        Job {
            app_id,
            kind,
            manager,
            package_id,
        },
    )
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(OpsState::new())
        .invoke_handler(tauri::generate_handler![
            get_platform,
            get_catalog,
            get_manager_status,
            detect_installed,
            install_app,
            uninstall_app
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
