import { useState } from "react";
import type { CatalogApp } from "../types";
import { deriveInstallState, primarySource, useStore } from "../store";
import StateButton from "./StateButton";

// ---- icon tile (shared with AppDetail) --------------------------------------
// Icon PNGs may not exist yet: render a colored initial tile, and lay the
// <img> on top only once it actually loads.

function hueFor(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i += 1) h = (h * 31 + id.charCodeAt(i)) % 360;
  return h;
}

export function AppIcon({
  app,
  className = "h-12 w-12 text-lg",
}: {
  app: CatalogApp;
  className?: string;
}) {
  const [status, setStatus] = useState<"loading" | "ok" | "error">("loading");
  const hue = hueFor(app.id);

  return (
    <div
      className={`relative flex shrink-0 select-none items-center justify-center overflow-hidden rounded-xl font-semibold text-white/90 shadow-inner ${className}`}
      style={{
        background: `linear-gradient(135deg, hsl(${hue} 55% 40%), hsl(${(hue + 45) % 360} 60% 24%))`,
      }}
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
          className={`absolute inset-0 h-full w-full object-cover ${status === "ok" ? "opacity-100" : "opacity-0"}`}
        />
      )}
    </div>
  );
}

export function CommunityBadge() {
  return (
    <span className="shrink-0 rounded-full border border-amber-700/60 bg-amber-950/50 px-1.5 py-px text-[10px] font-medium text-amber-300">
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
      className={`group flex h-full flex-col gap-3 rounded-xl border border-slate-800 bg-slate-900/60 p-4 outline-none transition-colors ${
        unavailable
          ? "opacity-50"
          : "cursor-pointer hover:border-slate-700 hover:bg-slate-900 focus-visible:border-sky-700"
      }`}
    >
      <div className="flex items-start gap-3">
        <AppIcon app={app} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-sm font-semibold text-slate-100">{app.name}</h3>
            {source !== null && !source.official && <CommunityBadge />}
          </div>
          <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-slate-400">
            {app.shortDescription}
          </p>
        </div>
      </div>
      <div className="mt-auto flex items-center justify-between gap-2 pt-1">
        <span className="truncate text-[11px] text-slate-500">
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
