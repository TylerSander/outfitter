import type { InstallState, OpKind, Platform } from "../types";
import { OS_LABEL } from "../types";

// Single source of truth for the install-state -> button mapping.
// Observatory language: letterspaced caps over a hairline, no filled pills.

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
  primary:
    "border-b border-hair-amber text-amber hover:border-amber-hi hover:text-amber-hi",
  busy: "obs-busy border-b border-hair-amber text-amber",
  quiet: "border-b border-hair text-mute hover:border-coral/60 hover:text-coral",
  warning: "border-b border-coral/60 text-coral hover:text-paper-hi",
  disabled: "border-b border-transparent text-mute/50",
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
      ? "w-full justify-center px-4 pb-2 pt-2.5 text-[12px] tracking-[5px]"
      : "px-1 pb-1 pt-1 text-[10.5px] tracking-[3px]";

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
      className={`inline-flex shrink-0 select-none items-center gap-2 whitespace-nowrap bg-transparent uppercase transition-all duration-200 disabled:cursor-not-allowed ${sizeClasses} ${INTENT_CLASSES[cfg.intent]}`}
    >
      {cfg.spinner && <Spinner />}
      {cfg.label}
    </button>
  );
}

function Spinner() {
  return (
    <svg
      className="h-3 w-3 animate-spin"
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
        strokeWidth="3"
      />
      <path
        d="M12 2a10 10 0 0 1 10 10"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}
