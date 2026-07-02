// Shared types for the Outfitter frontend.
// These mirror the pinned Tauri IPC contract and the catalog/catalog.json
// schema exactly — do not change shapes without updating the Rust side.

export type Platform = "windows" | "macos" | "linux";

export type Manager = "winget" | "brew" | "brew-cask" | "flatpak";

export interface Source {
  manager: Manager;
  id: string;
  official: boolean;
  note?: string;
}

export interface CatalogCategory {
  id: string;
  name: string;
  icon: string;
  order: number;
}

export interface CatalogApp {
  id: string;
  name: string;
  shortDescription: string;
  description: string;
  category: string;
  homepage: string;
  license: string;
  /** "icons/<id>.png" — files may not exist yet; UI must render a fallback. */
  icon: string;
  tags: string[];
  featured: boolean;
  popularity: number;
  /** Empty array = not available on that platform. First entry is the one used. */
  sources: Record<Platform, Source[]>;
}

export interface Catalog {
  schemaVersion: number;
  catalogVersion: string;
  updatedAt: string;
  categories: CatalogCategory[];
  apps: CatalogApp[];
}

export interface ManagerStatus {
  manager: string;
  available: boolean;
  version: string | null;
}

export interface InstalledPackage {
  manager: string;
  id: string;
  version: string;
}

export type OpKind = "install" | "uninstall";

export type OpPhase = "queued" | "started" | "log" | "progress" | "done" | "failed";

/** Payload emitted by the Rust side on the "op-event" channel. */
export interface OpEvent {
  appId: string;
  kind: OpKind;
  phase: OpPhase;
  /** phase = "log" */
  line?: string;
  /** phase = "progress", 0-100 */
  percent?: number;
  /** phase = "failed" */
  error?: string;
}

/** Derived per-app state that drives every action button in the UI. */
export type InstallState =
  | "not_available"
  | "not_installed"
  | "queued"
  | "installing"
  | "uninstalling"
  | "installed"
  | "failed";

export const OS_LABEL: Record<Platform, string> = {
  windows: "Windows",
  macos: "macOS",
  linux: "Linux",
};

// ---- accounts / profile ----------------------------------------------------

export const WEBSITE_URL = "https://tylersander.github.io/outfitter/";

export interface UserProfile {
  id: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  profilePictureUrl: string | null;
}

export interface Session {
  user: UserProfile;
  accessToken: string;
}

export interface SavedApp {
  id: string;
  name: string;
  url: string | null;
  note: string | null;
  createdAt: string;
}

/** New-saved-app input from the UI (before the backend assigns id/createdAt). */
export interface NewSavedApp {
  name: string;
  url?: string;
  note?: string;
}

/** On-device per-user profile data (display-name override + saved apps). */
export interface Profile {
  displayName: string | null;
  apps: SavedApp[];
}
