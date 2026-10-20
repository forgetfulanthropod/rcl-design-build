import { useEffect, useRef, useState } from "react";
import { entryStamp, sortEntries, takenLabel, type ReportEntry } from "@/lib/report-entries";
import { preparePhoto } from "@/lib/photo-prepare";
import { tooLargeMessage } from "@/lib/photo-upload";
import { ReportPdfButton } from "@/components/report-pdf-button";
import { PDF_OFF_HINT } from "@/lib/report-pdf-download";
import { lunchStepScroll } from "@/lib/lunch-step";
import { addMyPhoto, getMyReport, saveMyReport, submitMyReport } from "@/lib/server/fns";
import { LunchDial } from "@/components/lunch-dial";
import { ErrorBanner, Skeleton } from "@/components/ui";
import { PhotoThumb } from "@/components/photo-thumb";
import { YoureOnCard } from "@/components/crew-view";
import { currentJobId, rememberJob } from "@/lib/use-current-job";

type Loaded = Awaited<ReturnType<typeof getMyReport>>;
type Report = Loaded["report"];

/** The worker's local calendar day (not UTC). */
export function localDay(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function clock(isoValue: string | null): string {
  if (!isoValue) return "—";
  return new Date(isoValue).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

export function longDay(day: string): string {
  return new Date(`${day}T12:00:00`).toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" });
}

const MENU_ITEM = "flex h-16 flex-col items-center justify-center gap-1 rounded-md bg-surface text-base font-medium text-fg";
const TAKEN_FMT = {
  clock: (v: string) => clock(v),
  dayKey: (v: string) => localDay(new Date(v)),
  shortDay: (v: string) => new Date(v).toLocaleDateString([], { month: "short", day: "numeric" }),
};

type Pending = { key: string; preview: string; state: "uploading" | "failed"; file: File; addedAt: string };

/**
 * The editor's own state, kept in a ref as well as React state so a save that finishes while
 * another is queued always sees the latest text (no duplicate entries).
 * - texts/saved: the editor's and the server's text, by entry id
 * - drafts: new text not saved yet (each becomes an entry on its first save)
 * - keyOf: a saved draft keeps its React key, so its field (and the keyboard) stays put
 */
type Editor = {
  texts: Record<string, string>;
  saved: Record<string, string>;
  drafts: { key: string; body: string }[];
  keyOf: Record<string, string>;
  projectId: string;
  savedProjectId: string;
};
const EMPTY: Editor = { texts: {}, saved: {}, drafts: [], keyOf: {}, projectId: "", savedProjectId: "" };
let draftSeq = 0;
const newKey = () => `draft-${Date.now().toString(36)}-${(draftSeq += 1)}`;

/** Merge a server report into the editor without losing anything typed since it was sent. */
function merge(
  prev: Editor,
  report: Report,
  sent: { texts: Record<string, string>; keys: Record<string, string>; projectId?: string } | null,
): Editor {
  const textEntries = report.entries.filter((e) => e.kind === "text");
  const created = new Map(Object.entries(sent?.keys ?? {}).map(([key, id]) => [id, key]));
  const texts: Record<string, string> = {};
  const saved: Record<string, string> = {};
  const keyOf: Record<string, string> = {};
  for (const e of textEntries) {
    saved[e.id] = e.body;
    const draftKey = created.get(e.id);
    if (draftKey) {
      const draft = prev.drafts.find((d) => d.key === draftKey);
      texts[e.id] = draft ? draft.body : e.body;
      keyOf[e.id] = draftKey;
      continue;
    }
    keyOf[e.id] = prev.keyOf[e.id] ?? e.id;
    const local = prev.texts[e.id];
    const base = sent?.texts[e.id] ?? prev.saved[e.id];
    texts[e.id] = local !== undefined && local !== base ? local : e.body;
  }
  let drafts = prev.drafts.filter((d) => !Object.prototype.hasOwnProperty.call(sent?.keys ?? {}, d.key));
  // An empty report starts with one blank note so the worker can just type.
  if (!report.submittedAt && textEntries.length === 0 && drafts.length === 0) drafts = [{ key: newKey(), body: "" }];
  if (report.submittedAt) drafts = [];
  const serverProject = report.projectId ?? "";
  const projectSent = sent?.projectId;
  const projectId =
    prev.projectId !== (projectSent ?? prev.savedProjectId) ? prev.projectId : serverProject;
  return { texts, saved, drafts, keyOf, projectId, savedProjectId: serverProject };
}

function isDirty(ed: Editor): boolean {
  return (
    ed.projectId !== ed.savedProjectId ||
    Object.keys(ed.texts).some((id) => ed.texts[id] !== ed.saved[id]) ||
    ed.drafts.some((d) => d.body.trim() !== "")
  );
}

export function TodayReport() {
  const day = localDay();
  const [report, setReport] = useState<Report | null>(null);
  const [jobs, setJobs] = useState<Loaded["jobs"]>([]);
  const [ed, setEd] = useState<Editor>(EMPTY);
  const edRef = useRef<Editor>(EMPTY);
  const update = (fn: (prev: Editor) => Editor) => {
    edRef.current = fn(edRef.current);
    setEd(edRef.current);
  };
  const [pending, setPending] = useState<Pending[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const plusRef = useRef<HTMLButtonElement>(null);
  const firstItem = useRef<HTMLButtonElement>(null);
  const photoInput = useRef<HTMLInputElement>(null);
  const cameraInput = useRef<HTMLInputElement>(null);
  const saving = useRef<Promise<void>>(Promise.resolve());
  const [askLunch, setAskLunch] = useState(false);
  const lunchStep = useRef<HTMLElement>(null);
  // The lunch step opens below the fold on desktop: bring it into view and put the keyboard on the dial.
  useEffect(() => {
    const section = lunchStep.current;
    if (!askLunch || !section) return;
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    section.scrollIntoView(lunchStepScroll(reduced));
    section.querySelector<HTMLElement>('[role="slider"]')?.focus({ preventScroll: true });
  }, [askLunch]);
  const [lunch, setLunch] = useState(30);
  useEffect(() => {
    if (menuOpen) firstItem.current?.focus();
  }, [menuOpen]);
  useEffect(() => {
    if (!focusKey) return;
    document.querySelector<HTMLTextAreaElement>(`[data-entry-key="${focusKey}"] textarea`)?.focus();
    setFocusKey(null);
  }, [focusKey]);

  function apply(next: Loaded, sent: Parameters<typeof merge>[2] = null) {
    setReport(next.report);
    setJobs(next.jobs);
    update((prev) => merge(prev, next.report, sent));
    // A report with no job yet starts on the current job (spec 05 · F3). It's stored with the
    // first save, so opening Today doesn't make the report dirty.
    if (!next.report.projectId && !next.report.submittedAt && next.jobs.length) {
      void currentJobId()
        .then((id) => {
          if (!id || !next.jobs.some((j) => j.id === id)) return;
          update((value) =>
            value.projectId || value.savedProjectId ? value : { ...value, projectId: id, savedProjectId: id },
          );
        })
        .catch(() => undefined);
    }
  }

  useEffect(() => {
    getMyReport({ data: { day } })
      .then((next) => apply(next))
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "Could not open today's report."));
    // Load once per day; apply only writes state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [day]);

  const dirty = isDirty(ed);

  async function upload(file: File, key: string) {
    try {
      const photo = await preparePhoto(file);
      const next = await addMyPhoto({
        data: {
          day,
          image: photo.image,
          thumb: photo.thumb,
          width: photo.width,
          height: photo.height,
          // Only the camera's own time (EXIF); a file's modified date is often just when it was copied.
          takenAt: photo.takenAt ?? "",
        },
      });
      setPending((list) => list.filter((p) => p.key !== key));
      apply(next);
    } catch (cause) {
      setPending((list) => list.map((p) => (p.key === key ? { ...p, state: "failed" } : p)));
      setError(cause instanceof Error ? cause.message : "Upload failed. Tap the photo to retry.");
    }
  }

  function addFiles(files: FileList | null) {
    if (!files) return;
    setError("");
    for (const file of Array.from(files)) {
      const big = tooLargeMessage(file.size);
      if (big) {
        setError(big);
        continue;
      }
      const key = `${file.name}-${file.size}-${Math.random()}`;
      setPending((list) => [
        ...list,
        { key, preview: URL.createObjectURL(file), state: "uploading", file, addedAt: new Date().toISOString() },
      ]);
      void upload(file, key);
    }
  }

  /** Saves are queued, one at a time, each sending what's on screen when it starts. */
  function save(): Promise<void> {
    saving.current = saving.current.then(async () => {
      const now = edRef.current;
      if (!isDirty(now) || report?.submittedAt) return;
      const texts: Record<string, string> = {};
      const edits = [
        ...Object.keys(now.texts)
          .filter((id) => now.texts[id] !== now.saved[id])
          .map((id) => {
            texts[id] = now.texts[id];
            return { id, key: id, body: now.texts[id] };
          }),
        ...now.drafts.filter((d) => d.body.trim()).map((d) => ({ id: null, key: d.key, body: d.body })),
      ];
      setBusy(true);
      try {
        const next = await saveMyReport({ data: { day, texts: edits, projectId: now.projectId } });
        apply(next, { texts, keys: next.keys, projectId: now.projectId });
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Could not save.");
      } finally {
        setBusy(false);
      }
    });
    return saving.current;
  }

  function addText() {
    setMenuOpen(false);
    const key = newKey();
    update((prev) => ({ ...prev, drafts: [...prev.drafts, { key, body: "" }] }));
    setFocusKey(key);
  }

  if (!report) {
    return error ? <ErrorBanner message={error} /> : <Skeleton lines={5} label="Opening today's report" />;
  }
  const submitted = Boolean(report.submittedAt);
  const photos = report.photos.length;
  const thumbs = new Map(report.photos.map((p) => [p.id, p.thumb]));
  const takenAt = new Map(report.photos.map((p) => [p.id, p.takenAt]));
  const hasText =
    Object.values(ed.texts).some((t) => t.trim()) || ed.drafts.some((d) => d.body.trim());

  type Row =
    | { type: "entry"; key: string; entry: ReportEntry }
    | { type: "draft"; key: string; body: string }
    | { type: "pending"; key: string; pending: Pending };
  const rows: Row[] = [
    ...sortEntries(report.entries).map((entry) => ({
      type: "entry" as const,
      key: entry.kind === "text" ? (ed.keyOf[entry.id] ?? entry.id) : entry.id,
      entry,
    })),
    ...pending.map((p) => ({ type: "pending" as const, key: p.key, pending: p })),
    ...ed.drafts.map((d) => ({ type: "draft" as const, key: d.key, body: d.body })),
  ];
  // The first text field keeps the id "narrative" ("Your day"), as before entries.
  const firstTextKey = rows.find((r) => r.type === "draft" || (r.type === "entry" && r.entry.kind === "text"))?.key;

  function textField(key: string, value: string, label: string, onChange: (v: string) => void) {
    return (
      <textarea
        id={key === firstTextKey ? "narrative" : `entry-${key}`}
        aria-label={label}
        className="field mt-1 min-h-28 text-base leading-relaxed [field-sizing:content]"
        placeholder={key === firstTextKey ? "Set the base cabinets on the east wall. Two boxes came damaged…" : "Add a note…"}
        value={value}
        disabled={submitted}
        onChange={(e) => onChange(e.target.value)}
        onBlur={() => void save()}
      />
    );
  }

  return (
    <div className="mx-auto grid max-w-xl gap-4" data-testid="today-report">
      <YoureOnCard />
      <section className="rounded-md border border-line bg-surface p-4">
        <p className="text-sm font-medium uppercase tracking-widest text-copper">Daily report</p>
        <h2 className="mt-1 text-2xl">{longDay(day)}</h2>
        <dl className="mt-3 grid grid-cols-3 gap-2 text-base">
          <div>
            <dt className="text-sm text-muted">First edit</dt>
            <dd data-testid="first-edit" className="tabular-nums">{clock(report.firstEditAt)}</dd>
          </div>
          <div>
            <dt className="text-sm text-muted">Last edit</dt>
            <dd data-testid="last-edit" className="tabular-nums">{clock(report.lastEditAt)}</dd>
          </div>
          <div>
            <dt className="text-sm text-muted">Lunch</dt>
            <dd data-testid="lunch-saved" className="tabular-nums">
              {report.lunchMinutes == null ? "—" : `${report.lunchMinutes} min`}
            </dd>
          </div>
        </dl>
        {submitted ? (
          <p className="mt-3 rounded-md bg-raised p-3 text-base text-fg" role="status">
            ✓ Submitted at {clock(report.submittedAt)}
          </p>
        ) : null}
        {report.canPdf ? (
          <ReportPdfButton className="mt-3" target={{ day }} before={() => save()} />
        ) : (
          <p className="mt-3 text-sm text-muted" data-testid="pdf-off">
            {PDF_OFF_HINT}
          </p>
        )}
      </section>

      <section className="rounded-md border border-line bg-surface p-4" aria-labelledby="your-day">
        <h3 id="your-day" className="text-xl">
          Your day
        </h3>
        <p className="mt-1 text-base text-muted">
          {photos === 0 ? "Start with a photo of your work area." : `${photos} photo${photos === 1 ? "" : "s"} saved.`}{" "}
          Add notes and photos as the day goes; each one is time-stamped.
        </p>
        <ol className="mt-3 grid gap-3" aria-label="Report entries" data-testid="entries">
          {rows.map((row) => {
            if (row.type === "pending") {
              const p = row.pending;
              return (
                <li key={row.key} data-testid="entry" data-kind="photo" data-pending="true">
                  <p className="text-sm text-muted tabular-nums">{clock(p.addedAt)}</p>
                  <button
                    type="button"
                    className="relative mt-1 block w-40"
                    disabled={p.state === "uploading"}
                    aria-label={p.state === "failed" ? "Upload failed, tap to retry" : "Uploading photo"}
                    onClick={() => {
                      setPending((list) => list.map((x) => (x.key === p.key ? { ...x, state: "uploading" } : x)));
                      void upload(p.file, p.key);
                    }}
                  >
                    <img src={p.preview} alt="" className="aspect-square w-full rounded-md object-cover opacity-50" />
                    <span className="absolute inset-0 grid place-items-center text-sm font-medium text-fg">
                      {p.state === "failed" ? "⟳ Retry" : "Uploading…"}
                    </span>
                  </button>
                </li>
              );
            }
            if (row.type === "draft") {
              return (
                <li key={row.key} data-testid="entry" data-kind="text" data-entry-key={row.key} data-draft="true">
                  <p className="text-sm text-muted" data-testid="entry-time">
                    New note
                  </p>
                  {textField(row.key, row.body, "New note", (v) =>
                    update((prev) => ({ ...prev, drafts: prev.drafts.map((d) => (d.key === row.key ? { ...d, body: v } : d)) })),
                  )}
                </li>
              );
            }
            const e = row.entry;
            const taken = e.kind === "photo" ? takenLabel(takenAt.get(e.photoId ?? ""), e.createdAt, TAKEN_FMT) : "";
            const stamp = entryStamp(e, (v) => clock(v)) + (taken ? ` · ${taken}` : "");
            return (
              <li key={row.key} data-testid="entry" data-kind={e.kind} data-entry-key={row.key} data-entry-id={e.id}>
                <p className="text-sm text-muted tabular-nums" data-testid="entry-time">
                  {stamp}
                </p>
                {e.kind === "text" ? (
                  textField(row.key, ed.texts[e.id] ?? e.body, `Note, ${stamp}`, (v) =>
                    update((prev) => ({ ...prev, texts: { ...prev.texts, [e.id]: v } })),
                  )
                ) : (
                  <div className="mt-1 w-40">
                    <PhotoThumb id={e.photoId ?? ""} thumb={thumbs.get(e.photoId ?? "") ?? ""} alt={`Work photo ${clock(e.createdAt)}`} />
                  </div>
                )}
              </li>
            );
          })}
        </ol>

        {/* Library: no `capture`, so phones offer their photo library (several at once). Camera: a new photo. */}
        <input
          ref={photoInput}
          type="file"
          accept="image/*,.heic,.heif"
          multiple
          className="sr-only"
          tabIndex={-1}
          aria-hidden="true"
          data-testid="photo-input"
          onChange={(e) => {
            addFiles(e.target.files);
            e.target.value = "";
          }}
        />
        <input
          ref={cameraInput}
          type="file"
          accept="image/*"
          capture="environment"
          className="sr-only"
          tabIndex={-1}
          aria-hidden="true"
          data-testid="camera-input"
          onChange={(e) => {
            addFiles(e.target.files);
            e.target.value = "";
          }}
        />
        {!submitted ? (
          // Sticks above the phone tab bar so the plus stays under the thumb while scrolling.
          <div className="sticky bottom-[calc(5rem+env(safe-area-inset-bottom))] z-20 mt-4 md:bottom-4" data-testid="add-bar">
            {menuOpen ? (
              <div
                role="menu"
                aria-label="Add to report"
                className="mb-2 grid grid-cols-3 gap-2 rounded-md border border-line bg-raised p-2 shadow-lg"
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    setMenuOpen(false);
                    plusRef.current?.focus();
                  }
                }}
              >
                <button
                  ref={firstItem}
                  type="button"
                  role="menuitem"
                  className={MENU_ITEM}
                  onClick={addText}
                >
                  <span aria-hidden="true" className="text-2xl leading-none">✎</span> Text
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className={MENU_ITEM}
                  onClick={() => {
                    setMenuOpen(false);
                    cameraInput.current?.click();
                  }}
                >
                  <span aria-hidden="true" className="text-2xl leading-none">📷</span> Camera
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className={MENU_ITEM}
                  onClick={() => {
                    setMenuOpen(false);
                    photoInput.current?.click();
                  }}
                >
                  <span aria-hidden="true" className="text-2xl leading-none">🖼</span> Library
                </button>
              </div>
            ) : null}
            <button
              ref={plusRef}
              type="button"
              aria-label="Add text or photo"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              className="flex h-14 w-full items-center justify-center gap-2 rounded-full bg-copper text-lg font-medium text-ink shadow-lg focus-visible:ring-4 focus-visible:ring-copper/60"
              onClick={() => setMenuOpen((v) => !v)}
            >
              <span aria-hidden="true" className="text-3xl leading-none">
                {menuOpen ? "×" : "+"}
              </span>
              <span aria-hidden="true">{menuOpen ? "Close" : "Add"}</span>
            </button>
          </div>
        ) : null}

        {jobs.length > 0 ? (
          <>
            <label htmlFor="report-job" className="mt-4 block text-sm text-muted">
              Job (optional)
            </label>
            <select
              id="report-job"
              className="field mt-1"
              value={ed.projectId}
              disabled={submitted}
              onChange={(e) => {
                const value = e.target.value;
                update((prev) => ({ ...prev, projectId: value }));
                rememberJob(value);
              }}
              onBlur={() => void save()}
            >
              <option value="">No job</option>
              {jobs.map((j) => (
                <option key={j.id} value={j.id}>
                  {j.name}
                </option>
              ))}
            </select>
          </>
        ) : null}
        {!submitted ? (
          <button
            type="button"
            className="mt-3 h-14 w-full rounded-md border border-line bg-raised text-lg text-fg disabled:opacity-60"
            disabled={busy || !dirty}
            onClick={() => void save()}
          >
            {!dirty ? "Saved" : busy ? "Saving…" : "Save"}
          </button>
        ) : null}
      </section>

      {error ? <ErrorBanner message={error} onRetry={() => setError("")} /> : null}

      {!submitted ? (
        <section ref={lunchStep} className="scroll-mb-24 rounded-md border border-line bg-surface p-4" data-testid="submit-step">
          {askLunch ? (
            <div className="grid gap-4">
              <h3 className="text-xl">How long was lunch?</h3>
              <LunchDial value={lunch} onChange={setLunch} />
              <button
                type="button"
                className="h-14 w-full rounded-md bg-copper text-lg font-medium text-ink disabled:opacity-60"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  setError("");
                  try {
                    await save();
                    apply(await submitMyReport({ data: { day, lunchMinutes: lunch } }));
                    setAskLunch(false);
                  } catch (cause) {
                    setError(cause instanceof Error ? cause.message : "Could not submit.");
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Submit with {lunch} min lunch
              </button>
              <button type="button" className="h-12 text-base text-muted underline" onClick={() => setAskLunch(false)}>
                Not yet
              </button>
            </div>
          ) : (
            <button
              type="button"
              className="h-14 w-full rounded-md bg-copper text-lg font-medium text-ink disabled:opacity-60"
              disabled={!hasText}
              onClick={() => setAskLunch(true)}
            >
              {hasText ? "Submit my day" : "Write about your day to submit"}
            </button>
          )}
        </section>
      ) : null}
    </div>
  );
}
