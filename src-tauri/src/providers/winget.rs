//! winget provider (Windows).
//!
//! Parsing rules are grounded in field-verified behavior of winget 1.29.280
//! on piped (non-TTY) stdio (2026-07-01, real Windows 11 box; see "Winget
//! Field Notes" in the project vault):
//! - piped output is clean UTF-8/CRLF: no BOM, no spinner/VT bytes, and no
//!   ellipsis truncation (truncation is console-only behavior). BOM and
//!   ellipsis handling below are kept as cheap defense for older builds;
//! - column offsets are content-derived and change per invocation, and the
//!   column SET changes with flags (`--source` drops the Source column) —
//!   offsets must come from the header row of the same run;
//! - winget pads columns by terminal *display width*: rows are sliced by
//!   display cell (unicode-width), not char index, so CJK/emoji names in one
//!   row don't shear every column to its right;
//! - `--exact` id matching is CASE-SENSITIVE: catalog ids must keep the
//!   manifest casing exactly;
//! - errors and results all arrive on STDOUT (stderr stays empty even on
//!   failure) with HRESULT exit codes; "no applications found" (0x8A150014)
//!   and "update not applicable" (0x8A15002B) are empty results, not errors;
//! - ~60% of `winget list` rows carry synthetic ids (`MSIX\...`,
//!   `ARP\Machine\X64\Steam App 1172470`) that can never match a catalog id
//!   and are filtered out;
//! - installed variants may correlate to sibling ids (a real machine's
//!   Chrome correlated to `Google.Chrome.EXE`, not `Google.Chrome`), so
//!   exact-id equality against the catalog can false-negative — variant
//!   handling is a catalog/matching-layer decision, not a parser fix.
//!
//! KNOWN LIMITATION: winget localizes column headers with the Windows UI
//! language (LC_ALL has no effect on it). "Id" and "Version" are matched
//! case-insensitively (covers e.g. German "ID") and column boundaries come
//! from whatever header tokens the run declares — localized names included —
//! but a header whose Id/Version titles are fully translated ("Versione")
//! makes detection return empty rather than guess. The locale-proof
//! alternative is `winget export` JSON, at the cost of only seeing
//! source-correlated packages (~35% of the machine's inventory).

use unicode_width::UnicodeWidthChar;

use super::{InstalledPackage, Provider};

/// APPINSTALLER_CLI_ERROR_NO_APPLICATIONS_FOUND. `ExitStatus::code()` yields
/// HRESULTs as negative i32 (-1978335212); compare after casting to u32.
const NO_APPLICATIONS_FOUND: u32 = 0x8A15_0014;
/// APPINSTALLER_CLI_ERROR_UPDATE_NOT_APPLICABLE — an empty result for update
/// queries, kept here (unused for now) so check_updates lands with the same
/// semantics.
#[allow(dead_code)]
const UPDATE_NOT_APPLICABLE: u32 = 0x8A15_002B;

pub struct Winget;

impl Provider for Winget {
    fn manager_name(&self) -> &'static str {
        "winget"
    }

    fn version(&self) -> Option<String> {
        super::probe_version(&["winget", "--version"])
    }

    fn detect_installed(&self) -> Result<Vec<InstalledPackage>, String> {
        // Full inventory (no --source): variant correlations like
        // Google.Chrome.EXE only surface in the unfiltered list.
        // --accept-source-agreements is prompt-hang insurance on first run.
        let output = super::run_capture_output(&[
            "winget",
            "list",
            "--accept-source-agreements",
            "--disable-interactivity",
        ])?;
        let stdout = String::from_utf8_lossy(&output.stdout);
        if output.status.success() {
            return Ok(parse_list(&stdout));
        }
        match output.status.code().map(|c| c as u32) {
            Some(NO_APPLICATIONS_FOUND) => Ok(Vec::new()),
            _ => Err(exit_error("winget list", &output)),
        }
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
            "--accept-source-agreements",
            "--disable-interactivity",
        ])
    }
}

/// Error string for a failed winget invocation. winget writes its error text
/// to stdout (stderr is empty even on hard failures) and exits with an
/// HRESULT, which reads best in hex.
fn exit_error(context: &str, output: &std::process::Output) -> String {
    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    let detail = [&stderr, &stdout]
        .iter()
        .flat_map(|s| s.lines().rev())
        .find(|l| !l.trim().is_empty())
        .unwrap_or("")
        .trim()
        .to_string();
    let status = match output.status.code() {
        Some(code) => format!("0x{:08X}", code as u32),
        None => output.status.to_string(),
    };
    if detail.is_empty() {
        format!("{context} exited with {status}")
    } else {
        format!("{context} exited with {status}: {detail}")
    }
}

fn parse_list(output: &str) -> Vec<InstalledPackage> {
    parse_rows(output).unwrap_or_default()
}

