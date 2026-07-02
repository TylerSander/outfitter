//! Embedded application catalog.
//!
//! The catalog ships inside the binary (`include_str!`) and is parsed exactly
//! once. Commands hand the raw JSON to the frontend untouched; the typed
//! helpers below exist only for validating install/uninstall requests.

use std::sync::OnceLock;

use serde_json::Value;

const CATALOG_JSON: &str = include_str!("../../catalog/catalog.json");

static CATALOG: OnceLock<Result<Value, String>> = OnceLock::new();

/// Parsed catalog, parsed on first access. A parse failure is reported as an
/// error instead of panicking so a corrupt build degrades gracefully.
pub fn catalog() -> Result<&'static Value, String> {
    CATALOG
        .get_or_init(|| {
            serde_json::from_str(CATALOG_JSON)
                .map_err(|e| format!("embedded catalog.json is invalid: {e}"))
        })
        .as_ref()
        .map_err(String::clone)
}

/// Owned copy of the catalog for the `get_catalog` command boundary.
pub fn catalog_value() -> Result<Value, String> {
    catalog().cloned()
}

/// One entry of an app's `sources.<platform>` array.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SourceRef {
    pub manager: String,
    pub package_id: String,
    pub official: bool,
}

/// All catalog sources for `app_id` on `platform` ("windows" | "macos" | "linux").
pub fn sources_for(platform: &str, app_id: &str) -> Result<Vec<SourceRef>, String> {
    let cat = catalog()?;
    let apps = cat
        .get("apps")
        .and_then(Value::as_array)
        .ok_or_else(|| "catalog has no apps array".to_string())?;
    let app = apps
        .iter()
        .find(|a| a.get("id").and_then(Value::as_str) == Some(app_id))
        .ok_or_else(|| format!("unknown app '{app_id}'"))?;
    let sources = app
        .get("sources")
        .and_then(|s| s.get(platform))
        .and_then(Value::as_array)
        .ok_or_else(|| format!("app '{app_id}' has no source list for platform '{platform}'"))?;
    Ok(sources
        .iter()
        .filter_map(|s| {
            Some(SourceRef {
                manager: s.get("manager")?.as_str()?.to_string(),
                package_id: s.get("id")?.as_str()?.to_string(),
                official: s.get("official").and_then(Value::as_bool).unwrap_or(false),
            })
        })
        .collect())
}

/// The source the UI is expected to use: first entry of the platform list.
pub fn first_source(platform: &str, app_id: &str) -> Result<SourceRef, String> {
    sources_for(platform, app_id)?
        .into_iter()
        .next()
        .ok_or_else(|| format!("app '{app_id}' is not available on {platform}"))
}

/// Reject install/uninstall requests whose (manager, package id) pair is not
/// listed in the catalog for this app and platform. This keeps the IPC surface
/// from being usable to run arbitrary package operations.
pub fn validate_source(
    platform: &str,
    app_id: &str,
    manager: &str,
    package_id: &str,
) -> Result<(), String> {
    let sources = sources_for(platform, app_id)?;
    if sources.is_empty() {
        return Err(format!("app '{app_id}' is not available on {platform}"));
    }
    if sources
        .iter()
        .any(|s| s.manager == manager && s.package_id == package_id)
    {
        Ok(())
    } else {
        Err(format!(
            "'{manager}:{package_id}' is not a catalog source for '{app_id}' on {platform}"
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn embedded_catalog_parses() {
        let cat = catalog().expect("catalog should parse");
        assert_eq!(cat.get("schemaVersion").and_then(Value::as_i64), Some(1));
        let apps = cat.get("apps").and_then(Value::as_array).expect("apps array");
        assert!(!apps.is_empty());
    }

    #[test]
    fn every_app_has_id_and_sources() {
        let cat = catalog().expect("catalog should parse");
        let apps = cat.get("apps").and_then(Value::as_array).expect("apps array");
        for app in apps {
            let id = app.get("id").and_then(Value::as_str).expect("app id");
            let sources = app.get("sources").expect("sources object");
            for platform in ["windows", "macos", "linux"] {
                assert!(
                    sources.get(platform).and_then(Value::as_array).is_some(),
                    "app '{id}' is missing sources.{platform}"
                );
            }
        }
    }

    #[test]
    fn unknown_app_is_rejected() {
        let err = validate_source("linux", "definitely-not-a-real-app", "flatpak", "x");
        assert!(err.is_err());
    }

    #[test]
    fn mismatched_source_is_rejected() {
        let cat = catalog().expect("catalog should parse");
        let apps = cat.get("apps").and_then(Value::as_array).expect("apps array");
        let first_id = apps[0].get("id").and_then(Value::as_str).expect("app id");
        let err = validate_source("linux", first_id, "flatpak", "com.example.NotInCatalog");
        assert!(err.is_err());
    }
}
