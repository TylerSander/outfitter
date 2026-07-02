import { create } from "zustand";
import * as ipc from "./ipc";
import { checkForUpdate, relaunchApp, type AvailableUpdate } from "./update";
import type {
  Catalog,
  CatalogApp,
  InstallState,
  InstalledPackage,
  ManagerStatus,
  OpEvent,
  OpKind,
  OpPhase,
  Platform,
  Profile,
  NewSavedApp,
  Session,
  Source,
} from "./types";

const MAX_LOG_LINES = 500;

export interface OpState {
  kind: OpKind;
  phase: OpPhase;
  percent?: number;
  error?: string;
  log: string[];
}

/** "discover" | "my-apps" | a category id from the catalog. */
export type View = "discover" | "my-apps" | (string & {});

interface OutfitterStore {
  // data
  catalog: Catalog | null;
  platform: Platform;
  /** "manager:packageId" -> installed version */
  installed: Map<string, string>;
  managerStatus: ManagerStatus[];
  /** appId -> in-flight (or failed) operation */
  ops: Map<string, OpState>;
  // ui
  selectedAppId: string | null;
  searchQuery: string;
  activeView: View;
  ready: boolean;
  initError: string | null;
  // accounts
  session: Session | null;
  authBusy: boolean;
  authError: string | null;
  welcomeOpen: boolean;
  profile: Profile | null;
  profileBusy: boolean;
  profileError: string | null;
  // actions
  init(): Promise<void>;
  login(): Promise<void>;
  logout(): Promise<void>;
  closeWelcome(): void;
  loadProfile(): Promise<void>;
  setDisplayName(name: string | null): Promise<void>;
  addSavedApp(entry: NewSavedApp): Promise<void>;
  removeSavedApp(id: string): Promise<void>;
  // updates
  appVersion: string | null;
  updatePhase: "idle" | "available" | "downloading" | "installing" | "ready" | "error";
  updateVersion: string | null;
  updatePercent: number | null;
  updateError: string | null;
  checkForUpdates(): Promise<void>;
  startUpdate(): Promise<void>;
  relaunchForUpdate(): Promise<void>;
  install(app: CatalogApp): Promise<void>;
  uninstall(app: CatalogApp): Promise<void>;
  clearOp(appId: string): void;
  selectApp(appId: string | null): void;
  setSearchQuery(q: string): void;
  setActiveView(view: View): void;
}

// ---- pure helpers (exported for components) --------------------------------

function installedKey(source: Source): string {
  return `${source.manager}:${source.id}`;
}

/** Installed version matching this source, or null. winget publishes
 *  installer/arch/channel variants under suffixed ids (Google.Chrome.EXE,
 *  Mozilla.Firefox.MSIX), so exact id equality reports a variant-installed
 *  app as "not installed". Match the exact id first, then any winget id in
 *  the same family (`<id>.<suffix>`) — the trailing dot keeps Google.Chrome
 *  from matching an unrelated Google.ChromeRemoteDesktop. */
export function matchInstalled(
  source: Source,
  installed: Map<string, string>,
): string | null {
  const exact = installed.get(installedKey(source));
  if (exact !== undefined) return exact;
  if (source.manager === "winget") {
    const prefix = `winget:${source.id}.`;
    for (const [k, version] of installed) {
      if (k.startsWith(prefix)) return version;
    }
  }
  return null;
}

/** First source listed for the current platform wins; null = not available. */
export function primarySource(app: CatalogApp, platform: Platform): Source | null {
  return app.sources[platform][0] ?? null;
}

export function deriveInstallState(
  app: CatalogApp,
  platform: Platform,
  installed: Map<string, string>,
  ops: Map<string, OpState>,
): InstallState {
  const source = primarySource(app, platform);
  if (source === null) return "not_available";
  const op = ops.get(app.id);
  if (op !== undefined) {
    if (op.phase === "failed") return "failed";
    if (op.phase === "queued") return "queued";
    return op.kind === "install" ? "installing" : "uninstalling";
  }
  return matchInstalled(source, installed) !== null ? "installed" : "not_installed";
}

export function installedVersion(
  app: CatalogApp,
  platform: Platform,
  installed: Map<string, string>,
): string | null {
  const source = primarySource(app, platform);
  if (source === null) return null;
  return matchInstalled(source, installed);
}

/** Catalog apps whose primary source on this platform is currently installed. */
export function installedCatalogApps(
  catalog: Catalog,
  platform: Platform,
  installed: Map<string, string>,
): CatalogApp[] {
  return catalog.apps.filter((app) => {
    const source = primarySource(app, platform);
    return source !== null && matchInstalled(source, installed) !== null;
  });
}

function toInstalledMap(list: InstalledPackage[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const pkg of list) map.set(`${pkg.manager}:${pkg.id}`, pkg.version);
  return map;
}