fn parse_rows(output: &str) -> Option<Vec<InstalledPackage>> {
    // Defensive: no BOM was observed on piped output from winget 1.29, but
    // stripping one is free and protects older App Installer builds.
    let output = output.trim_start_matches('\u{feff}');
    let lines: Vec<&str> = output.lines().collect();

    // Find the header row; tolerate any preamble defensively (none occurs on
    // a pipe in 1.29 — the header is byte 0 of the stream).
    let header_index = lines
        .iter()
        .position(|l| find_token(l, "Id").is_some() && find_token(l, "Version").is_some())?;
    let tokens = header_tokens(lines[header_index]);
    let id_start = find_in(&tokens, "Id")?;
    let version_start = find_in(&tokens, "Version")?;
    if version_start <= id_start {
        return None;
    }
    // The Version column ends where the next declared column begins —
    // whatever that column is called: the set varies per invocation
    // (Available only appears when upgrades exist, --source drops Source)
    // and non-Id/Version titles localize with the Windows UI language
    // ("Verfügbar", "Quelle"). Matching known English names here would
    // silently merge Available+Source into Version on localized systems.
    let version_end = tokens
        .iter()
        .map(|(offset, _)| *offset)
        .filter(|&offset| offset > version_start)
        .min();

    let mut packages = Vec::new();
    for line in &lines[header_index + 1..] {
        if line.trim().is_empty() {
            continue;
        }
        // Separator row under the header.
        if line.chars().all(|c| c == '-' || c.is_whitespace()) {
            continue;
        }
        let id_raw = slice_display(line, id_start, Some(version_start));
        let id = id_raw.trim();
        // Sanity filters drop, in order: footer lines ("N upgrades
        // available."), rows sheared by a wide-glyph miscount, ids truncated
        // by an attached console (never seen on a pipe), and synthetic
        // non-source identifiers (`MSIX\...`, `ARP\...`) that cannot match a
        // catalog id.
        if id.is_empty()
            || id.contains(char::is_whitespace)
            || id.contains('\u{2026}')
            || id.contains('\\')
        {
            continue;
        }
        // Version is kept verbatim: winget emits opaque strings ("> 1.5.8",
        // "Unknown", "7.1.0 (41345)") that must not be normalized here.
        let version = slice_display(line, version_start, version_end)
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

/// Every whitespace-delimited header token with its *display-cell* start
/// offset. Localized headers can contain non-ASCII ("Verfügbar") or
/// full-width titles, so offsets are accumulated the same way rows are
/// sliced.
fn header_tokens(header: &str) -> Vec<(usize, String)> {
    let mut tokens: Vec<(usize, String)> = Vec::new();
    let mut col = 0usize;
    let mut in_token = false;
    for ch in header.chars() {
        if ch.is_whitespace() {
            in_token = false;
        } else if in_token {
            tokens.last_mut().expect("in_token implies a token").1.push(ch);
        } else {
            tokens.push((col, String::from(ch)));
            in_token = true;
        }
        col += UnicodeWidthChar::width(ch).unwrap_or(0);
    }
    tokens
}

/// Display offset of the header token equal to `name`, ASCII-case-
/// insensitively: some locales only change the casing (German "ID").
fn find_in(tokens: &[(usize, String)], name: &str) -> Option<usize> {
    tokens
        .iter()
        .find(|(_, token)| token.eq_ignore_ascii_case(name))
        .map(|(offset, _)| *offset)
}

fn find_token(header: &str, name: &str) -> Option<usize> {
    find_in(&header_tokens(header), name)
}

/// Slice a row by *display-cell* range `[start, end)`. winget pads columns
/// by display width: a CJK char occupies two cells but one char, so
/// char-offset slicing shears every column to the right of a wide name.
fn slice_display(line: &str, start: usize, end: Option<usize>) -> String {
    let end = end.unwrap_or(usize::MAX);
    let mut col = 0usize;
    let mut out = String::new();
    for ch in line.chars() {
        if col >= end {
            break;
        }
        if col >= start {
            out.push(ch);
        }
        col += UnicodeWidthChar::width(ch).unwrap_or(0);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn display_width(s: &str) -> usize {
        s.chars()
            .map(|c| UnicodeWidthChar::width(c).unwrap_or(0))
            .sum()
    }

    /// Pad to a display-cell width, the way winget pads columns.
    fn pad(s: &str, width: usize) -> String {
        format!("{s}{}", " ".repeat(width.saturating_sub(display_width(s))))
    }

    fn row(name: &str, id: &str, version: &str, available: &str, source: &str) -> String {
        format!(
            "{}{}{}{}{}",
            pad(name, 23),
            pad(id, 27),
            pad(version, 13),
            pad(available, 11),
            source
        )
    }

    fn sample_output() -> String {
        let header = row("Name", "Id", "Version", "Available", "Source");
        let separator = "-".repeat(80);
        [
            // Preamble junk never occurs on a pipe in winget 1.29, but the
            // parser tolerates it for older builds.
            "   - \u{2588}\u{2588}".to_string(),
            String::new(),
            header,
            separator,
            row("7-Zip 24.08 (x64)", "7zip.7zip", "24.08", "", "winget"),
            row("Mozilla Firefox", "Mozilla.Firefox", "141.0", "142.0", "winget"),
            // Truncated id (console-attached behavior): must be dropped.
            row(
                "Some Very Long Name\u{2026}",
                "SomeVendor.SomeAppWith\u{2026}",
                "1.2.3",
                "",
                "winget",
            ),
            // Registry-only entry with no version.
            row("Legacy Thing", "LegacyVendor.Legacy", "", "", ""),
            // Row cut off mid-Version.
            format!("{}{}1.9", pad("Cut Off App", 23), pad("CutOff.App", 27)),
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

    #[test]
    fn slices_by_display_cells_so_wide_names_stay_aligned() {
        // "微信" is 2 chars but 4 display cells: char-offset slicing would
        // shift Id/Version two columns left and corrupt both.
        let table = [
            row("Name", "Id", "Version", "Available", "Source"),
            "-".repeat(80),
            row("微信 WeChat", "Tencent.WeChat", "3.9.12", "", "winget"),
            row("中文Git tools", "Vendor.CjkTool", "1.0", "", "winget"),
        ]
        .join("\n");
        let packages = parse_list(&table);
        assert_eq!(packages.len(), 2);
        assert_eq!(packages[0].id, "Tencent.WeChat");
        assert_eq!(packages[0].version, "3.9.12");
        assert_eq!(packages[1].id, "Vendor.CjkTool");
        assert_eq!(packages[1].version, "1.0");
    }

    #[test]
    fn preserves_opaque_version_strings_verbatim() {
        let table = [
            row("Name", "Id", "Version", "Available", "Source"),
            "-".repeat(80),
            row("Some Runtime", "SomeVendor.Runtime", "> 1.5.8", "", "winget"),
            row("Apex Legends", "ElectronicArts.Apex", "Unknown", "", ""),
        ]
        .join("\n");
        let packages = parse_list(&table);
        assert_eq!(packages[0].version, "> 1.5.8");
        assert_eq!(packages[1].version, "Unknown");
    }

    #[test]
    fn drops_synthetic_msix_and_arp_identifiers() {
        // Real ids observed in the field: backslash-separated MSIX package
        // names and ARP registry paths (the latter also contain spaces).
        let wide_row = |name: &str, id: &str, version: &str| {
            format!("{}{}{}", pad(name, 23), pad(id, 40), version)
        };
        let table = [
            wide_row("Name", "Id", "Version"),
            "-".repeat(80),
            wide_row("Copilot", "MSIX\\Microsoft.Copilot_149.0_x64", "149.0"),
            wide_row("Ori", "ARP\\Machine\\X64\\Steam App 1172470", ""),
            wide_row("Mozilla Firefox", "Mozilla.Firefox", "141.0"),
        ]
        .join("\n");
        let packages = parse_list(&table);
        assert_eq!(packages.len(), 1);
        assert_eq!(packages[0].id, "Mozilla.Firefox");
    }

    #[test]
    fn localized_headers_bound_the_version_column() {
        // German Windows renders the header as Name/ID/Version/Verfügbar/
        // Quelle. "ID" must match case-insensitively, and — the part that
        // once regressed — Version must end at the next *declared* column
        // even though its title isn't the English "Available": otherwise
        // every version string absorbs the Available and Source cells.
        let table = [
            row("Name", "ID", "Version", "Verfügbar", "Quelle"),
            "-".repeat(80),
            row("Mozilla Firefox", "Mozilla.Firefox", "141.0", "142.0", "winget"),
            row("7-Zip 24.08 (x64)", "7zip.7zip", "24.08", "", "winget"),
        ]
        .join("\n");
        let packages = parse_list(&table);
        assert_eq!(packages.len(), 2);
        assert_eq!(packages[0].id, "Mozilla.Firefox");
        assert_eq!(packages[0].version, "141.0");
        assert_eq!(packages[1].version, "24.08");
    }

    #[test]
    fn hresult_constants_round_trip_from_i32_exit_codes() {
        // ExitStatus::code() returns HRESULTs as negative i32 on Windows.
        assert_eq!((-1978335212_i32) as u32, NO_APPLICATIONS_FOUND);
        assert_eq!((-1978335189_i32) as u32, UPDATE_NOT_APPLICABLE);
    }
}
