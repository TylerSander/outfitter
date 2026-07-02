//! Flatpak provider (Linux). User-scoped installs from flathub only.

use super::{InstalledPackage, Provider};

const FLATHUB_REPO: &str = "https://dl.flathub.org/repo/flathub.flatpakrepo";

pub struct Flatpak;

impl Provider for Flatpak {
    fn manager_name(&self) -> &'static str {
        "flatpak"
    }

    fn version(&self) -> Option<String> {
        super::probe_version(&["flatpak", "--version"])
    }

    fn detect_installed(&self) -> Result<Vec<InstalledPackage>, String> {
        // Piped (non-tty) output is header-less and tab-separated.
        let output = super::run_capture(&[
            "flatpak",
            "list",
            "--app",
            "--columns=application,version",
        ])?;
        Ok(parse_list(&output))
    }

    fn install_args(&self, package_id: &str) -> Vec<String> {
        super::argv(&[
            "flatpak",
            "install",
            "-y",
            "--user",
            "--noninteractive",
            "flathub",
            package_id,
        ])
    }

    fn uninstall_args(&self, package_id: &str) -> Vec<String> {
        super::argv(&["flatpak", "uninstall", "-y", "--user", package_id])
    }

    fn pre_install_args(&self) -> Option<Vec<String>> {
        // Idempotent thanks to --if-not-exists; guarantees the remote is
        // present on fresh systems before the first install.
        Some(super::argv(&[
            "flatpak",
            "remote-add",
            "--user",
            "--if-not-exists",
            "flathub",
            FLATHUB_REPO,
        ]))
    }
}

fn parse_list(output: &str) -> Vec<InstalledPackage> {
    output
        .lines()
        .filter_map(|line| {
            let mut columns = line.split('\t');
            let id = columns.next()?.trim();
            if id.is_empty() {
                return None;
            }
            let version = columns.next().unwrap_or("").trim().to_string();
            Some(InstalledPackage {
                manager: "flatpak".to_string(),
                id: id.to_string(),
                version,
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_tab_separated_rows_with_trailing_newline() {
        let out = "org.mozilla.firefox\t141.0\norg.gnome.Calculator\t48.1\n";
        let packages = parse_list(out);
        assert_eq!(packages.len(), 2);
        assert_eq!(packages[0].manager, "flatpak");
        assert_eq!(packages[0].id, "org.mozilla.firefox");
        assert_eq!(packages[0].version, "141.0");
        assert_eq!(packages[1].id, "org.gnome.Calculator");
        assert_eq!(packages[1].version, "48.1");
    }

    #[test]
    fn empty_version_field_becomes_empty_string() {
        let out = "com.example.NoVersion\t\ncom.example.BareColumn\n";
        let packages = parse_list(out);
        assert_eq!(packages.len(), 2);
        assert_eq!(packages[0].id, "com.example.NoVersion");
        assert_eq!(packages[0].version, "");
        assert_eq!(packages[1].id, "com.example.BareColumn");
        assert_eq!(packages[1].version, "");
    }

    #[test]
    fn blank_lines_and_empty_output_are_ignored() {
        assert!(parse_list("").is_empty());
        assert!(parse_list("\n\n\t\n").is_empty());
    }
}
