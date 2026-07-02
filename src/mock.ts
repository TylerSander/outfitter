// Browser-dev mock backend. Only ever loaded via dynamic import from ipc.ts
// when the app is NOT running inside Tauri, so `vite dev` in a plain browser
// (e.g. over LAN) works with realistic install/uninstall simulations.

import catalogJson from "../catalog/catalog.json";
import type {
  Catalog,
  CatalogApp,
  InstalledPackage,
  ManagerStatus,
  OpEvent,
  OpKind,
  Platform,
  Source,
} from "./types";
import type { IpcBackend } from "./ipc";

const PLATFORM: Platform = "linux";

const catalog = catalogJson as unknown as Catalog;

// ---- mock installed state -------------------------------------------------

const installed = new Map<string, InstalledPackage>();

function key(manager: string, id: string): string {
  return `${manager}:${id}`;
}

function seed(manager: string, id: string, version: string): void {
  installed.set(key(manager, id), { manager, id, version });
}

seed("flatpak", "org.mozilla.firefox", "140.0.2");
seed("flatpak", "org.videolan.VLC", "3.0.21");

// ---- op-event bus ---------------------------------------------------------

type Listener = (e: OpEvent) => void;
const listeners = new Set<Listener>();

function emit(e: OpEvent): void {
  for (const listener of listeners) listener(e);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function fakeVersion(app: CatalogApp): string {
  const major = (app.popularity % 9) + 1;
  const minor = app.id.length % 10;
  return `${major}.${minor}.0`;
}

async function runOp(app: CatalogApp, source: Source, kind: OpKind): Promise<void> {
  const appId = app.id;
  emit({ appId, kind, phase: "queued" });
  await sleep(350);
  emit({ appId, kind, phase: "started" });

  const verb = kind === "install" ? "Installing" : "Removing";
  const command =
    source.manager === "flatpak"
      ? `flatpak ${kind === "install" ? "install -y flathub" : "uninstall -y"} ${source.id}`
      : `${source.manager} ${kind} ${source.id}`;
  const lines = [
    `$ ${command}`,
    `Resolving ${source.id}…`,
    `${verb} ${app.name}…`,
    "Fetching deltas…",
    "Verifying…",
    kind === "install" ? `Installed ${source.id}` : `Removed ${source.id}`,
  ];

  let percent = 0;
  for (const line of lines) {
    await sleep(2200 / lines.length);
    emit({ appId, kind, phase: "log", line });
    percent = Math.min(96, percent + Math.ceil(96 / lines.length));
    emit({ appId, kind, phase: "progress", percent });
  }

  await sleep(300);

  if (kind === "install") {
    installed.set(key(source.manager, source.id), {
      manager: source.manager,
      id: source.id,
      version: fakeVersion(app),
    });
  } else {
    installed.delete(key(source.manager, source.id));
  }

  emit({ appId, kind, phase: "progress", percent: 100 });
  if (kind === "install") {
    // Mirrors the real backend: apps auto-launch right after installing.
    emit({ appId, kind, phase: "log", line: "Installed — launching now…" });
  }
  emit({ appId, kind, phase: "done" });
}

// ---- backend --------------------------------------------------------------

export const mockBackend: IpcBackend = {
  getPlatform: () => Promise.resolve(PLATFORM),
  getCatalog: () => Promise.resolve(catalog),
  getManagerStatus: () =>
    Promise.resolve<ManagerStatus[]>([
      { manager: "flatpak", available: true, version: "1.15.6" },
    ]),
  detectInstalled: () => Promise.resolve(Array.from(installed.values())),
  installApp: (app, source) => {
    void runOp(app, source, "install");
    return Promise.resolve();
  },
  uninstallApp: (app, source) => {
    void runOp(app, source, "uninstall");
    return Promise.resolve();
  },
  onOpEvent: (cb) => {
    listeners.add(cb);
    return Promise.resolve(() => {
      listeners.delete(cb);
    });
  },
  openExternal: (url) => {
    window.open(url, "_blank", "noopener,noreferrer");
    return Promise.resolve();
  },
  getAppVersion: () => Promise.resolve("dev (browser mock)"),
};
