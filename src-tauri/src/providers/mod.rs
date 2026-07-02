//! Package-manager providers.
//!
//! Every provider module compiles on every OS (the parsing logic is pure and
//! unit-tested everywhere); only the registry is cfg-gated to the managers
//! that actually exist on the current platform.

pub mod brew;
pub mod flatpak;
pub mod winget;

use std::process::{Command, Stdio};
use std::sync::OnceLock;

use serde::Serialize;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct InstalledPackage {
    pub manager: String,
    pub id: String,
    pub version: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct ManagerStatus {
    pub manager: String,
    pub available: bool,
    pub version: Option<String>,
}

pub trait Provider: Send + Sync {
    /// Manager name as used in catalog sources ("winget", "brew", "brew-cask", "flatpak").
    fn manager_name(&self) -> &'static str;

    /// Probe the manager binary; `Some(version line)` when usable.
    fn version(&self) -> Option<String>;

    fn is_available(&self) -> bool {
        self.version().is_some()
    }

    fn detect_installed(&self) -> Result<Vec<InstalledPackage>, String>;

    /// Full argv (program first) for installing `package_id`.
    fn install_args(&self, package_id: &str) -> Vec<String>;

    /// Full argv (program first) for uninstalling `package_id`.
    fn uninstall_args(&self, package_id: &str) -> Vec<String>;

    /// Optional argv to run before every install (e.g. ensure the flathub
    /// remote exists). Must be idempotent.
    fn pre_install_args(&self) -> Option<Vec<String>> {
        None
    }
}

static REGISTRY: OnceLock<Vec<Box<dyn Provider>>> = OnceLock::new();

/// Providers compiled for the current OS.
pub fn registry() -> &'static [Box<dyn Provider>] {
    REGISTRY.get_or_init(built_in_providers).as_slice()
}

#[cfg(target_os = "linux")]
fn built_in_providers() -> Vec<Box<dyn Provider>> {
    vec![Box::new(flatpak::Flatpak)]
}

#[cfg(target_os = "macos")]
fn built_in_providers() -> Vec<Box<dyn Provider>> {
    vec![Box::new(brew::Brew::formula()), Box::new(brew::Brew::cask())]
}

#[cfg(target_os = "windows")]
fn built_in_providers() -> Vec<Box<dyn Provider>> {
    vec![Box::new(winget::Winget)]
}

#[cfg(not(any(target_os = "linux", target_os = "macos", target_os = "windows")))]
fn built_in_providers() -> Vec<Box<dyn Provider>> {
    Vec::new()
}

pub fn by_name(manager: &str) -> Option<&'static dyn Provider> {
    registry()
        .iter()
        .find(|p| p.manager_name() == manager)
        .map(|p| p.as_ref())
}

pub fn manager_statuses() -> Vec<ManagerStatus> {
    registry()
        .iter()
        .map(|p| {
            let version = p.version();
            ManagerStatus {
                manager: p.manager_name().to_string(),
                available: version.is_some(),
                version,
            }
        })
        .collect()
}

/// Merged inventory across every available provider. Best-effort: a provider
/// that fails to list is skipped so one broken manager cannot blank the UI.
pub fn detect_installed_all() -> Vec<InstalledPackage> {
    let mut merged = Vec::new();
    for provider in registry() {
        if !provider.is_available() {
            continue;
        }
        match provider.detect_installed() {
            Ok(mut packages) => merged.append(&mut packages),
            Err(e) => eprintln!(
                "outfitter: {} detection failed: {e}",
                provider.manager_name()
            ),
        }
    }
    merged
}

/// Shared subprocess setup: pin the locale so parsers see stable output, and
/// keep Windows from flashing a console window.
pub(crate) fn configure_command(cmd: &mut Command) {
    cmd.env("LC_ALL", "C");
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
}

/// Run argv to completion and return stdout. Used for probes and inventory
/// listing; long-running install/uninstall work goes through `ops` instead.
pub(crate) fn run_capture(argv: &[&str]) -> Result<String, String> {
    let (program, args) = argv
        .split_first()
        .ok_or_else(|| "empty command".to_string())?;
    let mut cmd = Command::new(program);
    cmd.args(args).stdin(Stdio::null());
    configure_command(&mut cmd);
    let output = cmd
        .output()
        .map_err(|e| format!("failed to run {program}: {e}"))?;
    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).into_owned())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let last_line = stderr
            .lines()
            .rev()
            .find(|l| !l.trim().is_empty())
            .unwrap_or("")
            .trim()
            .to_string();
        let mut msg = format!("{program} exited with {}", output.status);
        if !last_line.is_empty() {
            msg.push_str(": ");
            msg.push_str(&last_line);
        }
        Err(msg)
    }
}

/// First non-empty line of `<program> --version`-style output.
pub(crate) fn probe_version(argv: &[&str]) -> Option<String> {
    let text = run_capture(argv).ok()?;
    let line = text.lines().find(|l| !l.trim().is_empty())?.trim();
    Some(line.to_string())
}

pub(crate) fn argv(parts: &[&str]) -> Vec<String> {
    parts.iter().map(|part| (*part).to_string()).collect()
}
