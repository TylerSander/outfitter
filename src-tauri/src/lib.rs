pub mod auth;
pub mod catalog;
pub mod ops;
pub mod profile;
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

// ---- accounts (WorkOS AuthKit) ---------------------------------------------

#[tauri::command]
async fn login(app: AppHandle) -> Result<auth::Session, String> {
    tauri::async_runtime::spawn_blocking(move || auth::login_blocking(&app))
        .await
        .map_err(|e| format!("sign-in task failed: {e}"))?
}

#[tauri::command]
async fn restore_session() -> Result<Option<auth::Session>, String> {
    tauri::async_runtime::spawn_blocking(auth::restore_blocking)
        .await
        .map_err(|e| format!("session task failed: {e}"))?
}

#[tauri::command]
fn logout() {
    auth::logout();
}

// ---- profile (on-device per-user saved apps) -------------------------------

#[tauri::command]
fn get_profile(app: AppHandle, sub: String) -> Result<profile::Profile, String> {
    profile::get(&app, &sub)
}

#[tauri::command]
fn set_display_name(
    app: AppHandle,
    sub: String,
    name: Option<String>,
) -> Result<profile::Profile, String> {
    profile::set_display_name(&app, &sub, name)
}

#[tauri::command]
fn add_saved_app(
    app: AppHandle,
    sub: String,
    entry: profile::NewSavedApp,
    now: String,
) -> Result<profile::Profile, String> {
    profile::add_app(&app, &sub, entry, &now)
}

#[tauri::command]
fn remove_saved_app(app: AppHandle, sub: String, id: String) -> Result<profile::Profile, String> {
    profile::remove_app(&app, &sub, &id)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(OpsState::new())
        .invoke_handler(tauri::generate_handler![
            get_platform,
            get_catalog,
            get_manager_status,
            detect_installed,
            install_app,
            uninstall_app,
            login,
            restore_session,
            logout,
            get_profile,
            set_display_name,
            add_saved_app,
            remove_saved_app
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
