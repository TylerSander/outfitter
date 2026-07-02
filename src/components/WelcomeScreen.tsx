import { useStore } from "../store";
import { openExternal } from "../ipc";
import { WEBSITE_URL } from "../types";

// First-run gate — but a soft one. Outfitter works fully without an account
// (browse + install), so this offers sign-in and account creation without
// blocking the app. Account CREATION happens on the website; sign-in happens
// in-app via the system browser (WelcomeScreen just kicks off store.login()).

export default function WelcomeScreen() {
  const login = useStore((s) => s.login);
  const closeWelcome = useStore((s) => s.closeWelcome);
  const authBusy = useStore((s) => s.authBusy);
  const authError = useStore((s) => s.authError);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/95 px-6">
      <div className="w-full max-w-md text-center">
        <div className="mb-2 flex items-center justify-center gap-2.5">
          <Compass />
          <span className="text-[15px] font-bold uppercase tracking-[7px] text-paper-hi">
            Outfitter
          </span>
        </div>
        <p className="font-serif text-sm italic text-mute">
          fits out <span className="text-amber">your machine</span>
        </p>

        <div className="divider-glint mx-auto my-8 w-40" />

        <p className="mx-auto max-w-sm font-serif text-[15px] italic leading-relaxed text-paper/90">
          Sign in to save your links and the apps you want on your next machine —
          they follow you to every computer. Or keep browsing; Outfitter works
          without an account.
        </p>

        <div className="mt-9 flex flex-col items-center gap-5">
          <button
            type="button"
            disabled={authBusy}
            onClick={() => void login()}
            className="inline-flex items-center gap-2 border-b border-hair-amber pb-1.5 text-[13px] uppercase tracking-[5px] text-amber transition-all hover:border-amber-hi hover:tracking-[6px] hover:text-amber-hi disabled:opacity-50"
          >
            {authBusy ? "Opening browser…" : "Log in"}
          </button>
          <button
            type="button"
            disabled={authBusy}
            onClick={() => void openExternal(WEBSITE_URL)}
            className="border-b border-hair pb-1 text-[11px] uppercase tracking-[4px] text-paper transition-colors hover:border-hair-amber hover:text-amber disabled:opacity-50"
          >
            Create account ↗
          </button>
          <button
            type="button"
            onClick={closeWelcome}
            className="mt-2 border-b border-transparent pb-1 text-[10.5px] uppercase tracking-[3px] text-mute transition-colors hover:text-paper"
          >
            Keep browsing
          </button>
        </div>

        {authError !== null && (
          <p className="mx-auto mt-6 max-w-sm font-serif text-xs italic leading-relaxed text-coral">
            {authError}
          </p>
        )}

        <p className="mt-8 text-[9.5px] uppercase tracking-[2px] text-mute/70">
          Sign-in opens your browser · powered by WorkOS
        </p>
      </div>
    </div>
  );
}

function Compass() {
  return (
    <svg
      className="h-6 w-6 text-amber"
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
