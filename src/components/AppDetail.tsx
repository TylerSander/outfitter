import { useEffect, useRef, useState } from "react";
import type { CatalogApp } from "../types";
import {
  deriveInstallState,
  installedVersion,
  primarySource,
  useStore,
} from "../store";
import { openExternal } from "../ipc";
import { AppIcon, CommunityBadge } from "./AppCard";
import StateButton from "./StateButton";

export default function AppDetail() {
  const selectedAppId = useStore((s) => s.selectedAppId);
  const catalog = useStore((s) => s.catalog);
  const selectApp = useStore((s) => s.selectApp);

  const open = selectedAppId !== null;

  // Keep the last app mounted during the slide-out transition.
  const [renderedApp, setRenderedApp] = useState<CatalogApp | null>(null);

  useEffect(() => {
    if (selectedAppId !== null && catalog !== null) {
      const app = catalog.apps.find((a) => a.id === selectedAppId);
      if (app !== undefined) setRenderedApp(app);
    }
  }, [selectedAppId, catalog]);

  useEffect(() => {
    if (open) return undefined;
    const t = window.setTimeout(() => setRenderedApp(null), 250);
    return () => window.clearTimeout(t);
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") selectApp(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, selectApp]);

  return (
    <>
      <div
        onClick={() => selectApp(null)}
        aria-hidden="true"
        className={`fixed inset-0 z-30 bg-black/60 backdrop-blur-[2px] transition-opacity duration-200 ${
          open ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
      />
      <aside
        aria-hidden={!open}
        className={`fixed inset-y-0 right-0 z-40 flex w-full max-w-md transform flex-col border-l border-hair-amber/50 bg-ink shadow-2xl shadow-black/60 transition-transform duration-200 ease-out ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
      >
        {renderedApp !== null && (
          <DetailBody app={renderedApp} onClose={() => selectApp(null)} />
        )}
      </aside>
    </>
  );
}

function DetailBody({ app, onClose }: { app: CatalogApp; onClose: () => void }) {
  const catalog = useStore((s) => s.catalog);
  const platform = useStore((s) => s.platform);
  const installed = useStore((s) => s.installed);
  const ops = useStore((s) => s.ops);
  const install = useStore((s) => s.install);
  const uninstall = useStore((s) => s.uninstall);
  const clearOp = useStore((s) => s.clearOp);

  const source = primarySource(app, platform);
  const state = deriveInstallState(app, platform, installed, ops);
  const op = ops.get(app.id);
  const version = installedVersion(app, platform, installed);
  const category = catalog?.categories.find((c) => c.id === app.category);
  const opActive = op !== undefined && op.phase !== "failed";

  const [logOpen, setLogOpen] = useState(true);
  const logRef = useRef<HTMLPreElement | null>(null);

  useEffect(() => {
    const el = logRef.current;
    if (el !== null) el.scrollTop = el.scrollHeight;
  }, [op?.log.length, logOpen]);

  return (
    <>
      {/* header */}
      <header className="flex items-start gap-4 border-b border-hair px-6 py-6">
        <AppIcon app={app} className="h-16 w-16 text-3xl" />
        <div className="min-w-0 flex-1 pt-0.5">
          <h2 className="truncate text-xl font-bold uppercase tracking-[3px] text-paper-hi">
            {app.name}
          </h2>
          <p className="mt-1 text-[10px] uppercase tracking-[3px] text-mute">
            {category !== undefined ? category.name : app.category}
          </p>
          {source !== null && (
            <p className="mt-2.5 flex flex-wrap items-center gap-2 text-[11px] text-mute">
              <span className="truncate">
                via <span className="text-paper">{source.manager}</span>
                <span className="mx-1 text-amber">·</span>
                <span className="font-mono text-paper/80">{source.id}</span>
              </span>
              {!source.official && <CommunityBadge />}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="p-1.5 text-mute transition-colors hover:text-amber-hi"
        >
          <svg
            className="h-4 w-4"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </header>

      {/* body */}
      <div className="flex flex-1 flex-col gap-6 overflow-y-auto px-6 py-6">
        <div className="flex flex-col gap-3">
          <StateButton
            state={state}
            platform={platform}
            failedKind={op?.kind}
            size="lg"
            onInstall={() => void install(app)}
            onUninstall={() => void uninstall(app)}
          />

          {opActive && (
            <div className="h-px w-full overflow-hidden bg-hair">
              <div
                className="h-full bg-amber transition-[width] duration-300"
                style={{ width: `${op.percent ?? 3}%` }}
              />
            </div>
          )}

          {op !== undefined && op.phase === "failed" && (
            <div className="border border-coral/40 bg-coral/5 p-3">
              <div className="flex items-start justify-between gap-3">
                <p className="whitespace-pre-wrap break-words font-serif text-xs italic leading-relaxed text-coral">
                  {op.error ?? "Operation failed."}
                </p>
                <button
                  type="button"
                  onClick={() => clearOp(app.id)}
                  className="shrink-0 text-[9.5px] uppercase tracking-[2px] text-coral/80 transition-colors hover:text-paper-hi"
                >
                  Dismiss
                </button>
              </div>
            </div>
          )}

          {version !== null && (
            <p className="text-[10px] uppercase tracking-[2px] text-mute">
              Installed{" "}
              <span className="ml-1 font-mono normal-case tracking-normal text-paper/80">
                {version}
              </span>
            </p>
          )}
          {source?.note !== undefined && (
            <p className="font-serif text-[11.5px] italic leading-relaxed text-mute">
              {source.note}
            </p>
          )}
        </div>

        {/* live log */}
        {op !== undefined && (
          <section className="overflow-hidden border border-hair">
            <button
              type="button"
              onClick={() => setLogOpen((v) => !v)}
              className="flex w-full items-center justify-between px-3 py-2 text-[10px] uppercase tracking-[3px] text-mute transition-colors hover:text-paper"
            >
              <span>Activity log</span>
              <svg
                className={`h-3 w-3 transition-transform ${logOpen ? "rotate-180" : ""}`}
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="m6 9 6 6 6-6" />
              </svg>
            </button>
            {logOpen && (
              <pre
                ref={logRef}
                className="max-h-56 select-text overflow-y-auto whitespace-pre-wrap break-words border-t border-hair px-3 py-2 font-mono text-[11px] leading-relaxed text-mute"
              >
                {op.log.length > 0 ? op.log.join("\n") : "Waiting for output…"}
              </pre>
            )}
          </section>
        )}

        {/* description */}
        <div className="flex flex-col gap-3">
          {app.description.split(/\n{2,}/).map((para, i) => (
            <p key={i} className="font-serif text-[13.5px] italic leading-[1.7] text-paper/90">
              {para}
            </p>
          ))}
        </div>

        {/* tags */}
        {app.tags.length > 0 && (
          <div className="flex flex-wrap gap-x-4 gap-y-1.5">
            {app.tags.map((tag) => (
              <span
                key={tag}
                className="text-[9.5px] uppercase tracking-[2.5px] text-mute before:mr-1.5 before:text-amber before:content-['·']"
              >
                {tag}
              </span>
            ))}
          </div>
        )}

        {/* meta */}
        <dl className="mt-auto grid grid-cols-2 gap-x-4 gap-y-3 border-t border-hair pt-4">
          <div>
            <dt className="text-[9.5px] uppercase tracking-[3px] text-mute">License</dt>
            <dd className="mt-1 text-xs text-paper">{app.license}</dd>
          </div>
          <div>
            <dt className="text-[9.5px] uppercase tracking-[3px] text-mute">Homepage</dt>
            <dd className="mt-1">
              <button
                type="button"
                onClick={() => void openExternal(app.homepage)}
                className="inline-flex max-w-full items-center gap-1 border-b border-hair-amber pb-px text-xs text-amber transition-colors hover:border-amber-hi hover:text-amber-hi"
              >
                <span className="truncate">{hostFor(app.homepage)}</span>
                <svg
                  className="h-3 w-3 shrink-0"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M7 17 17 7M9 7h8v8" />
                </svg>
              </button>
            </dd>
          </div>
        </dl>
      </div>
    </>
  );
}

function hostFor(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}
