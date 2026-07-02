import { useEffect, useState } from "react";
import { useStore } from "../store";
import { openExternal } from "../ipc";
import { WEBSITE_URL, type SavedApp } from "../types";

// Signed-in profile: identity, an editable display name, a link out to the
// hosted account page (email/password live in WorkOS), and the user's own
// saved apps. Saved apps persist on-device tied to the account until cloud
// sync ships.

export default function Profile() {
  const session = useStore((s) => s.session);
  const profile = useStore((s) => s.profile);
  const loadProfile = useStore((s) => s.loadProfile);
  const logout = useStore((s) => s.logout);

  useEffect(() => {
    if (session !== null && profile === null) void loadProfile();
  }, [session, profile, loadProfile]);

  if (session === null) return null;
  const { user } = session;

  const fullName = [user.firstName, user.lastName].filter(Boolean).join(" ");
  const shownName = profile?.displayName || fullName || user.email || "Your account";
  const initial = (shownName || "?").charAt(0).toUpperCase();

  return (
    <div className="flex max-w-2xl flex-col gap-9">
      {/* identity */}
      <section className="flex items-center gap-4">
        {user.profilePictureUrl ? (
          <img
            src={user.profilePictureUrl}
            alt=""
            className="h-16 w-16 rounded-sm border border-hair object-cover"
          />
        ) : (
          <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-sm border border-hair bg-ink-2 font-serif text-2xl italic text-amber">
            {initial}
          </div>
        )}
        <div className="min-w-0">
          <h2 className="truncate text-xl font-bold uppercase tracking-[2px] text-paper-hi">
            {shownName}
          </h2>
          {user.email !== null && (
            <p className="mt-1 truncate font-mono text-[11px] tracking-[1px] text-mute">
              {user.email}
            </p>
          )}
        </div>
      </section>

      <DisplayNameEditor initial={profile?.displayName ?? ""} />

      {/* account actions */}
      <section className="flex flex-wrap items-center gap-x-8 gap-y-3">
        <button
          type="button"
          onClick={() => void openExternal(WEBSITE_URL)}
          className="border-b border-hair-amber pb-1 text-[10.5px] uppercase tracking-[3px] text-amber transition-all hover:border-amber-hi hover:tracking-[4px] hover:text-amber-hi"
        >
          Manage account (email, password) ↗
        </button>
        <button
          type="button"
          onClick={() => void logout()}
          className="border-b border-hair pb-1 text-[10.5px] uppercase tracking-[3px] text-mute transition-colors hover:border-coral/60 hover:text-coral"
        >
          Sign out
        </button>
      </section>

      <SavedApps />
    </div>
  );
}

function DisplayNameEditor({ initial }: { initial: string }) {
  const setDisplayName = useStore((s) => s.setDisplayName);
  const profileBusy = useStore((s) => s.profileBusy);
  const [value, setValue] = useState(initial);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setValue(initial);
  }, [initial]);

  const dirty = value.trim() !== initial.trim();

  const save = async () => {
    await setDisplayName(value.trim() === "" ? null : value.trim());
    setSaved(true);
    window.setTimeout(() => setSaved(false), 1800);
  };

  return (
    <section>
      <p className="index-label mb-3">Display name</p>
      <div className="flex items-center gap-4">
        <input
          type="text"
          value={value}
          maxLength={200}
          onChange={(e) => setValue(e.target.value)}
          placeholder="How your name shows in Outfitter"
          className="w-full max-w-sm border-b border-hair bg-transparent py-1.5 text-[13px] text-paper outline-none transition-colors placeholder:text-mute/60 focus:border-amber"
        />
        <button
          type="button"
          disabled={!dirty || profileBusy}
          onClick={() => void save()}
          className={`shrink-0 border-b pb-1 text-[10.5px] uppercase tracking-[3px] transition-all ${
            dirty && !profileBusy
              ? "border-hair-amber text-amber hover:text-amber-hi"
              : "border-transparent text-mute/50"
          }`}
        >
          {saved ? "Saved ✓" : "Save"}
        </button>
      </div>
    </section>
  );
}

