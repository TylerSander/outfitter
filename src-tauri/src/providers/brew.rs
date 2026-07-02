//! Homebrew provider (macOS). One instance handles formulae ("brew"), a
//! second handles casks ("brew-cask") — same binary, different flags.

use std::path::Path;

use super::{InstalledPackage, Provider};

pub struct Brew {
    cask: bool,
}

impl Brew {
    pub fn formula() -> Self {
        Self { cask: false }
    }

    pub fn cask() -> Self {
        Self { cask: true }
    }
}

/// brew is usually not on the PATH tauri apps inherit (launchd, not a login
/// shell), so probe the two standard install prefixes before falling back.
fn brew_program() -> String {
    for candidate in ["/opt/homebrew/bin/brew", "/usr/local/bin/brew"] {
        if Path::new(candidate).is_file() {
            return candidate.to_string();
        }
    }
    "brew".to_string()
}

impl Provider for Brew {
    fn manager_name(&self) -> &'static str {
        if self.cask {
            "brew-cask"
        } else {
            "brew"
        }
    }

    fn version(&self) -> Option<String> {
        super::probe_version(&[&brew_program(), "--version"])
    }

    fn detect_installed(&self) -> Result<Vec<InstalledPackage>, String> {
        let kind_flag = if self.cask { "--cask" } else { "--formula" };
        let output = super::run_capture(&[&brew_program(), "list", kind_flag, "--versions"])?;
        Ok(parse_versions(&output, self.manager_name()))
    }

    fn install_args(&self, package_id: &str) -> Vec<String> {
        let mut args = vec![brew_program(), "install".to_string()];
        if self.cask {
            args.push("--cask".to_string());
        }
        args.push(package_id.to_string());
        args
    }

    fn uninstall_args(&self, package_id: &str) -> Vec<String> {
        let mut args = vec![brew_program(), "uninstall".to_string()];
        if self.cask {
            args.push("--cask".to_string());
        }
        args.push(package_id.to_string());
        args
    }
}

/// `brew list --versions` prints "name version [version...]" per line; brew
/// can list several installed versions of one formula, so join the rest.
fn parse_versions(output: &str, manager: &str) -> Vec<InstalledPackage> {
    output
        .lines()
        .filter_map(|line| {
            let mut tokens = line.split_whitespace();
            let id = tokens.next()?;
            let version = tokens.collect::<Vec<_>>().join(" ");
            Some(InstalledPackage {
                manager: manager.to_string(),
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
    fn parses_name_and_version_pairs() {
        let out = "firefox 141.0\ngoogle-chrome 126.0.6478.127\n";
        let packages = parse_versions(out, "brew-cask");
        assert_eq!(packages.len(), 2);
        assert_eq!(packages[0].manager, "brew-cask");
        assert_eq!(packages[0].id, "firefox");
        assert_eq!(packages[0].version, "141.0");
        assert_eq!(packages[1].id, "google-chrome");
        assert_eq!(packages[1].version, "126.0.6478.127");
    }

    #[test]
    fn multiple_installed_versions_are_joined() {
        let out = "python@3.12 3.12.4 3.12.5\n";
        let packages = parse_versions(out, "brew");
        assert_eq!(packages.len(), 1);
        assert_eq!(packages[0].id, "python@3.12");
        assert_eq!(packages[0].version, "3.12.4 3.12.5");
    }

    #[test]
    fn blank_lines_and_missing_version_are_tolerated() {
        let out = "\nno-version-cask\n\n";
        let packages = parse_versions(out, "brew-cask");
        assert_eq!(packages.len(), 1);
        assert_eq!(packages[0].id, "no-version-cask");
        assert_eq!(packages[0].version, "");
    }
}
