import type { InstallState, OpKind, Platform } from "../types";
import { OS_LABEL } from "../types";

// Single source of truth for the install-state -> button mapping.

interface StateButtonProps {
  state: InstallState;
  platform: Platform;
  /** Kind of the failed op — decides what "Retry" re-runs. */
  failedKind?: OpKind;
  size?: "sm" | "lg";
  onInstall: () => void;
  onUninstall: () => void;
}

type Intent = "primary" | "busy" | "quiet" | "warning" | "disabled";

interface ButtonConfig {
  label: string;
  spinner: boolean;
  disabled: boolean;
  intent: Intent;
}

function configFor(state: InstallState, platform: Platform): ButtonConfig {
  switch (state) {
    case "not_available":
      return {
        label: `Not on ${OS_LABEL[platform]}`,
        spinner: false,
        disabled: true,
        intent: "disabled",
      };
    case "not_installed":
      return { label: "Install", spinner: false, disabled: false, intent: "primary" };
    case "queued":
      return { label: "Queued", spinner: true, disabled: true, intent: "busy" };
    case "installing":
      return { label: "Installing", spinner: true, disabled: true, intent: "busy" };
    case "uninstalling":
      return { label: "Removing", spinner: true, disabled: true, intent: "busy" };
    case "installed":
      return { label: "Uninstall", spinner: false, disabled: false, intent: "quiet" };
    case "failed":
      return { label: "Retry", spinner: false, disabled: false, intent: "warning" };
  }
}

const INTENT_CLASSES: Record<Intent, string> = {
  primary: "bg-sky-600 text-white hover:bg-sky-500 active:bg-sky-600",
  busy: "bg-slate-800 text-slate-300",
  quiet:
    "border border-slate-700 bg-transparent text-slate-300 hover:border-red-800/80 hover:bg-red-950/40 hover:text-red-300",
  warning: "bg-amber-600 text-white hover:bg-amber-500",
  disabled: "bg-slate-800/60 text-slate-500",
};

export default function StateButton({
  state,
  platform,
  failedKind,
  size = "sm",
  onInstall,
  onUninstall,
}: StateButtonProps) {
  const cfg = configFor(state, platform);
  const sizeClasses =
    size === "lg"
      ? "w-full justify-center px-5 py-2.5 text-sm font-semibold"
      : "px-3 py-1.5 text-xs font-medium";

  return (
    <button
      type="button"
      disabled={cfg.disabled}
      onClick={(e) => {
        e.stopPropagation();
        if (cfg.disabled) return;
        if (state === "installed") onUninstall();
        else if (state === "failed" && failedKind === "uninstall") onUninstall();
        else onInstall();
      }}
      className={`inline-flex shrink-0 select-none items-center gap-1.5 whitespace-nowrap rounded-lg transition-colors disabled:cursor-not-allowed ${sizeClasses} ${INTENT_CLASSES[cfg.intent]}`}
    >
      {cfg.spinner && <Spinner />}
      {cfg.label}
    </button>
  );
}

function Spinner() {
  return (
    <svg
      className="h-3.5 w-3.5 animate-spin"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        d="M12 2a10 10 0 0 1 10 10"
        stroke="currentColor"
        strokeWidth="4"
        strokeLinecap="round"
      />
    </svg>
  );
}
