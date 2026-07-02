//! Operation queue.
//!
//! One worker thread per manager name: operations on the same manager run
//! strictly serially (package managers hold global locks), while different
//! managers may run concurrently. Progress reporting is event-based over the
//! "op-event" channel.
//!
//! PROGRESS UPGRADE PLAN: real ops currently emit no `percent` (the UI shows
//! an indeterminate spinner). winget and flatpak only report percentages on
//! a tty / via OSC "9;4" progress sequences, so the planned upgrade is to run
//! children under a PTY and parse OSC 9;4 (and carriage-return progress bars)
//! into `phase: "progress"` events.
//!
//! WINDOWS ELEVATION: Outfitter never runs elevated. Machine-scope installs
//! are fine — winget raises the UAC prompt itself — but a `--silent` MSI
//! UNinstall of a per-machine package fails with MsiExec 1603 / winget
//! 0x8A150030 instead of prompting (observed live: VLC, 2026-07-02). For that
//! exact failure the job is retried once through PowerShell Start-Process
//! -Verb RunAs, which surfaces the standard Windows permission prompt. The
//! elevated child cannot pipe output back to this unelevated process, so the
//! retry reports only its exit code.

use std::collections::{HashMap, VecDeque};
use std::io::{BufRead, BufReader, Read};
use std::process::{Command, Stdio};
use std::sync::mpsc::{self, Sender};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::{AppHandle, Emitter};

use crate::providers;

