import { useState } from "react";
import type { CatalogApp } from "../types";
import { deriveInstallState, primarySource, useStore } from "../store";
import StateButton from "./StateButton";

// ---- icon tile (shared with AppDetail) --------------------------------------
// Real logo PNGs live in public/icons/<id>.png. Until one loads, show a quiet
// instrument tile: hairline border, serif-italic initial in amber.

export function AppIcon({
  app,
  className = "h-12 w-12 text-xl",
}: {
  app: CatalogApp;
  className?: string;
}) {
  const [status, setStatus] = useState<"loading" | "ok" | "error">("loading");

  return (
    <div
      className={`relative flex shrink-0 select-none items-center justify-center overflow-hidden rounded-sm border border-hair bg-ink-2 font-serif italic text-amber ${className}`}
      aria-hidden="true"
    >
      <span>{app.name.charAt(0).toUpperCase()}</span>
      {status !== "error" && (
        <img
          src={app.icon}
          alt=""
          loading="lazy"
          onLoad={() => setStatus("ok")}
          onError={() => setStatus("error")}
          className={`absolute inset-0 h-full w-full bg-ink-2 object-contain p-1 ${status === "ok" ? "opacity-100" : "opacity-0"}`}
        />
      )}
    </div>
  );
}

export function CommunityBadge() {
  return (
    <span className="shrink-0 border border-hair-amber px-1.5 py-px text-[8.5px] uppercase tracking-[2px] text-amber">
      Community
    </span>
  );
}

// ---- card -------------------------------------------------------------------

export default function AppCard({ app }: { app: CatalogApp }) {
  const platform = useStore((s) => s.platform);
  const installed = useStore((s) => s.installed);
  const ops = useStore((s) => s.ops);
  const selectApp = useStore((s) => s.selectApp);
  const install = useStore((s) => s.install);
  const uninstall = useStore((s) => s.uninstall);

  const source = primarySource(app, platform);
  const state = deriveInstallState(app, platform, installed, ops);
  const failedKind = ops.get(app.id)?.kind;
  const unavailable = state === "not_available";

  const open = () => {
    if (!unavailable) selectApp(app.id);
  };

  return (
    <div
      role="button"
      tabIndex={unavailable ? -1 : 0}
      aria-disabled={unavailable}
      onClick={open}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          open();
        }
      }}
      className={`group relative flex h-full flex-col gap-3 border border-hair bg-ink-2/40 p-4 outline-none transition-all duration-300 ${
        unavailable
          ? "opacity-40"
          : "cursor-pointer hover:-translate-y-0.5 hover:border-hair-amber focus-visible:border-amber"
      }`}
    >
      <span
        className="absolute inset-x-0 top-0 h-px origin-left scale-x-0 bg-amber transition-transform duration-500 group-hover:scale-x-100"
        aria-hidden="true"
      />
      <div className="flex items-start gap-3">
        <AppIcon app={app} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-[13.5px] font-bold tracking-[1.5px] text-paper-hi">
              {app.name}
            </h3>
            {source !== null && !source.official && <CommunityBadge />}
          </div>
          <p className="mt-1 line-clamp-2 font-serif text-xs italic leading-relaxed text-mute">
            {app.shortDescription}
          </p>
        </div>
      </div>
      <div className="mt-auto flex items-center justify-between gap-2 pt-1">
        <span className="truncate font-mono text-[10px] tracking-[1px] text-mute/80">
          {source !== null ? source.manager : "—"}
        </span>
        <StateButton
          state={state}
          platform={platform}
          failedKind={failedKind}
          onInstall={() => void install(app)}
          onUninstall={() => void uninstall(app)}
        />
      </div>
    </div>
  );
}