function SavedApps() {
  const profile = useStore((s) => s.profile);
  const addSavedApp = useStore((s) => s.addSavedApp);
  const removeSavedApp = useStore((s) => s.removeSavedApp);
  const profileBusy = useStore((s) => s.profileBusy);
  const profileError = useStore((s) => s.profileError);

  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [note, setNote] = useState("");

  const apps: SavedApp[] = profile?.apps ?? [];
  const canAdd = name.trim() !== "" && !profileBusy;

  const add = async () => {
    if (!canAdd) return;
    await addSavedApp({
      name: name.trim(),
      url: url.trim() || undefined,
      note: note.trim() || undefined,
    });
    setName("");
    setUrl("");
    setNote("");
  };

  return (
    <section>
      <p className="index-label mb-1">My saved apps</p>
      <p className="mb-4 font-serif text-[11.5px] italic text-mute">
        Apps and links you want to remember for your next machine. Saved on this
        device, tied to your account.
      </p>

      {/* add form */}
      <div className="flex flex-col gap-3 border border-hair p-4">
        <div className="flex flex-wrap gap-3">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="App name *"
            maxLength={200}
            className="min-w-[10rem] flex-1 border-b border-hair bg-transparent py-1.5 text-[13px] text-paper outline-none placeholder:text-mute/60 focus:border-amber"
          />
          <input
            type="text"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="Link (optional)"
            maxLength={2048}
            className="min-w-[10rem] flex-1 border-b border-hair bg-transparent py-1.5 text-[13px] text-paper outline-none placeholder:text-mute/60 focus:border-amber"
          />
        </div>
        <input
          type="text"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Note (optional)"
          maxLength={2000}
          className="w-full border-b border-hair bg-transparent py-1.5 text-[13px] text-paper outline-none placeholder:text-mute/60 focus:border-amber"
        />
        <div className="flex items-center gap-4">
          <button
            type="button"
            disabled={!canAdd}
            onClick={() => void add()}
            className={`border-b pb-1 text-[10.5px] uppercase tracking-[3px] transition-all ${
              canAdd
                ? "border-hair-amber text-amber hover:tracking-[4px] hover:text-amber-hi"
                : "border-transparent text-mute/50"
            }`}
          >
            Add to my apps
          </button>
          {profileError !== null && (
            <span className="font-serif text-[11px] italic text-coral">{profileError}</span>
          )}
        </div>
      </div>

      {/* list */}
      {apps.length === 0 ? (
        <p className="mt-6 border border-dashed border-hair px-6 py-10 text-center font-serif text-sm italic text-mute">
          Nothing saved yet. Add an app above and it'll be waiting here next time.
        </p>
      ) : (
        <ul className="mt-5 flex flex-col">
          {apps.map((a) => (
            <li
              key={a.id}
              className="group flex items-start justify-between gap-4 border-b border-hair py-3"
            >
              <div className="min-w-0">
                <p className="text-[13.5px] font-bold tracking-[0.5px] text-paper-hi">{a.name}</p>
                {a.url !== null && (
                  <button
                    type="button"
                    onClick={() => void openExternal(a.url as string)}
                    className="mt-0.5 block max-w-full truncate text-[11px] text-amber/90 transition-colors hover:text-amber-hi"
                  >
                    {a.url}
                  </button>
                )}
                {a.note !== null && (
                  <p className="mt-0.5 font-serif text-[12px] italic text-mute">{a.note}</p>
                )}
              </div>
              <button
                type="button"
                onClick={() => void removeSavedApp(a.id)}
                aria-label={`Remove ${a.name}`}
                className="shrink-0 p-1 text-mute opacity-0 transition-opacity hover:text-coral group-hover:opacity-100"
              >
                <svg
                  className="h-4 w-4"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  aria-hidden="true"
                >
                  <path d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