const EVENT_CHANNEL: &str = "op-event";
const MAX_LOG_LINES_PER_SEC: u32 = 30;
/// How many trailing output lines are kept for failure messages.
const TAIL_LINES: usize = 8;
/// APPINSTALLER_CLI_ERROR_EXEC_UNINSTALL_COMMAND_FAILED — winget's exit code
/// when the package's uninstaller itself failed (e.g. MsiExec 1603 because a
/// per-machine MSI needs administrator rights).
#[cfg(windows)]
const WINGET_UNINSTALL_FAILED: u32 = 0x8A15_0030;
/// ERROR_CANCELLED — the user declined the Windows permission prompt.
#[cfg(windows)]
const ELEVATION_DECLINED: i32 = 1223;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum OpKind {
    Install,
    Uninstall,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpEvent {
    pub app_id: String,
    pub kind: OpKind,
    pub phase: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub line: Option<String>,
    /// Reserved for the PTY/OSC 9;4 upgrade; never `Some` in the MVP.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub percent: Option<u8>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

impl OpEvent {
    fn new(app_id: &str, kind: OpKind, phase: &'static str) -> Self {
        Self {
            app_id: app_id.to_string(),
            kind,
            phase,
            line: None,
            percent: None,
            error: None,
        }
    }
}

pub struct Job {
    pub app_id: String,
    pub kind: OpKind,
    pub manager: String,
    pub package_id: String,
}

/// A finished-but-unsuccessful child process: exit code (when the process
/// exited normally) plus a human-readable message with the output tail.
/// The code only drives the Windows elevation rescue today, but stays
/// cross-platform (and unit-tested everywhere) per house convention.
struct RunFailure {
    #[cfg_attr(not(windows), allow(dead_code))]
    code: Option<i32>,
    message: String,
}

impl RunFailure {
    fn spawn(message: String) -> Self {
        Self {
            code: None,
            message,
        }
    }

    #[cfg_attr(not(windows), allow(dead_code))]
    fn code_u32(&self) -> Option<u32> {
        self.code.map(|c| c as u32)
    }
}

#[derive(Default)]
pub struct OpsState {
    workers: Mutex<HashMap<String, Sender<Job>>>,
}

impl OpsState {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn enqueue(&self, app: &AppHandle, mut job: Job) -> Result<(), String> {
        emit(app, &OpEvent::new(&job.app_id, job.kind, "queued"));
        let mut workers = self
            .workers
            .lock()
            .map_err(|_| "operation queue lock poisoned".to_string())?;
        if let Some(tx) = workers.get(&job.manager) {
            match tx.send(job) {
                Ok(()) => return Ok(()),
                // Worker thread is gone (panicked); rebuild it below.
                Err(mpsc::SendError(returned)) => job = returned,
            }
        }
        let manager = job.manager.clone();
        let (tx, rx) = mpsc::channel::<Job>();
        let handle = app.clone();
        thread::spawn(move || {
            while let Ok(next) = rx.recv() {
                run_job(&handle, &next);
            }
        });
        tx.send(job)
            .map_err(|_| "failed to hand job to worker thread".to_string())?;
        workers.insert(manager, tx);
        Ok(())
    }
}

fn run_job(app: &AppHandle, job: &Job) {
    emit(app, &OpEvent::new(&job.app_id, job.kind, "started"));
    let Some(provider) = providers::by_name(&job.manager) else {
        fail(app, job, format!("no provider for manager '{}'", job.manager));
        return;
    };
    if job.kind == OpKind::Install {
        if let Some(pre) = provider.pre_install_args() {
            if let Err(e) = run_streamed(app, job, &pre) {
                fail(app, job, e.message);
                return;
            }
        }
    }
    let argv = match job.kind {
        OpKind::Install => provider.install_args(&job.package_id),
        OpKind::Uninstall => provider.uninstall_args(&job.package_id),
    };
    match run_streamed(app, job, &argv) {
        Ok(()) => finish(app, job, provider),
        Err(failure) => {
            if let Some(result) = elevation_rescue(app, job, &argv, &failure) {
                match result {
                    Ok(()) => finish(app, job, provider),
                    Err(e) => fail(app, job, e),
                }
            } else {
                fail(app, job, failure.message);
            }
        }
    }
}

fn finish(app: &AppHandle, job: &Job, provider: &'static dyn providers::Provider) {
    if job.kind == OpKind::Install {
        launch_after_install(app, job, provider);
    }
    emit(app, &OpEvent::new(&job.app_id, job.kind, "done"));
}

/// Windows-only: a winget uninstall that failed because the package's
/// uninstaller needs administrator rights is retried once elevated, which
/// shows the standard Windows permission prompt. Returns None when the
/// failure is not that case (all other platforms and errors).
#[cfg(windows)]
fn elevation_rescue(
    app: &AppHandle,
    job: &Job,
    argv: &[String],
    failure: &RunFailure,
) -> Option<Result<(), String>> {
    if job.manager != "winget"
        || job.kind != OpKind::Uninstall
        || failure.code_u32() != Some(WINGET_UNINSTALL_FAILED)
    {
        return None;
    }
    log_line(
        app,
        job,
        "This app is installed for all users — Windows needs administrator permission to remove it.",
    );
    log_line(app, job, "Approve the Windows permission prompt to continue…");
    Some(run_elevated(argv).map_err(|e| match e {
        ElevatedError::Declined => {
            "Administrator permission was declined, so the app was not removed.".to_string()
        }
        ElevatedError::Failed(detail) => format!(
            "The uninstaller failed even with administrator permission: {detail}"
        ),
    }))
}

#[cfg(not(windows))]
fn elevation_rescue(
    _app: &AppHandle,
    _job: &Job,
    _argv: &[String],
    _failure: &RunFailure,
) -> Option<Result<(), String>> {
    None
}

#[cfg(windows)]
enum ElevatedError {
    Declined,
    Failed(String),
}

/// Re-run argv elevated via PowerShell Start-Process -Verb RunAs. The
/// elevated child cannot stream into this unelevated process; only the exit
/// code comes back. A declined UAC prompt maps to ERROR_CANCELLED (1223).
#[cfg(windows)]
fn run_elevated(argv: &[String]) -> Result<(), ElevatedError> {
    let script =
        elevated_script(argv).ok_or_else(|| ElevatedError::Failed("empty command".into()))?;
    let mut cmd = Command::new("powershell");
    cmd.args(["-NoProfile", "-NonInteractive", "-Command", &script])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    providers::configure_command(&mut cmd);
    let status = cmd
        .status()
        .map_err(|e| ElevatedError::Failed(format!("failed to start PowerShell: {e}")))?;
    match status.code() {
        Some(0) => Ok(()),
        Some(ELEVATION_DECLINED) => Err(ElevatedError::Declined),
        Some(code) => Err(ElevatedError::Failed(format!(
            "exit code 0x{:08X}",
            code as u32
        ))),
        None => Err(ElevatedError::Failed("terminated by signal".into())),
    }
}

/// PowerShell one-liner: run argv elevated, hidden, and propagate the child's
/// exit code; a thrown Start-Process (user declined the prompt) maps to 1223.
/// Single-quoted PowerShell strings escape quotes by doubling them.
#[cfg_attr(not(windows), allow(dead_code))]
fn elevated_script(argv: &[String]) -> Option<String> {
    let (program, args) = argv.split_first()?;
    let quote = |s: &str| format!("'{}'", s.replace('\'', "''"));
    let arg_list = args.iter().map(|a| quote(a)).collect::<Vec<_>>().join(",");
    let arg_clause = if args.is_empty() {
        String::new()
    } else {
        format!(" -ArgumentList @({arg_list})")
    };
    Some(format!(
        "try {{ $p = Start-Process -FilePath {}{} -Verb RunAs -Wait -PassThru -WindowStyle Hidden; exit $p.ExitCode }} catch {{ exit 1223 }}",
        quote(program),
        arg_clause,
    ))
}

/// After a successful install the app opens immediately, so the user lands in
/// what they just installed. Emitted as a log line BEFORE "done" so frontend
/// op cleanup cannot miss it.
fn launch_after_install(app: &AppHandle, job: &Job, provider: &'static dyn providers::Provider) {
    let mut event = OpEvent::new(&job.app_id, job.kind, "log");
    event.line = Some(match provider.launch(&job.package_id) {
        Ok(true) => "Installed — launching now…".to_string(),
        Ok(false) => "Installed. Find it in your applications menu.".to_string(),
        Err(e) => format!("Installed, but couldn't auto-launch: {e}"),
    });
    emit(app, &event);
}

#[cfg_attr(not(windows), allow(dead_code))]
fn log_line(app: &AppHandle, job: &Job, line: &str) {
    let mut event = OpEvent::new(&job.app_id, job.kind, "log");
    event.line = Some(line.to_string());
    emit(app, &event);
}

/// Spawn argv, stream stdout+stderr as throttled log events, wait for exit.
fn run_streamed(app: &AppHandle, job: &Job, argv: &[String]) -> Result<(), RunFailure> {
    let (program, args) = argv
        .split_first()
        .ok_or_else(|| RunFailure::spawn("empty command".to_string()))?;
    let mut cmd = Command::new(program);
    cmd.args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    providers::configure_command(&mut cmd);
    let mut child = cmd
        .spawn()
        .map_err(|e| RunFailure::spawn(format!("failed to start {program}: {e}")))?;

    let throttle = Arc::new(Mutex::new(LogThrottle::new()));
    let tail = Arc::new(Mutex::new(VecDeque::with_capacity(TAIL_LINES)));

    let stderr_reader = child.stderr.take().map(|stderr| {
        let app = app.clone();
        let app_id = job.app_id.clone();
        let kind = job.kind;
        let throttle = Arc::clone(&throttle);
        let tail = Arc::clone(&tail);
        thread::spawn(move || stream_lines(&app, &app_id, kind, stderr, &throttle, &tail))
    });
    if let Some(stdout) = child.stdout.take() {
        stream_lines(app, &job.app_id, job.kind, stdout, &throttle, &tail);
    }
    if let Some(handle) = stderr_reader {
        let _ = handle.join();
    }

    let status = child
        .wait()
        .map_err(|e| RunFailure::spawn(format!("failed to wait for {program}: {e}")))?;
    if status.success() {
        Ok(())
    } else {
        let tail_lines: Vec<String> = tail
            .lock()
            .map(|t| t.iter().cloned().collect())
            .unwrap_or_default();
        // HRESULT-style codes (winget) read far better in hex.
        let shown = match status.code() {
            Some(code) if (code as u32) > 0xFFFF => format!("exit code 0x{:08X}", code as u32),
            Some(code) => format!("exit code {code}"),
            None => status.to_string(),
        };
        let mut msg = format!("{program} failed with {shown}");
        if !tail_lines.is_empty() {
            msg.push_str(":\n");
            msg.push_str(&tail_lines.join("\n"));
        }
        Err(RunFailure {
            code: status.code(),
            message: msg,
        })
    }
}

fn stream_lines<R: Read>(
    app: &AppHandle,
    app_id: &str,
    kind: OpKind,
    reader: R,
    throttle: &Mutex<LogThrottle>,
    tail: &Mutex<VecDeque<String>>,
) {
    for line in BufReader::new(reader).lines() {
        let Ok(line) = line else { break };
        // Keep only what a terminal would show after in-place CR updates.
        let line = visible_tail(&line).trim_end().to_string();
        if line.trim().is_empty() {
            continue;
        }
        if let Ok(mut t) = tail.lock() {
            if t.len() == TAIL_LINES {
                t.pop_front();
            }
            t.push_back(line.clone());
        }
        let allowed = throttle.lock().map(|mut t| t.allow()).unwrap_or(true);
        if allowed {
            let mut event = OpEvent::new(app_id, kind, "log");
            event.line = Some(line);
            emit(app, &event);
        }
    }
}

fn visible_tail(line: &str) -> &str {
    line.rsplit('\r').next().unwrap_or(line)
}

/// Simple fixed-window rate limiter: at most `MAX_LOG_LINES_PER_SEC` log
/// events per second; excess lines are dropped from the event stream (they
/// still land in the failure tail buffer).
struct LogThrottle {
    window_start: Instant,
    emitted: u32,
}

impl LogThrottle {
    fn new() -> Self {
        Self {
            window_start: Instant::now(),
            emitted: 0,
        }
    }

    fn allow(&mut self) -> bool {
        let now = Instant::now();
        if now.duration_since(self.window_start) >= Duration::from_secs(1) {
            self.window_start = now;
            self.emitted = 0;
        }
        if self.emitted < MAX_LOG_LINES_PER_SEC {
            self.emitted += 1;
            true
        } else {
            false
        }
    }
}

fn fail(app: &AppHandle, job: &Job, error: String) {
    let mut event = OpEvent::new(&job.app_id, job.kind, "failed");
    event.error = Some(error);
    emit(app, &event);
}

fn emit(app: &AppHandle, event: &OpEvent) {
    // Nothing sensible to do if the webview is gone; drop the event.
    let _ = app.emit(EVENT_CHANNEL, event.clone());
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn throttle_allows_at_most_max_lines_per_window() {
        let mut throttle = LogThrottle::new();
        let allowed = (0..100).filter(|_| throttle.allow()).count();
        assert_eq!(allowed as u32, MAX_LOG_LINES_PER_SEC);
    }

    #[test]
    fn visible_tail_takes_text_after_last_carriage_return() {
        assert_eq!(visible_tail("plain line"), "plain line");
        assert_eq!(visible_tail("25%\r50%\r100% done"), "100% done");
    }

    #[test]
    fn op_event_serializes_to_the_pinned_contract() {
        let mut event = OpEvent::new("firefox", OpKind::Install, "log");
        event.line = Some("hello".to_string());
        let json = serde_json::to_value(&event).expect("serializable");
        assert_eq!(json["appId"], "firefox");
        assert_eq!(json["kind"], "install");
        assert_eq!(json["phase"], "log");
        assert_eq!(json["line"], "hello");
        assert!(json.get("percent").is_none());
        assert!(json.get("error").is_none());
    }

    #[test]
    fn elevated_script_quotes_and_propagates_exit_code() {
        let argv = vec![
            "winget".to_string(),
            "uninstall".to_string(),
            "--id".to_string(),
            "VideoLAN.VLC".to_string(),
        ];
        let script = elevated_script(&argv).expect("script");
        assert!(script.contains("Start-Process -FilePath 'winget'"));
        assert!(script.contains("-ArgumentList @('uninstall','--id','VideoLAN.VLC')"));
        assert!(script.contains("-Verb RunAs -Wait -PassThru"));
        assert!(script.contains("exit $p.ExitCode"));
        assert!(script.contains("catch { exit 1223 }"));
    }

    #[test]
    fn elevated_script_escapes_single_quotes() {
        let argv = vec!["prog".to_string(), "it's".to_string()];
        let script = elevated_script(&argv).expect("script");
        assert!(script.contains("'it''s'"));
    }

    #[test]
    fn elevated_script_handles_no_args() {
        let argv = vec!["prog".to_string()];
        let script = elevated_script(&argv).expect("script");
        assert!(!script.contains("-ArgumentList"));
        assert!(elevated_script(&[]).is_none());
    }

    #[test]
    fn run_failure_code_round_trips_as_u32() {
        let failure = RunFailure {
            code: Some(-1978335184_i32), // 0x8A150030 as i32
            message: String::new(),
        };
        assert_eq!(failure.code_u32(), Some(0x8A15_0030));
    }
}
