import { create } from "zustand";
import * as ipc from "./ipc";
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
  // actions
  init(): Promise<void>;
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
  return installed.has(installedKey(source)) ? "installed" : "not_installed";
}

export function installedVersion(
  app: CatalogApp,
  platform: Platform,
  installed: Map<string, string>,
): string | null {
  const source = primarySource(app, platform);
  if (source === null) return null;
  return installed.get(installedKey(source)) ?? null;
}

/** Catalog apps whose primary source on this platform is currently installed. */
export function installedCatalogApps(
  catalog: Catalog,
  platform: Platform,
  installed: Map<string, string>,
): CatalogApp[] {
  return catalog.apps.filter((app) => {
    const source = primarySource(app, platform);
    return source !== null && installed.has(installedKey(source));
  });
}

function toInstalledMap(list: InstalledPackage[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const pkg of list) map.set(`${pkg.manager}:${pkg.id}`, pkg.version);
  return map;
}

// ---- store ------------------------------------------------------------------

let initStarted = false; // module-level so React StrictMode double-effects are harmless

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