// ---- store ------------------------------------------------------------------

let initStarted = false; // module-level so React StrictMode double-effects are harmless
let pendingUpdate: AvailableUpdate | null = null;

export const useStore = create<OutfitterStore>()((set, get) => {
  function updateOp(
    appId: string,
    updater: (prev: OpState | undefined) => OpState | null,
  ): void {
    const ops = new Map(get().ops);
    const next = updater(ops.get(appId));
    if (next === null) ops.delete(appId);
    else ops.set(appId, next);
    set({ ops });
  }

  function refreshInstalled(): void {
    void ipc
      .detectInstalled()
      .then((list) => set({ installed: toInstalledMap(list) }))
      .catch(() => undefined);
  }

  function handleOpEvent(e: OpEvent): void {
    switch (e.phase) {
      case "queued":
        updateOp(e.appId, () => ({ kind: e.kind, phase: "queued", log: [] }));
        break;
      case "started":
        updateOp(e.appId, (prev) => ({
          ...(prev ?? { log: [] as string[] }),
          kind: e.kind,
          phase: "started",
        }));
        break;
      case "log":
        updateOp(e.appId, (prev) => {
          const base = prev ?? { kind: e.kind, phase: "started" as OpPhase, log: [] as string[] };
          return {
            ...base,
            kind: e.kind,
            log: [...base.log, e.line ?? ""].slice(-MAX_LOG_LINES),
          };
        });
        break;
      case "progress":
        updateOp(e.appId, (prev) => ({
          ...(prev ?? { phase: "started" as OpPhase, log: [] as string[] }),
          kind: e.kind,
          percent: e.percent,
        }));
        break;
      case "done":
        updateOp(e.appId, () => null);
        refreshInstalled();
        break;
      case "failed":
        updateOp(e.appId, (prev) => ({
          kind: e.kind,
          phase: "failed",
          log: prev?.log ?? [],
          error: e.error ?? "Operation failed",
        }));
        break;
    }
  }

  async function runAction(app: CatalogApp, kind: OpKind): Promise<void> {
    const source = primarySource(app, get().platform);
    if (source === null) return;
    // Optimistic: show "queued" immediately; the backend echoes it via op-event.
    updateOp(app.id, () => ({ kind, phase: "queued", log: [] }));
    try {
      if (kind === "install") await ipc.installApp(app, source);
      else await ipc.uninstallApp(app, source);
    } catch (err) {
      updateOp(app.id, (prev) => ({
        kind,
        phase: "failed",
        log: prev?.log ?? [],
        error: err instanceof Error ? err.message : String(err),
      }));
    }
  }

  return {
    catalog: null,
    platform: "linux",
    installed: new Map<string, string>(),
    managerStatus: [],
    ops: new Map<string, OpState>(),
    selectedAppId: null,
    searchQuery: "",
    activeView: "discover",
    ready: false,
    initError: null,
    session: null,
    authBusy: false,
    authError: null,
    welcomeOpen: false,
    profile: null,
    profileBusy: false,
    profileError: null,
    appVersion: null,
    updatePhase: "idle",
    updateVersion: null,
    updatePercent: null,
    updateError: null,

    init: async () => {
      if (initStarted) return;
      initStarted = true;
      ipc.onOpEvent(handleOpEvent);
      try {
        const [platform, catalog, installedList, managerStatus] = await Promise.all([
          ipc.getPlatform(),
          ipc.getCatalog(),
          ipc.detectInstalled(),
          ipc.getManagerStatus(),
        ]);
        set({
          platform,
          catalog,
          installed: toInstalledMap(installedList),
          managerStatus,
          ready: true,
        });
      } catch (err) {
        set({
          initError: err instanceof Error ? err.message : String(err),
          ready: true,
        });
      }
      // Silently restore a prior sign-in; if none and the welcome has never
      // been shown, open it (first-run login/create-account gate).
      set({ authBusy: true });
      try {
        const session = await ipc.restoreSession();
        if (session !== null) {
          set({ session, authBusy: false });
          void get().loadProfile();
        } else {
          set({ authBusy: false });
          if (localStorage.getItem("outfitter.welcomed") === null) {
            set({ welcomeOpen: true });
          }
        }
      } catch {
        // offline / no keychain — stay signed out, no gate
        set({ authBusy: false });
      }
      // Current version (shown under Feedback) + update check.
      void ipc
        .getAppVersion()
        .then((v) => set({ appVersion: v }))
        .catch(() => undefined);
      void get().checkForUpdates();
      setInterval(() => void get().checkForUpdates(), 4 * 60 * 60 * 1000);
    },

    checkForUpdates: async () => {
      const phase = get().updatePhase;
      // never interrupt an in-flight/staged update
      if (phase === "downloading" || phase === "installing" || phase === "ready") return;
      try {
        const update = await checkForUpdate();
        if (update === null) {
          pendingUpdate = null;
          if (get().updatePhase === "available") {
            set({ updatePhase: "idle", updateVersion: null });
          }
          return;
        }
        pendingUpdate = update;
        set({ updatePhase: "available", updateVersion: update.version });
      } catch {
        // offline / release feed unreachable — retry on the next check
      }
    },

    startUpdate: async () => {
      if (pendingUpdate === null) return;
      const busy = [...get().ops.values()].some(
        (o) => o.phase !== "done" && o.phase !== "failed",
      );
      if (busy) {
        set({ updateError: "Finish the app install/uninstall in progress first." });
        return;
      }
      set({ updatePhase: "downloading", updatePercent: null, updateError: null });
      try {
        await pendingUpdate.install((percent) => {
          // On Windows the updater exits the app once the download hits 100%.
          const installing = percent === 100 && get().platform === "windows";
          set({ updatePhase: installing ? "installing" : "downloading", updatePercent: percent });
        });
        set({ updatePhase: "ready" }); // reached on macOS/Linux; Windows exits first
      } catch (e) {
        set({ updatePhase: "error", updateError: e instanceof Error ? e.message : String(e) });
      }
    },

    relaunchForUpdate: async () => {
      await relaunchApp();
    },

    login: async () => {
      if (get().authBusy) return; // ignore double-dispatch (double-click, etc.)
      set({ authBusy: true, authError: null });
      try {
        const session = await ipc.login();
        localStorage.setItem("outfitter.welcomed", "1");
        set({ session, welcomeOpen: false, authBusy: false });
        void get().loadProfile();
      } catch (err) {
        set({
          authBusy: false,
          authError: err instanceof Error ? err.message : String(err),
        });
      }
    },

    logout: async () => {
      try {
        await ipc.logout();
      } catch {
        // best-effort; clear local state regardless
      }
      set((s) => ({
        session: null,
        profile: null,
        activeView: s.activeView === "profile" ? "discover" : s.activeView,
      }));
    },

    closeWelcome: () => {
      localStorage.setItem("outfitter.welcomed", "1");
      set({ welcomeOpen: false });
    },

    loadProfile: async () => {
      const session = get().session;
      if (session === null) return;
      const sub = session.user.id;
      set({ profileBusy: true, profileError: null });
      try {
        const profile = await ipc.getProfile(sub);
        if (get().session?.user.id !== sub) return; // signed out / switched
        set({ profile, profileBusy: false });
      } catch (err) {
        if (get().session?.user.id !== sub) return;
        set({
          profileBusy: false,
          profileError: err instanceof Error ? err.message : String(err),
        });
      }
    },

    setDisplayName: async (name) => {
      const session = get().session;
      if (session === null) return;
      const sub = session.user.id;
      set({ profileBusy: true, profileError: null });
      try {
        const profile = await ipc.setDisplayName(sub, name);
        if (get().session?.user.id !== sub) return;
        set({ profile, profileBusy: false });
      } catch (err) {
        if (get().session?.user.id !== sub) return;
        set({
          profileBusy: false,
          profileError: err instanceof Error ? err.message : String(err),
        });
      }
    },

    addSavedApp: async (entry) => {
      const session = get().session;
      if (session === null) return;
      const sub = session.user.id;
      set({ profileBusy: true, profileError: null });
      try {
        const profile = await ipc.addSavedApp(sub, entry, new Date().toISOString());
        if (get().session?.user.id !== sub) return;
        set({ profile, profileBusy: false });
      } catch (err) {
        if (get().session?.user.id !== sub) return;
        set({
          profileBusy: false,
          profileError: err instanceof Error ? err.message : String(err),
        });
      }
    },

    removeSavedApp: async (id) => {
      const session = get().session;
      if (session === null) return;
      const sub = session.user.id;
      set({ profileBusy: true, profileError: null });
      try {
        const profile = await ipc.removeSavedApp(sub, id);
        if (get().session?.user.id !== sub) return;
        set({ profile, profileBusy: false });
      } catch (err) {
        if (get().session?.user.id !== sub) return;
        set({
          profileBusy: false,
          profileError: err instanceof Error ? err.message : String(err),
        });
      }
    },

    install: (app) => runAction(app, "install"),
    uninstall: (app) => runAction(app, "uninstall"),

    clearOp: (appId) => updateOp(appId, () => null),
    selectApp: (appId) => set({ selectedAppId: appId }),
    setSearchQuery: (searchQuery) => set({ searchQuery }),
    setActiveView: (activeView) =>
      set({ activeView, searchQuery: "", selectedAppId: null }),
  };
});
