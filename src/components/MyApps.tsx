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
    <div className="flex flex-col gap-6">
      {managerStatus.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          {managerStatus.map((m) => (
            <span
              key={m.manager}
              className={`inline-flex items-center gap-2 text-[10px] uppercase tracking-[3px] ${
                m.available ? "text-paper" : "text-mute/60"
              }`}
              title={m.available ? "Package manager available" : "Package manager not found"}
            >
              <span
                className={`h-1 w-1 rounded-full ${
                  m.available ? "obs-pulse bg-mint" : "bg-coral/70"
                }`}
              />
              {m.manager}
              {m.version !== null && (
                <span className="font-mono text-[10px] normal-case tracking-normal text-mute">
                  {m.version}
                </span>
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
