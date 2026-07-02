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
        className={`fixed inset-0 z-30 bg-black/50 backdrop-blur-[2px] transition-opacity duration-200 ${
          open ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
      />
      <aside
        aria-hidden={!open}
        className={`fixed inset-y-0 right-0 z-40 flex w-full max-w-md transform flex-col border-l border-slate-800 bg-slate-950 shadow-2xl transition-transform duration-200 ease-out ${
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
      <header className="flex items-start gap-4 border-b border-slate-800/80 px-5 py-5">
        <AppIcon app={app} className="h-16 w-16 text-2xl" />
        <div className="min-w-0 flex-1 pt-0.5">
          <h2 className="truncate text-lg font-semibold text-slate-100">{app.name}</h2>
          <p className="mt-0.5 text-xs text-slate-500">
            {category !== undefined ? category.name : app.category}
          </p>
          {source !== null && (
            <p className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
              <span className="truncate">
                via <span className="text-slate-400">{source.manager}</span> ·{" "}
                <span className="font-mono text-slate-400">{source.id}</span>
              </span>
              {!source.official && <CommunityBadge />}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="rounded-lg p-1.5 text-slate-500 transition-colors hover:bg-slate-900 hover:text-slate-200"
        >
          <svg
            className="h-4 w-4"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </header>

      {/* body */}
      <div className="flex flex-1 flex-col gap-5 overflow-y-auto px-5 py-5">
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
            <div className="h-1 w-full overflow-hidden rounded-full bg-slate-800">
              <div
                className="h-full rounded-full bg-sky-500 transition-[width] duration-300"
                style={{ width: `${op.percent ?? 3}%` }}
              />
            </div>
          )}

          {op !== undefined && op.phase === "failed" && (
            <div className="rounded-lg border border-red-900/60 bg-red-950/40 p-3">
              <div className="flex items-start justify-between gap-3">
                <p className="whitespace-pre-wrap break-words text-xs leading-relaxed text-red-300">
                  {op.error ?? "Operation failed."}
                </p>
                <button
                  type="button"
                  onClick={() => clearOp(app.id)}
                  className="shrink-0 text-[11px] font-medium text-red-400/80 transition-colors hover:text-red-300"
                >
                  Dismiss
                </button>
              </div>
            </div>
          )}

          {version !== null && (
            <p className="text-[11px] text-slate-500">
              Installed version <span className="font-mono text-slate-400">{version}</span>
            </p>
          )}
          {source?.note !== undefined && (
            <p className="text-[11px] italic text-slate-500">{source.note}</p>
          )}
        </div>

        {/* live log */}
        {op !== undefined && (
          <section className="overflow-hidden rounded-lg border border-slate-800 bg-slate-900/60">
            <button
              type="button"
              onClick={() => setLogOpen((v) => !v)}
              className="flex w-full items-center justify-between px-3 py-2 text-xs font-medium text-slate-400 transition-colors hover:text-slate-200"
            >
              <span>Activity log</span>
              <svg
                className={`h-3.5 w-3.5 transition-transform ${logOpen ? "rotate-180" : ""}`}
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
                className="max-h-56 select-text overflow-y-auto whitespace-pre-wrap break-words border-t border-slate-800 px-3 py-2 font-mono text-[11px] leading-relaxed text-slate-400"
              >
                {op.log.length > 0 ? op.log.join("\n") : "Waiting for output…"}
              </pre>
            )}
          </section>
        )}

        {/* description */}
        <div className="flex flex-col gap-3">
          {app.description.split(/\n{2,}/).map((para, i) => (
            <p key={i} className="text-sm leading-relaxed text-slate-300">
              {para}
            </p>
          ))}
        </div>

        {/* tags */}
        {app.tags.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {app.tags.map((tag) => (
              <span
                key={tag}
                className="rounded-full bg-slate-900 px-2 py-0.5 text-[11px] text-slate-400 ring-1 ring-inset ring-slate-800"
              >
                {tag}
              </span>
            ))}
          </div>
        )}

        {/* meta */}
        <dl className="mt-auto grid grid-cols-2 gap-x-4 gap-y-3 border-t border-slate-800/80 pt-4 text-xs">
          <div>
            <dt className="text-slate-500">License</dt>
            <dd className="mt-0.5 text-slate-300">{app.license}</dd>
          </div>
          <div>
            <dt className="text-slate-500">Homepage</dt>
            <dd className="mt-0.5">
              <button
                type="button"
                onClick={() => void openExternal(app.homepage)}
                className="inline-flex max-w-full items-center gap-1 text-sky-400 transition-colors hover:text-sky-300"
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
