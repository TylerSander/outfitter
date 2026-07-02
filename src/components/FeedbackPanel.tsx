import { useMemo, useState } from "react";
import { useStore } from "../store";
import { getAppVersion, openExternal } from "../ipc";
import { OS_LABEL } from "../types";

// Feedback lands as a GitHub issue on TylerSander/outfitter. The app opens a
// prefilled issue-form URL in the browser: no tokens ship in the app, GitHub
// handles identity and spam, and maintainers get structured, labeled issues.
// (A backend submit path for users without GitHub accounts exists in the
// cloud API and takes over once it is deployed.)

const REPO_ISSUES = "https://github.com/TylerSander/outfitter/issues/new";
const DETAIL_CAP = 4000;

type Kind = "bug" | "feature" | "question";

const KIND_META: Record<
  Kind,
  { label: string; template: string; field: string; titleTag: string; prompt: string }
> = {
  bug: {
    label: "Bug",
    template: "bug_report.yml",
    field: "what-happened",
    titleTag: "[bug] ",
    prompt: "What did you do, what did you expect, and what actually happened?",
  },
  feature: {
    label: "Feature",
    template: "feature_request.yml",
    field: "idea",
    titleTag: "[feature] ",
    prompt: "What should Outfitter do, and why would it help?",
  },
  question: {
    label: "Question",
    template: "question.yml",
    field: "question",
    titleTag: "[question] ",
    prompt: "Ask anything about Outfitter.",
  },
};

export default function FeedbackPanel({ onClose }: { onClose: () => void }) {
  const platform = useStore((s) => s.platform);
  const managerStatus = useStore((s) => s.managerStatus);
  const [kind, setKind] = useState<Kind>("bug");
  const [title, setTitle] = useState("");
  const [details, setDetails] = useState("");

  const diagnostics = useMemo(() => {
    const managers = managerStatus
      .map((m) => `${m.manager}: ${m.available ? (m.version ?? "available") : "not found"}`)
      .join("\n");
    return `OS: ${OS_LABEL[platform]}\n${managers}`;
  }, [platform, managerStatus]);

  const canSubmit = title.trim() !== "" && details.trim() !== "";

  const submit = async () => {
    if (!canSubmit) return;
    const meta = KIND_META[kind];
    const version = await getAppVersion();
    const params = new URLSearchParams({
      template: meta.template,
      title: meta.titleTag + title.trim().slice(0, 120),
      [meta.field]: details.trim().slice(0, DETAIL_CAP),
    });
    if (kind === "bug") {
      params.set("diagnostics", `Outfitter ${version}\n${diagnostics}`);
    }
    await openExternal(`${REPO_ISSUES}?${params.toString()}`);
    onClose();
  };

  return (
    <>
      <div
        onClick={onClose}
        aria-hidden="true"
        className="fixed inset-0 z-50 bg-black/60 backdrop-blur-[2px]"
      />
      <div
        role="dialog"
        aria-label="Send feedback"
        className="fixed left-1/2 top-1/2 z-50 w-[30rem] max-w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 border border-hair-amber/50 bg-ink p-6 shadow-2xl shadow-black/60"
      >
        <div className="flex items-baseline justify-between">
          <h2 className="text-[12px] font-bold uppercase tracking-[5px] text-paper-hi">
            Feedback
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="p-1 text-mute transition-colors hover:text-amber-hi"
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
        </div>
        <p className="mt-1.5 font-serif text-xs italic leading-relaxed text-mute">
          Goes straight to the project on GitHub — it finishes there, signed in as you.
        </p>

        <div className="mt-5 flex gap-6">
          {(Object.keys(KIND_META) as Kind[]).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setKind(k)}
              className={`border-b pb-1 text-[10.5px] uppercase tracking-[3px] transition-all ${
                kind === k
                  ? "border-amber text-amber-hi"
                  : "border-transparent text-mute hover:text-paper"
              }`}
            >
              {KIND_META[k].label}
            </button>
          ))}
        </div>

        <label className="mt-5 block">
          <span className="index-label">Title</span>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={120}
            spellCheck={false}
            className="mt-2 w-full border-b border-hair bg-transparent py-1.5 text-[13px] text-paper outline-none transition-colors focus:border-amber"
          />
        </label>

        <label className="mt-5 block">
          <span className="index-label">Details</span>
          <textarea
            value={details}
            onChange={(e) => setDetails(e.target.value)}
            maxLength={DETAIL_CAP}
            rows={5}
            placeholder={KIND_META[kind].prompt}
            className="mt-2 w-full resize-y border border-hair bg-transparent p-2.5 font-serif text-[13px] italic leading-relaxed text-paper outline-none transition-colors placeholder:text-mute/60 focus:border-hair-amber"
          />
        </label>

        {kind === "bug" && (
          <p className="mt-2 font-mono text-[10px] leading-relaxed text-mute/80">
            Attached automatically: {diagnostics.split("\n").join(" · ")}
          </p>
        )}

        <div className="mt-6 flex items-center gap-6">
          <button
            type="button"
            disabled={!canSubmit}
            onClick={() => void submit()}
            className={`border-b pb-1 text-[11px] uppercase tracking-[3px] transition-all ${
              canSubmit
                ? "border-hair-amber text-amber hover:border-amber-hi hover:tracking-[4px] hover:text-amber-hi"
                : "cursor-not-allowed border-transparent text-mute/50"
            }`}
          >
            Open on GitHub →
          </button>
          <button
            type="button"
            onClick={onClose}
            className="border-b border-transparent pb-1 text-[11px] uppercase tracking-[3px] text-mute transition-colors hover:text-paper"
          >
            Cancel
          </button>
        </div>
      </div>
    </>
  );
}
