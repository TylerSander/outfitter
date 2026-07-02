import { useEffect, useMemo } from "react";
import { installedCatalogApps, useStore } from "./store";
import { OS_LABEL } from "./types";
import Discover from "./components/Discover";
import AppGrid from "./components/AppGrid";
import MyApps from "./components/MyApps";
import AppDetail from "./components/AppDetail";

export default function App() {
  const init = useStore((s) => s.init);
  const catalog = useStore((s) => s.catalog);
  const ready = useStore((s) => s.ready);
  const initError = useStore((s) => s.initError);
  const platform = useStore((s) => s.platform);
  const installed = useStore((s) => s.installed);
  const activeView = useStore((s) => s.activeView);
  const setActiveView = useStore((s) => s.setActiveView);
  const searchQuery = useStore((s) => s.searchQuery);
  const setSearchQuery = useStore((s) => s.setSearchQuery);

  useEffect(() => {
    void init();
  }, [init]);

  const categories = useMemo(
    () => (catalog !== null ? [...catalog.categories].sort((a, b) => a.order - b.order) : []),
    [catalog],
  );

  const installedCount = useMemo(
    () =>
      catalog !== null ? installedCatalogApps(catalog, platform, installed).length : 0,
    [catalog, platform, installed],
  );

  const query = searchQuery.trim().toLowerCase();
  const searchResults = useMemo(() => {
    if (catalog === null || query === "") return null;
    return catalog.apps
      .filter(
        (app) =>
          app.name.toLowerCase().includes(query) ||
          app.shortDescription.toLowerCase().includes(query) ||
          app.tags.some((tag) => tag.toLowerCase().includes(query)),
      )
      .sort((a, b) => b.popularity - a.popularity);
  }, [catalog, query]);

  const activeCategory = categories.find((c) => c.id === activeView) ?? null;
  const categoryApps = useMemo(() => {
    if (catalog === null || activeCategory === null) return [];
    return catalog.apps
      .filter((a) => a.category === activeCategory.id)
      .sort((a, b) => b.popularity - a.popularity);
  }, [catalog, activeCategory]);

  if (!ready) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-950 text-sm text-slate-500">
        Loading catalog…
      </div>
    );
  }

  if (initError !== null || catalog === null) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-2 bg-slate-950 px-8">
        <p className="text-sm font-semibold text-red-400">Outfitter failed to start</p>
        <p className="max-w-md text-center text-xs leading-relaxed text-slate-500">
          {initError ?? "The catalog could not be loaded."}
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-screen overflow-hidden bg-slate-950 text-slate-200">
      {/* sidebar */}
      <aside className="flex w-56 shrink-0 flex-col border-r border-slate-800/80 bg-slate-900/30">
        <div className="flex items-center gap-2.5 px-4 pt-5">
          <Logo />
          <span className="text-sm font-semibold tracking-wide text-slate-100">
            Outfitter
          </span>
        </div>
        <nav className="mt-5 flex flex-1 flex-col gap-0.5 overflow-y-auto px-2 pb-2">
          <NavItem
            label="Discover"
            active={activeView === "discover"}
            onClick={() => setActiveView("discover")}
          />
          <p className="mb-1 mt-5 px-2.5 text-[10px] font-semibold uppercase tracking-wider text-slate-600">
            Categories
          </p>
          {categories.map((cat) => (
            <NavItem
              key={cat.id}
              label={cat.name}
              active={activeView === cat.id}
              onClick={() => setActiveView(cat.id)}
            />
          ))}
        </nav>
        <div className="border-t border-slate-800/80 p-2">
          <NavItem
            label="My Apps"
            badge={installedCount}
            active={activeView === "my-apps"}
            onClick={() => setActiveView("my-apps")}
          />
        </div>
      </aside>

      {/* main column */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-3 border-b border-slate-800/80 px-6 py-3">
          <div className="relative w-full max-w-md">
            <SearchIcon />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search apps and tags…"
              spellCheck={false}
              className="w-full rounded-lg border border-slate-800 bg-slate-900/70 py-2 pl-9 pr-8 text-sm text-slate-200 outline-none transition-colors placeholder:text-slate-500 focus:border-slate-600"
            />
            {searchQuery !== "" && (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                aria-label="Clear search"
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-slate-500 transition-colors hover:text-slate-300"
              >
                <svg
                  className="h-3.5 w-3.5"
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
            )}
          </div>
          <span className="ml-auto hidden shrink-0 text-[11px] text-slate-600 sm:block">
            {OS_LABEL[platform]}
          </span>
        </header>

        <main className="flex-1 overflow-y-auto px-6 py-6">
          {searchResults !== null ? (
            <>
              <h1 className="mb-4 text-lg font-semibold text-slate-100">
                Results for “{searchQuery.trim()}”
              </h1>
              <AppGrid
                apps={searchResults}
                emptyMessage={`No apps match “${searchQuery.trim()}”.`}
              />
            </>
          ) : activeView === "my-apps" ? (
            <>
              <h1 className="mb-4 text-lg font-semibold text-slate-100">My Apps</h1>
              <MyApps />
            </>
          ) : activeCategory !== null ? (
            <>
              <h1 className="mb-4 text-lg font-semibold text-slate-100">
                {activeCategory.name}
              </h1>
              <AppGrid apps={categoryApps} />
            </>
          ) : (
            <Discover />
          )}
        </main>
      </div>

      <AppDetail />
    </div>
  );
}

function NavItem({
  label,
  active,
  onClick,
  badge,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  badge?: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-[13px] transition-colors ${
        active
          ? "bg-slate-800 text-slate-100"
          : "text-slate-400 hover:bg-slate-900 hover:text-slate-200"
      }`}
    >
      <span className="truncate">{label}</span>
      {badge !== undefined && (
        <span
          className={`ml-2 shrink-0 rounded-full px-1.5 py-px text-[10px] tabular-nums ${
            active ? "bg-slate-700 text-slate-200" : "bg-slate-800 text-slate-400"
          }`}
        >
          {badge}
        </span>
      )}
    </button>
  );
}

function Logo() {
  return (
    <svg
      className="h-6 w-6 text-sky-400"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="3" y="3" width="18" height="18" rx="5" />
      <path d="M12 7v7m0 0-3-3m3 3 3-3" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg
      className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  );
}
