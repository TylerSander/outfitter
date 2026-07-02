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
      <div className="flex items-center justify-center border border-dashed border-hair px-6 py-16 text-center font-serif text-sm italic text-mute">
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
