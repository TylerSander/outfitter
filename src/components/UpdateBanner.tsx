import { useEffect, useRef, useState } from "react";
import { useStore } from "../store";
import { checkForUpdate, relaunchApp, type AvailableUpdate } from "../update";

type Phase =
  | { kind: "hidden" }
  | { kind: "available"; version: string }
  | { kind: "downloading"; percent: number | null }
  // Windows only: the updater exits the app itself during this phase — the
  // install() promise never resolves there (documented Windows limitation).
  | { kind: "installing" }
  // macOS/Linux only: update staged, restart when the user chooses.
  | { kind: "ready"; version: string }
  | { kind: "error"; message: string };

const FIRST_CHECK_MS = 5_000; // let startup detection finish first
const RECHECK_MS = 4 * 60 * 60 * 1000;

export default function UpdateBanner() {
  const platform = useStore((s) => s.platform);
  const ops = useStore((s) => s.ops);
  const [phase, setPhase] = useState<Phase>({ kind: "hidden" });
  const updateRef = useRef<AvailableUpdate | null>(null);
  const dismissedRef = useRef<string | null>(null);
  // True from the moment a download starts. Freezes re-checks so a staged or
  // in-flight update is never downgraded back to "available" (which would
  // re-download it), even after the banner is hidden.
  const busyRef = useRef(false);

  // Applying an update must not sever running package operations: on Windows
  // the updater exits the app mid-operation; on macOS/Linux the restart does.
  const opsBusy = [...ops.values()].some(
    (op) => op.phase !== "done" && op.phase !== "failed",
  );

  useEffect(() => {
    let cancelled = false;
    const look = async () => {
      if (busyRef.current) return;
      try {
        const update = await checkForUpdate();
        if (cancelled || busyRef.current || update === null) return;
        if (dismissedRef.current === update.version) return;
        updateRef.current = update;
        setPhase({ kind: "available", version: update.version });
      } catch {
        // Offline or the release feed is unreachable; retry on the next tick.
      }
    };
    const first = setTimeout(look, FIRST_CHECK_MS);
    const every = setInterval(look, RECHECK_MS);
    return () => {
      cancelled = true;
      clearTimeout(first);
      clearInterval(every);
    };
  }, []);

  const startInstall = async () => {
    const update = updateRef.current;
    if (update === null || busyRef.current) return;
    busyRef.current = true;
    setPhase({ kind: "downloading", percent: null });
    try {
      await update.install((percent) => {
        setPhase(
          percent === 100 && platform === "windows"
            ? { kind: "installing" }
            : { kind: "downloading", percent },
        );
      });
      // Unreachable on Windows: the updater exits the app during install.
      setPhase({ kind: "ready", version: update.version });
    } catch (e) {
      busyRef.current = false;
      setPhase({ kind: "error", message: e instanceof Error ? e.message : String(e) });
    }
  };

  if (phase.kind === "hidden") return null;

  return (
    // Bottom-LEFT deliberately: the AppDetail slide-over owns the right edge,
    // and an opaque card there would cover its bottom controls.
    <div className="fixed bottom-4 left-4 z-40 w-80 rounded-xl border border-slate-700/80 bg-slate-900 p-4 shadow-2xl shadow-black/40">
      {phase.kind === "available" && (
        <>
          <p className="text-sm font-semibold text-slate-100">
            Outfitter {phase.version} is available
          </p>
          <p className="mt-1 text-xs leading-relaxed text-slate-400">
            {platform === "windows"
              ? "Outfitter will close, apply the update, and reopen."
              : "Downloads in the background — you choose when to restart."}
          </p>
          {platform === "windows" && opsBusy ? (
            <p className="mt-3 text-xs font-medium text-amber-400/90">
              Waiting for package operations to finish…
            </p>
          ) : (
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={() => void startInstall()}
                className="rounded-lg bg-sky-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-sky-500"
              >
                Install update
              </button>
              <button
                type="button"
                onClick={() => {
                  dismissedRef.current = phase.version;
                  setPhase({ kind: "hidden" });
                }}
                className="rounded-lg px-3 py-1.5 text-xs font-medium text-slate-400 transition-colors hover:text-slate-200"
              >
                Later
              </button>
            </div>
          )}
        </>
      )}

      {phase.kind === "downloading" && (
        <>
          <p className="text-sm font-semibold text-slate-100">Downloading update…</p>
          <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
            {phase.percent === null ? (
              <div className="h-full w-1/3 animate-pulse rounded-full bg-sky-600" />
            ) : (
              <div
                className="h-full rounded-full bg-sky-600 transition-[width]"
                style={{ width: `${phase.percent}%` }}
              />
            )}
          </div>
          {phase.percent !== null && (
            <p className="mt-1.5 text-right text-[11px] tabular-nums text-slate-500">
              {phase.percent}%
            </p>
          )}
        </>
      )}

      {phase.kind === "installing" && (
        <>
          <p className="text-sm font-semibold text-slate-100">Installing update…</p>
          <p className="mt-1 text-xs leading-relaxed text-slate-400">
            Outfitter will close and reopen itself.
          </p>
          <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
            <div className="h-full w-full animate-pulse rounded-full bg-sky-600" />
          </div>
        </>
      )}

      {phase.kind === "ready" && (
        <>
          <p className="text-sm font-semibold text-slate-100">
            Ready to update to {phase.version}
          </p>
          <p className="mt-1 text-xs leading-relaxed text-slate-400">
            The update installs when Outfitter restarts.
          </p>
          <div className="mt-3 flex gap-2">
            {opsBusy ? (
              <p className="text-xs font-medium text-amber-400/90">
                Waiting for package operations to finish…
              </p>
            ) : (
              <button
                type="button"
                onClick={() => void relaunchApp()}
                className="rounded-lg bg-sky-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-sky-500"
              >
                Restart now
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                dismissedRef.current = phase.version;
                setPhase({ kind: "hidden" });
              }}
              className="rounded-lg px-3 py-1.5 text-xs font-medium text-slate-400 transition-colors hover:text-slate-200"
            >
              On next launch
            </button>
          </div>
        </>
      )}

      {phase.kind === "error" && (
        <>
          <p className="text-sm font-semibold text-red-400">Update failed</p>
          <p className="mt-1 break-words text-xs leading-relaxed text-slate-400">
            {phase.message}
          </p>
          <button
            type="button"
            onClick={() => setPhase({ kind: "hidden" })}
            className="mt-3 rounded-lg px-3 py-1.5 text-xs font-medium text-slate-400 transition-colors hover:text-slate-200"
          >
            Dismiss
          </button>
        </>
      )}
    </div>
  );
}
