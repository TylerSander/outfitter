import { useMemo } from "react";
import { useStore } from "../store";
import AppCard from "./AppCard";
import AppGrid from "./AppGrid";

const CATEGORY_ROW_LIMIT = 4;

export default function Discover() {
  const catalog = useStore((s) => s.catalog);
  const setActiveView = useStore((s) => s.setActiveView);

  const featured = useMemo(
    () =>
      catalog
        ? catalog.apps
            .filter((a) => a.featured)
            .sort((a, b) => b.popularity - a.popularity)
        : [],
    [catalog],
  );

  const categories = useMemo(
    () => (catalog ? [...catalog.categories].sort((a, b) => a.order - b.order) : []),
    [catalog],
  );

  if (!catalog) return null;

  return (
    <div className="flex flex-col gap-11">
      {featured.length > 0 && (
        <section>
          <h2 className="index-label mb-4">Featured</h2>
          <div className="flex gap-4 overflow-x-auto pb-2">
            {featured.map((app) => (
              <div key={app.id} className="w-72 shrink-0">
                <AppCard app={app} />
              </div>
            ))}
          </div>
        </section>
      )}

      {categories.map((cat) => {
        const apps = catalog.apps
          .filter((a) => a.category === cat.id)
          .sort((a, b) => b.popularity - a.popularity);
        if (apps.length === 0) return null;
        return (
          <section key={cat.id}>
            <div className="mb-4 flex items-baseline justify-between gap-3">
              <h2 className="index-label flex-1">{cat.name}</h2>
              {apps.length > CATEGORY_ROW_LIMIT && (
                <button
                  type="button"
                  onClick={() => setActiveView(cat.id)}
                  className="inline-flex items-center gap-1 text-[10px] uppercase tracking-[3px] text-amber transition-all hover:tracking-[4px] hover:text-amber-hi"
                >
                  See all
                  <ChevronRight />
                </button>
              )}
            </div>
            <AppGrid apps={apps.slice(0, CATEGORY_ROW_LIMIT)} />
          </section>
        );
      })}
    </div>
  );
}

function ChevronRight() {
  return (
    <svg
      className="h-3 w-3"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m9 6 6 6-6 6" />
    </svg>
  );
}
