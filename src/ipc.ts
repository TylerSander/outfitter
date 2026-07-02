// Thin IPC layer. Inside Tauri it talks to the Rust backend via invoke/listen;
// in a plain browser (LAN dev, `pnpm dev` without `tauri dev`) it transparently
// falls back to the mock backend so the same bundle runs anywhere.

import type {
  Catalog,
  CatalogApp,
  InstalledPackage,
  ManagerStatus,
  NewSavedApp,
  OpEvent,
  Platform,
  Profile,
  Session,
  Source,
} from "./types";

/** The surface both the real (Tauri) and mock (browser) backends implement. */
export interface IpcBackend {
  getPlatform(): Promise<Platform>;
  getCatalog(): Promise<Catalog>;
  getManagerStatus(): Promise<ManagerStatus[]>;
  detectInstalled(): Promise<InstalledPackage[]>;
  installApp(app: CatalogApp, source: Source): Promise<void>;
  uninstallApp(app: CatalogApp, source: Source): Promise<void>;
  onOpEvent(cb: (e: OpEvent) => void): Promise<() => void>;
  openExternal(url: string): Promise<void>;
  getAppVersion(): Promise<string>;
  login(): Promise<Session>;
  restoreSession(): Promise<Session | null>;
  logout(): Promise<void>;
  getProfile(sub: string): Promise<Profile>;
  setDisplayName(sub: string, name: string | null): Promise<Profile>;
  addSavedApp(sub: string, entry: NewSavedApp, now: string): Promise<Profile>;
  removeSavedApp(sub: string, id: string): Promise<Profile>;
}

export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

async function makeTauriBackend(): Promise<IpcBackend> {
  const { invoke } = await import("@tauri-apps/api/core");
  const { listen } = await import("@tauri-apps/api/event");
  return {
    getPlatform: () => invoke<Platform>("get_platform"),
    getCatalog: () => invoke<Catalog>("get_catalog"),
    getManagerStatus: () => invoke<ManagerStatus[]>("get_manager_status"),
    detectInstalled: () => invoke<InstalledPackage[]>("detect_installed"),
    installApp: (app, source) =>
      invoke<void>("install_app", {
        appId: app.id,
        manager: source.manager,
        packageId: source.id,
      }),
    uninstallApp: (app, source) =>
      invoke<void>("uninstall_app", {
        appId: app.id,
        manager: source.manager,
        packageId: source.id,
      }),
    onOpEvent: (cb) => listen<OpEvent>("op-event", (event) => cb(event.payload)),
    openExternal: async (url) => {
      const { openUrl } = await import("@tauri-apps/plugin-opener");
      await openUrl(url);
    },
    getAppVersion: async () => {
      const { getVersion } = await import("@tauri-apps/api/app");
      return getVersion();
    },
    login: () => invoke<Session>("login"),
    restoreSession: () => invoke<Session | null>("restore_session"),
    logout: () => invoke<void>("logout"),
    getProfile: (sub) => invoke<Profile>("get_profile", { sub }),
    setDisplayName: (sub, name) => invoke<Profile>("set_display_name", { sub, name }),
    addSavedApp: (sub, entry, now) =>
      invoke<Profile>("add_saved_app", { sub, entry, now }),
    removeSavedApp: (sub, id) => invoke<Profile>("remove_saved_app", { sub, id }),
  };
}

let backendPromise: Promise<IpcBackend> | null = null;

function backend(): Promise<IpcBackend> {
  if (backendPromise === null) {
    backendPromise = isTauri()
      ? makeTauriBackend()
      : import("./mock").then((m) => m.mockBackend);
  }
  return backendPromise;
}

export async function getPlatform(): Promise<Platform> {
  return (await backend()).getPlatform();
}

export async function getCatalog(): Promise<Catalog> {
  return (await backend()).getCatalog();
}

export async function getManagerStatus(): Promise<ManagerStatus[]> {
  return (await backend()).getManagerStatus();
}

export async function detectInstalled(): Promise<InstalledPackage[]> {
  return (await backend()).detectInstalled();
}

export async function installApp(app: CatalogApp, source: Source): Promise<void> {
  return (await backend()).installApp(app, source);
}

export async function uninstallApp(app: CatalogApp, source: Source): Promise<void> {
  return (await backend()).uninstallApp(app, source);
}

/**
 * Subscribe to "op-event". Returns a synchronous unsubscribe that is safe to
 * call even before the underlying (async) listener has finished attaching.
 */
export function onOpEvent(cb: (e: OpEvent) => void): () => void {
  let disposed = false;
  let unlisten: (() => void) | null = null;
  void backend()
    .then((b) => b.onOpEvent(cb))
    .then((un) => {
      if (disposed) un();
      else unlisten = un;
    });
  return () => {
    disposed = true;
    if (unlisten !== null) unlisten();
  };
}

/** Open a URL with the OS default handler (opener plugin in Tauri, window.open in browser). */
export async function openExternal(url: string): Promise<void> {
  return (await backend()).openExternal(url);
}

/** App version (tauri.conf.json version in Tauri; \"dev\" in the browser mock). */
export async function getAppVersion(): Promise<string> {
  return (await backend()).getAppVersion();
}

export async function login(): Promise<Session> {
  return (await backend()).login();
}

export async function restoreSession(): Promise<Session | null> {
  return (await backend()).restoreSession();
}

export async function logout(): Promise<void> {
  return (await backend()).logout();
}

export async function getProfile(sub: string): Promise<Profile> {
  return (await backend()).getProfile(sub);
}

export async function setDisplayName(sub: string, name: string | null): Promise<Profile> {
  return (await backend()).setDisplayName(sub, name);
}

export async function addSavedApp(
  sub: string,
  entry: NewSavedApp,
  now: string,
): Promise<Profile> {
  return (await backend()).addSavedApp(sub, entry, now);
}

export async function removeSavedApp(sub: string, id: string): Promise<Profile> {
  return (await backend()).removeSavedApp(sub, id);
}
