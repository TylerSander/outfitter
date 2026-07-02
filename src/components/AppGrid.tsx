import type { CatalogApp } from "../types";
import AppCard from "./AppCard";

export default function AppGrid({
  apps,
  emptyMessage = "No apps here yet.",
}: {
  apps: CatalogApp[];
  emptyMessage?: string;
}) {
  if (apps.length === 0) {
    return (
      <div className="flex items-center justify-center rounded-xl border border-dashed border-slate-800 px-6 py-16 text-center text-sm text-slate-500">
        {emptyMessage}
      </div>
    );
  }

  return (
    <div className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(250px,1fr))]">
      {apps.map((app) => (
        <AppCard key={app.id} app={app} />
      ))}
    </div>
  );
}
