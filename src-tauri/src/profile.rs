//! Per-user profile data (display-name override + the user's own saved apps).
//!
//! Stored on-device as JSON under the app config dir, one file per WorkOS
//! user id: `profiles/<sub>.json`. This is deliberately local-first — the
//! cloud accounts API (the Cloudflare Worker in `cloud/`) isn't deployed yet,
//! so a signed-in user's list persists on this machine, tied to their
//! account. When the Worker is live, this module becomes the local cache and
//! a sync layer reconciles it with `/v1/links`. Until then everything here is
//! offline and private to the device.

use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::Manager;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedApp {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub url: Option<String>,
    #[serde(default)]
    pub note: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Profile {
    #[serde(default)]
    pub display_name: Option<String>,
    #[serde(default)]
    pub apps: Vec<SavedApp>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewSavedApp {
    pub name: String,
    #[serde(default)]
    pub url: Option<String>,
    #[serde(default)]
    pub note: Option<String>,
}

const MAX_APPS: usize = 500;
const NAME_CAP: usize = 200;
const URL_CAP: usize = 2048;
const NOTE_CAP: usize = 2000;

/// Profiles are keyed by a hash of the WorkOS user id so the on-disk filename
/// never contains raw account identifiers or path-hostile characters.
fn profile_path(app: &tauri::AppHandle, sub: &str) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("no app config dir: {e}"))?
        .join("profiles");
    std::fs::create_dir_all(&dir).map_err(|e| format!("couldn't create profile dir: {e}"))?;
    let mut hasher = Sha256::new();
    hasher.update(sub.as_bytes());
    let name = hex(&hasher.finalize()[..16]);
    Ok(dir.join(format!("{name}.json")))
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

fn load(app: &tauri::AppHandle, sub: &str) -> Result<Profile, String> {
    let path = profile_path(app, sub)?;
    match std::fs::read_to_string(&path) {
        Ok(text) => serde_json::from_str(&text).map_err(|e| format!("profile is corrupt: {e}")),
        Err(ref e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Profile::default()),
        Err(e) => Err(format!("couldn't read profile: {e}")),
    }
}

fn save(app: &tauri::AppHandle, sub: &str, profile: &Profile) -> Result<(), String> {
    let path = profile_path(app, sub)?;
    let text = serde_json::to_string_pretty(profile).map_err(|e| format!("serialize: {e}"))?;
    std::fs::write(&path, text).map_err(|e| format!("couldn't save profile: {e}"))
}

fn require(sub: &str) -> Result<(), String> {
    if sub.trim().is_empty() {
        return Err("not signed in".to_string());
    }
    Ok(())
}

pub fn get(app: &tauri::AppHandle, sub: &str) -> Result<Profile, String> {
    require(sub)?;
    load(app, sub)
}

pub fn set_display_name(
    app: &tauri::AppHandle,
    sub: &str,
    name: Option<String>,
) -> Result<Profile, String> {
    require(sub)?;
    let mut profile = load(app, sub)?;
    profile.display_name = name
        .map(|n| n.trim().chars().take(NAME_CAP).collect::<String>())
        .filter(|n| !n.is_empty());
    save(app, sub, &profile)?;
    Ok(profile)
}

pub fn add_app(
    app: &tauri::AppHandle,
    sub: &str,
    entry: NewSavedApp,
    now: &str,
) -> Result<Profile, String> {
    require(sub)?;
    let name: String = entry.name.trim().chars().take(NAME_CAP).collect();
    if name.is_empty() {
        return Err("an app needs a name".to_string());
    }
    let mut profile = load(app, sub)?;
    if profile.apps.len() >= MAX_APPS {
        return Err(format!("you've reached the {MAX_APPS}-app limit"));
    }
    let mut id_bytes = [0u8; 12];
    getrandom::getrandom(&mut id_bytes).map_err(|e| format!("randomness unavailable: {e}"))?;
    profile.apps.push(SavedApp {
        id: hex(&id_bytes),
        name,
        url: clean(entry.url, URL_CAP),
        note: clean(entry.note, NOTE_CAP),
        created_at: now.to_string(),
    });
    save(app, sub, &profile)?;
    Ok(profile)
}

pub fn remove_app(app: &tauri::AppHandle, sub: &str, id: &str) -> Result<Profile, String> {
    require(sub)?;
    let mut profile = load(app, sub)?;
    let before = profile.apps.len();
    profile.apps.retain(|a| a.id != id);
    if profile.apps.len() == before {
        return Err("that app is no longer in your list".to_string());
    }
    save(app, sub, &profile)?;
    Ok(profile)
}

fn clean(value: Option<String>, cap: usize) -> Option<String> {
    value
        .map(|v| v.trim().chars().take(cap).collect::<String>())
        .filter(|v| !v.is_empty())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hex_is_lowercase_and_doubled() {
        assert_eq!(hex(&[0x0a, 0xff, 0x00]), "0aff00");
    }

    #[test]
    fn clean_trims_caps_and_nullifies_empty() {
        assert_eq!(clean(Some("  hi  ".into()), 10), Some("hi".to_string()));
        assert_eq!(clean(Some("   ".into()), 10), None);
        assert_eq!(clean(Some("abcdef".into()), 3), Some("abc".to_string()));
        assert_eq!(clean(None, 10), None);
    }

    #[test]
    fn require_rejects_blank_sub() {
        assert!(require("").is_err());
        assert!(require("   ").is_err());
        assert!(require("user_123").is_ok());
    }
}
