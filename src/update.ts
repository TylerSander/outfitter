// Self-update via GitHub Releases (Tauri updater plugin).
//
// This is the only file that touches the updater/process plugins. In a plain
// browser (LAN dev via vite) every export no-ops: the plugin packages are
// loaded with dynamic import behind the __TAURI_INTERNALS__ guard, so vite
// splits them into chunks the browser bundle never requests.

export interface AvailableUpdate {
  version: string;
  /** Downloads and stages the update. onProgress gets 0-100, or null when
   *  the feed didn't declare a content length (indeterminate). */
  install: (onProgress: (percent: number | null) => void) => Promise<void>;
}

const inTauri = (): boolean => "__TAURI_INTERNALS__" in window;

export async function checkForUpdate(): Promise<AvailableUpdate | null> {
  if (!inTauri()) return null;
  const { check } = await import("@tauri-apps/plugin-updater");
  const update = await check();
  if (update === null) return null;
  return {
    version: update.version,
    install: async (onProgress) => {
      let total: number | undefined;
      let received = 0;
      await update.downloadAndInstall((event) => {
        if (event.event === "Started") {
          total = event.data.contentLength;
          onProgress(total !== undefined ? 0 : null);
        } else if (event.event === "Progress") {
          received += event.data.chunkLength;
          onProgress(
            total !== undefined && total > 0
              ? Math.min(100, Math.round((received / total) * 100))
              : null,
          );
        } else if (event.event === "Finished") {
          onProgress(100);
        }
      });
    },
  };
}

/** Restart into the freshly installed version. */
export async function relaunchApp(): Promise<void> {
  if (!inTauri()) return;
  const { relaunch } = await import("@tauri-apps/plugin-process");
  await relaunch();
}
