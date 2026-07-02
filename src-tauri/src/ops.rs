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
                fail(app, job, e);
                return;
            }
        }
    }
    let argv = match job.kind {
        OpKind::Install => provider.install_args(&job.package_id),
        OpKind::Uninstall => provider.uninstall_args(&job.package_id),
    };
    match run_streamed(app, job, &argv) {
        Ok(()) => emit(app, &OpEvent::new(&job.app_id, job.kind, "done")),
        Err(e) => fail(app, job, e),
    }
}

/// Spawn argv, stream stdout+stderr as throttled log events, wait for exit.
fn run_streamed(app: &AppHandle, job: &Job, argv: &[String]) -> Result<(), String> {
    let (program, args) = argv
        .split_first()
        .ok_or_else(|| "empty command".to_string())?;
    let mut cmd = Command::new(program);
    cmd.args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    providers::configure_command(&mut cmd);
    let mut child = cmd
        .spawn()
        .map_err(|e| format!("failed to start {program}: {e}"))?;

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
        .map_err(|e| format!("failed to wait for {program}: {e}"))?;
    if status.success() {
        Ok(())
    } else {
        let tail_lines: Vec<String> = tail
            .lock()
            .map(|t| t.iter().cloned().collect())
            .unwrap_or_default();
        let mut msg = format!("{program} exited with {status}");
        if !tail_lines.is_empty() {
            msg.push_str(":\n");
            msg.push_str(&tail_lines.join("\n"));
        }
        Err(msg)
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
}
