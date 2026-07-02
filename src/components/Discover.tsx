import { useMemo } from "react";
import { useStore } from "../store";
import { openExternal } from "../ipc";
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
      <MyAppsSection />

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

/** The signed-in user's own saved apps, surfaced as a Discover category.
 *  Reactive to store.profile, so adding one on the Profile page shows here. */
function MyAppsSection() {
  const session = useStore((s) => s.session);
  const profile = useStore((s) => s.profile);
  const setActiveView = useStore((s) => s.setActiveView);
  const removeSavedApp = useStore((s) => s.removeSavedApp);

  const apps = profile?.apps ?? [];
  if (session === null || apps.length === 0) return null;

  return (
    <section>
      <div className="mb-4 flex items-baseline justify-between gap-3">
        <h2 className="index-label flex-1">My Apps</h2>
        <button
          type="button"
          onClick={() => setActiveView("profile")}
          className="inline-flex items-center gap-1 text-[10px] uppercase tracking-[3px] text-amber transition-all hover:tracking-[4px] hover:text-amber-hi"
        >
          Manage
          <ChevronRight />
        </button>
      </div>
      <div className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(250px,1fr))]">
        {apps.map((a) => (
          <div
            key={a.id}
            className="group relative flex h-full flex-col gap-2 border border-hair bg-ink-2/40 p-4 transition-all duration-300 hover:-translate-y-0.5 hover:border-hair-amber"
          >
            <span
              className="absolute inset-x-0 top-0 h-px origin-left scale-x-0 bg-amber transition-transform duration-500 group-hover:scale-x-100"
              aria-hidden="true"
            />
            <div className="flex items-start gap-3">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-sm border border-hair bg-ink-2 font-serif text-lg italic text-amber">
                {a.name.charAt(0).toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="truncate text-[13.5px] font-bold tracking-[0.5px] text-paper-hi">
                  {a.name}
                </h3>
                {a.note !== null && (
                  <p className="mt-0.5 line-clamp-2 font-serif text-xs italic leading-relaxed text-mute">
                    {a.note}
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={() => void removeSavedApp(a.id)}
                aria-label={`Remove ${a.name}`}
                className="shrink-0 p-1 text-mute opacity-0 transition-opacity hover:text-coral group-hover:opacity-100"
              >
                <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
                  <path d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
            </div>
            {a.url !== null && (
              <button
                type="button"
                onClick={() => void openExternal(a.url as string)}
                className="mt-auto inline-flex items-center gap-1 self-start pt-1 text-[10.5px] uppercase tracking-[3px] text-amber transition-all hover:tracking-[4px] hover:text-amber-hi"
              >
                Open ↗
              </button>
            )}
          </div>
        ))}
      </div>
    </section>
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
