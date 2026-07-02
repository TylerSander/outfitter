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
    <div className="fixed bottom-4 left-4 z-40 w-80 border border-hair-amber/60 bg-ink p-4 shadow-2xl shadow-black/60">
      {phase.kind === "available" && (
        <>
          <p className="text-[11px] font-bold uppercase tracking-[3px] text-paper-hi">
            Outfitter {phase.version} <span className="text-amber">available</span>
          </p>
          <p className="mt-1.5 font-serif text-xs italic leading-relaxed text-mute">
            {platform === "windows"
              ? "Outfitter will close, apply the update, and reopen."
              : "Downloads in the background — you choose when to restart."}
          </p>
          {platform === "windows" && opsBusy ? (
            <p className="obs-pulse mt-3 text-[10px] uppercase tracking-[2px] text-amber">
              Waiting for package operations…
            </p>
          ) : (
            <div className="mt-3.5 flex gap-5">
              <button
                type="button"
                onClick={() => void startInstall()}
                className="border-b border-hair-amber pb-1 text-[10.5px] uppercase tracking-[3px] text-amber transition-all hover:border-amber-hi hover:tracking-[4px] hover:text-amber-hi"
              >
                Install update
              </button>
              <button
                type="button"
                onClick={() => {
                  dismissedRef.current = phase.version;
                  setPhase({ kind: "hidden" });
                }}
                className="border-b border-transparent pb-1 text-[10.5px] uppercase tracking-[3px] text-mute transition-colors hover:text-paper"
              >
                Later
              </button>
            </div>
          )}
        </>
      )}

      {phase.kind === "downloading" && (
        <>
          <p className="text-[11px] font-bold uppercase tracking-[3px] text-paper-hi">
            Downloading update
          </p>
          <div className="mt-3.5 h-px w-full overflow-hidden bg-hair">
            {phase.percent === null ? (
              <div className="obs-pulse h-full w-1/3 bg-amber" />
            ) : (
              <div
                className="h-full bg-amber transition-[width]"
                style={{ width: `${phase.percent}%` }}
              />
            )}
          </div>
          {phase.percent !== null && (
            <p className="mt-2 text-right font-mono text-[11px] tracking-[2px] text-amber">
              {String(phase.percent).padStart(3, "0")}%
            </p>
          )}
        </>
      )}

      {phase.kind === "installing" && (
        <>
          <p className="text-[11px] font-bold uppercase tracking-[3px] text-paper-hi">
            Installing update
          </p>
          <p className="mt-1.5 font-serif text-xs italic leading-relaxed text-mute">
            Outfitter will close and reopen itself.
          </p>
          <div className="mt-3.5 h-px w-full overflow-hidden bg-hair">
            <div className="obs-pulse h-full w-full bg-amber" />
          </div>
        </>
      )}

      {phase.kind === "ready" && (
        <>
          <p className="text-[11px] font-bold uppercase tracking-[3px] text-paper-hi">
            Ready to update to {phase.version}
          </p>
          <p className="mt-1.5 font-serif text-xs italic leading-relaxed text-mute">
            The update installs when Outfitter restarts.
          </p>
          <div className="mt-3.5 flex gap-5">
            {opsBusy ? (
              <p className="obs-pulse text-[10px] uppercase tracking-[2px] text-amber">
                Waiting for package operations…
              </p>
            ) : (
              <button
                type="button"
                onClick={() => void relaunchApp()}
                className="border-b border-hair-amber pb-1 text-[10.5px] uppercase tracking-[3px] text-amber transition-all hover:border-amber-hi hover:tracking-[4px] hover:text-amber-hi"
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
              className="border-b border-transparent pb-1 text-[10.5px] uppercase tracking-[3px] text-mute transition-colors hover:text-paper"
            >
              On next launch
            </button>
          </div>
        </>
      )}

      {phase.kind === "error" && (
        <>
          <p className="text-[11px] font-bold uppercase tracking-[3px] text-coral">
            Update failed
          </p>
          <p className="mt-1.5 break-words font-serif text-xs italic leading-relaxed text-mute">
            {phase.message}
          </p>
          <button
            type="button"
            onClick={() => setPhase({ kind: "hidden" })}
            className="mt-3.5 border-b border-transparent pb-1 text-[10.5px] uppercase tracking-[3px] text-mute transition-colors hover:text-paper"
          >
            Dismiss
          </button>
        </>
      )}
    </div>
  );
}
