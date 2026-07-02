import { useMemo } from "react";
import { installedCatalogApps, useStore } from "../store";
import AppGrid from "./AppGrid";

export default function MyApps() {
  const catalog = useStore((s) => s.catalog);
  const platform = useStore((s) => s.platform);
  const installed = useStore((s) => s.installed);
  const managerStatus = useStore((s) => s.managerStatus);

  const apps = useMemo(
    () => (catalog !== null ? installedCatalogApps(catalog, platform, installed) : []),
    [catalog, platform, installed],
  );

  return (
    <div className="flex flex-col gap-5">
      {managerStatus.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          {managerStatus.map((m) => (
            <span
              key={m.manager}
              className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] ${
                m.available
                  ? "border-slate-700 bg-slate-900 text-slate-300"
                  : "border-slate-800 bg-slate-900/50 text-slate-500"
              }`}
              title={m.available ? "Package manager available" : "Package manager not found"}
            >
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  m.available ? "bg-emerald-400" : "bg-red-500/80"
                }`}
              />
              {m.manager}
              {m.version !== null && (
                <span className="font-mono text-[10px] text-slate-500">{m.version}</span>
              )}
            </span>
          ))}
        </div>
      )}
      <AppGrid
        apps={apps}
        emptyMessage="Nothing from the catalog is installed yet. Head to Discover to grab something."
      />
    </div>
  );
}
