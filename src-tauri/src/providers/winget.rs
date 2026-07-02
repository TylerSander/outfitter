//! winget provider (Windows).
//!
//! FRAGILITY NOTE: `winget list` has no machine-readable output (no JSON as
//! of winget 1.x), so we parse its fixed-width table best-effort:
//! - column positions are taken from the header line ("Id", "Version", ...);
//! - data rows are sliced by *character* offset. winget pads by terminal
//!   display width, so rows whose Name contains wide glyphs (CJK, emoji)
//!   mis-align; the id sanity checks below drop such rows instead of
//!   returning garbage;
//! - values truncated by winget (U+2026 ellipsis) are dropped because a
//!   truncated id cannot be matched against the catalog.
//!
//! Per-id `winget list --id <id> --exact` queries would be exact but far too
//! slow (one winget invocation per catalog app).

use super::{InstalledPackage, Provider};

pub struct Winget;

impl Provider for Winget {
    fn manager_name(&self) -> &'static str {
        "winget"
    }

    fn version(&self) -> Option<String> {
        super::probe_version(&["winget", "--version"])
    }

    fn detect_installed(&self) -> Result<Vec<InstalledPackage>, String> {
        let output = super::run_capture(&["winget", "list", "--disable-interactivity"])?;
        Ok(parse_list(&output))
    }

    fn install_args(&self, package_id: &str) -> Vec<String> {
        super::argv(&[
            "winget",
            "install",
            "--id",
            package_id,
            "--exact",
            "--silent",
            "--accept-source-agreements",
            "--accept-package-agreements",
            "--disable-interactivity",
        ])
    }

    fn uninstall_args(&self, package_id: &str) -> Vec<String> {
        super::argv(&[
            "winget",
            "uninstall",
            "--id",
            package_id,
            "--exact",
            "--silent",
            "--disable-interactivity",
        ])
    }
}

fn parse_list(output: &str) -> Vec<InstalledPackage> {
    parse_rows(output).unwrap_or_default()
}

fn parse_rows(output: &str) -> Option<Vec<InstalledPackage>> {
    // winget sometimes emits a UTF-8 BOM on piped output; it would shift the
    // header's char offsets relative to the data rows.
    let output = output.trim_start_matches('\u{feff}');
    let lines: Vec<&str> = output.lines().collect();

    // Find the header row; anything before it (progress spinners, source
    // update notices) is ignored.
    let header_index = lines
        .iter()
        .position(|l| find_column(l, "Id").is_some() && find_column(l, "Version").is_some())?;
    let header = lines[header_index];
    let id_start = find_column(header, "Id")?;
    let version_start = find_column(header, "Version")?;
    if version_start <= id_start {
        return None;
    }
    // The Version column ends where the next known column begins.
    let version_end = ["Available", "Source"]
        .iter()
        .filter_map(|name| find_column(header, name))
        .filter(|&pos| pos > version_start)
        .min();

    let mut packages = Vec::new();
    for line in &lines[header_index + 1..] {
        let chars: Vec<char> = line.chars().collect();
        if chars.is_empty() {
            continue;
        }
        // Separator row under the header.
        if chars.iter().all(|&c| c == '-' || c.is_whitespace()) {
            continue;
        }
        let id_raw = slice_chars(&chars, id_start, Some(version_start));
        let id = id_raw.trim();
        // Sanity checks drop footers ("N upgrades available."), mis-aligned
        // wide-glyph rows, and truncated ids.
        if id.is_empty() || id.contains(char::is_whitespace) || id.contains('\u{2026}') {
            continue;
        }
        let version = slice_chars(&chars, version_start, version_end)
            .trim()
            .to_string();
        packages.push(InstalledPackage {
            manager: "winget".to_string(),
            id: id.to_string(),
            version,
        });
    }
    Some(packages)
}

/// Char offset of a whitespace-delimited column header token.
fn find_column(header: &str, name: &str) -> Option<usize> {
    let chars: Vec<char> = header.chars().collect();
    let target: Vec<char> = name.chars().collect();
    if target.is_empty() || chars.len() < target.len() {
        return None;
    }
    for start in 0..=(chars.len() - target.len()) {
        if chars[start..start + target.len()] != target[..] {
            continue;
        }
        let before_ok = start == 0 || chars[start - 1].is_whitespace();
        let after = start + target.len();
        let after_ok = after == chars.len() || chars[after].is_whitespace();
        if before_ok && after_ok {
            return Some(start);
        }
    }
    None
}

fn slice_chars(chars: &[char], start: usize, end: Option<usize>) -> String {
    if start >= chars.len() {
        return String::new();
    }
    let end = end.unwrap_or(chars.len()).min(chars.len());
    if end <= start {
        return String::new();
    }
    chars[start..end].iter().collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn row(name: &str, id: &str, version: &str, available: &str, source: &str) -> String {
        format!("{name:<22} {id:<26} {version:<12} {available:<10} {source}")
    }

    fn sample_output() -> String {
        let header = row("Name", "Id", "Version", "Available", "Source");
        let separator = "-".repeat(78);
        [
            // Junk winget prints before the table on some terminals.
            "   - \u{2588}\u{2588}".to_string(),
            String::new(),
            header,
            separator,
            row("7-Zip 24.08 (x64)", "7zip.7zip", "24.08", "", "winget"),
            row("Mozilla Firefox", "Mozilla.Firefox", "141.0", "142.0", "winget"),
            // Truncated id: must be dropped.
            row(
                "Some Very Long Name\u{2026}",
                "SomeVendor.SomeAppWith\u{2026}",
                "1.2.3",
                "",
                "winget",
            ),
            // Registry-only entry with no version.
            row("Legacy Thing", "LegacyVendor.Legacy", "", "", ""),
            // Row truncated mid-Version by a narrow console.
            format!("{:<22} {:<26} 1.9", "Cut Off App", "CutOff.App"),
            "3 upgrades available.".to_string(),
        ]
        .join("\n")
    }

    #[test]
    fn parses_ids_and_versions_from_fixed_width_table() {
        let packages = parse_list(&sample_output());
        assert_eq!(packages.len(), 4);
        assert_eq!(packages[0].id, "7zip.7zip");
        assert_eq!(packages[0].version, "24.08");
        assert_eq!(packages[0].manager, "winget");
        assert_eq!(packages[1].id, "Mozilla.Firefox");
        assert_eq!(packages[1].version, "141.0");
    }

    #[test]
    fn drops_truncated_ids_and_footer_lines() {
        let packages = parse_list(&sample_output());
        assert!(packages.iter().all(|p| !p.id.contains('\u{2026}')));
        assert!(packages.iter().all(|p| p.id != "3"));
    }

    #[test]
    fn keeps_rows_with_missing_or_cut_off_version() {
        let packages = parse_list(&sample_output());
        assert_eq!(packages[2].id, "LegacyVendor.Legacy");
        assert_eq!(packages[2].version, "");
        assert_eq!(packages[3].id, "CutOff.App");
        assert_eq!(packages[3].version, "1.9");
    }

    #[test]
    fn returns_empty_when_no_header_found() {
        assert!(parse_list("").is_empty());
        assert!(parse_list("something went wrong\nno table here\n").is_empty());
    }
}
