import { useEffect, useMemo, useState } from "react";
import { installedCatalogApps, useStore } from "./store";
import { OS_LABEL } from "./types";
import Discover from "./components/Discover";
import AppGrid from "./components/AppGrid";
import MyApps from "./components/MyApps";
import AppDetail from "./components/AppDetail";
import UpdateBanner from "./components/UpdateBanner";
import FeedbackPanel from "./components/FeedbackPanel";
import WelcomeScreen from "./components/WelcomeScreen";
import Profile from "./components/Profile";

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
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const session = useStore((s) => s.session);
  const welcomeOpen = useStore((s) => s.welcomeOpen);
  const login = useStore((s) => s.login);

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
      <div className="flex h-screen flex-col items-center justify-center gap-4 bg-ink">
        <p className="obs-pulse text-[11px] uppercase tracking-[5px] text-mute">
          Reading catalog
        </p>
        <div className="divider-glint w-56" />
      </div>
    );
  }

  if (initError !== null || catalog === null) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-3 bg-ink px-8">
        <p className="text-[12px] uppercase tracking-[4px] text-coral">
          Outfitter failed to start
        </p>
        <p className="max-w-md text-center font-serif text-sm italic leading-relaxed text-mute">
          {initError ?? "The catalog could not be loaded."}
        </p>
      </div>
    );
  }

  return (
    <div className="relative z-10 flex h-screen overflow-hidden bg-ink text-paper">
      {/* sidebar */}
      <aside className="flex w-60 shrink-0 flex-col border-r border-hair">
        <div className="flex items-baseline gap-2.5 px-5 pt-6">
          <Logo />
          <span className="text-[13px] font-bold uppercase tracking-[6px] text-paper-hi">
            Outfitter
          </span>
        </div>
        <p className="mt-2 px-5 font-serif text-[12px] italic tracking-wide text-mute">
          fits out <span className="text-amber">your machine</span>
        </p>
        <nav className="mt-6 flex flex-1 flex-col overflow-y-auto px-3 pb-2">
          <NavItem
            label="Discover"
            active={activeView === "discover"}
            onClick={() => setActiveView("discover")}
          />
          <p className="index-label mb-1 mt-6 px-2">Categories</p>
          {categories.map((cat) => (
            <NavItem
              key={cat.id}
              label={cat.name}
              active={activeView === cat.id}
              onClick={() => setActiveView(cat.id)}
            />
          ))}
        </nav>
        <div className="border-t border-hair p-3">
          {session !== null ? (
            <NavItem
              label="Profile"
              active={activeView === "profile"}
              onClick={() => setActiveView("profile")}
            />
          ) : (
            <NavItem label="Sign in" active={false} onClick={() => void login()} />
          )}
          <NavItem
            label="My Apps"
            badge={installedCount}
            active={activeView === "my-apps"}
            onClick={() => setActiveView("my-apps")}
          />
          <NavItem
            label="Feedback"
            active={false}
            onClick={() => setFeedbackOpen(true)}
          />
        </div>
      </aside>

      {/* main column */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-4 border-b border-hair px-7 py-4">
          <div className="relative w-full max-w-md">
            <SearchIcon />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="SEARCH THE CATALOG"
              spellCheck={false}
              className="w-full border-b border-hair bg-transparent py-2 pl-7 pr-8 text-[13px] tracking-[2px] text-paper outline-none transition-colors placeholder:text-[11px] placeholder:tracking-[4px] placeholder:text-mute/70 focus:border-amber"
            />
            {searchQuery !== "" && (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                aria-label="Clear search"
                className="absolute right-1 top-1/2 -translate-y-1/2 p-0.5 text-mute transition-colors hover:text-amber-hi"
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
          <span className="ml-auto hidden shrink-0 font-mono text-[10px] uppercase tracking-[3px] text-mute sm:block">
            {OS_LABEL[platform]}
          </span>
        </header>

        <main className="flex-1 overflow-y-auto px-7 py-7">
          {searchResults !== null ? (
            <>
              <h1 className="index-label mb-5">Results · {searchQuery.trim()}</h1>
              <AppGrid
                apps={searchResults}
                emptyMessage={`No apps match “${searchQuery.trim()}”.`}
              />
            </>
          ) : activeView === "profile" ? (
            <>
              <h1 className="index-label mb-5">Profile</h1>
              <Profile />
            </>
          ) : activeView === "my-apps" ? (
            <>
              <h1 className="index-label mb-5">My Apps</h1>
              <MyApps />
            </>
          ) : activeCategory !== null ? (
            <>
              <h1 className="index-label mb-5">{activeCategory.name}</h1>
              <AppGrid apps={categoryApps} />
            </>
          ) : (
            <Discover />
          )}
        </main>
      </div>

      <AppDetail />
      <UpdateBanner />
      {feedbackOpen && <FeedbackPanel onClose={() => setFeedbackOpen(false)} />}
      {welcomeOpen && <WelcomeScreen />}
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
      className={`group relative flex w-full items-center justify-between px-2 py-2 text-left text-[11.5px] uppercase tracking-[3px] transition-all duration-200 ${
        active
          ? "text-paper-hi"
          : "text-mute hover:translate-x-1 hover:text-paper"
      }`}
    >
      <span
        className={`absolute left-0 top-1/2 h-px -translate-y-1/2 bg-amber transition-all duration-300 ${
          active ? "w-4 opacity-100" : "w-0 opacity-0"
        }`}
        aria-hidden="true"
      />
      <span className={`truncate transition-transform duration-200 ${active ? "translate-x-6" : ""}`}>
        {label}
      </span>
      {badge !== undefined && (
        <span
          className={`ml-2 shrink-0 font-mono text-[10px] tracking-[1px] ${
            active ? "text-amber" : "text-mute"
          }`}
        >
          {String(badge).padStart(2, "0")}
        </span>
      )}
    </button>
  );
}

function Logo() {
  return (
    <svg
      className="h-5 w-5 self-center text-amber"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none" />
      <path d="M12 3v3M12 18v3M3 12h3M18 12h3" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg
      className="pointer-events-none absolute left-0 top-1/2 h-4 w-4 -translate-y-1/2 text-mute"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  );
}
