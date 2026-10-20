import { useEffect, useRef, useState } from "react";
import { lunchStepScroll } from "@/lib/lunch-step";
import { addMyPhoto, getMyReport, saveMyReport, submitMyReport } from "@/lib/server/fns";
import { LunchDial } from "@/components/lunch-dial";
import { ErrorBanner, Skeleton } from "@/components/ui";
import { PhotoThumb } from "@/components/photo-thumb";
import { currentJobId, rememberJob } from "@/lib/use-current-job";
import { YoureOnCard } from "@/components/crew-view";

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

async function loadImage(file: File): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.src = url;
  await img.decode();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return img;
}

/** Client-side downscale so uploads stay small on bad signal. */
function scaled(img: HTMLImageElement, max: number, quality: number) {
  const ratio = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(1, Math.round(img.naturalWidth * ratio));
  const h = Math.max(1, Math.round(img.naturalHeight * ratio));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  canvas.getContext("2d")!.drawImage(img, 0, 0, w, h);
  return { url: canvas.toDataURL("image/jpeg", quality), w, h };
}

type Pending = { key: string; preview: string; state: "uploading" | "failed"; file: File };

export function TodayReport() {
  const day = localDay();
  const [report, setReport] = useState<Report | null>(null);
  const [jobs, setJobs] = useState<Loaded["jobs"]>([]);
  const [narrative, setNarrative] = useState("");
  const [projectId, setProjectId] = useState("");
  const [saved, setSaved] = useState({ narrative: "", projectId: "" });
  const [pending, setPending] = useState<Pending[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
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

  function apply(next: Loaded) {
    setReport(next.report);
    setJobs(next.jobs);
    setNarrative(next.report.narrative);
    setProjectId(next.report.projectId ?? "");
    setSaved({ narrative: next.report.narrative, projectId: next.report.projectId ?? "" });
    // A report with no job yet starts on the current job (spec 05 · F3). It's stored with the
    // first save, so opening Today doesn't make the report dirty.
    if (!next.report.projectId && !next.report.submittedAt && next.jobs.length) {
      void currentJobId()
        .then((id) => {
          if (!id || !next.jobs.some((j) => j.id === id)) return;
          setProjectId((value) => value || id);
          setSaved((value) => (value.projectId ? value : { ...value, projectId: id }));
        })
        .catch(() => undefined);
    }
  }

  useEffect(() => {
    getMyReport({ data: { day } })
      .then(apply)
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "Could not open today's report."));
  }, [day]);

  const dirty = narrative !== saved.narrative || projectId !== saved.projectId;

  async function upload(file: File, key: string) {
    try {
      const img = await loadImage(file);
      const full = scaled(img, 1600, 0.82);
      const thumb = scaled(img, 320, 0.7);
      const next = await addMyPhoto({
        data: {
          day,
          image: full.url,
          thumb: thumb.url,
          width: full.w,
          height: full.h,
          takenAt: new Date(file.lastModified || Date.now()).toISOString(),
        },
      });
      setPending((list) => list.filter((p) => p.key !== key));
      setReport(next.report);
    } catch (cause) {
      setPending((list) => list.map((p) => (p.key === key ? { ...p, state: "failed" } : p)));
      setError(cause instanceof Error ? cause.message : "Upload failed. Tap the photo to retry.");
    }
  }

  function addFiles(files: FileList | null) {
    if (!files) return;
    setError("");
    for (const file of Array.from(files)) {
      const key = `${file.name}-${file.size}-${Math.random()}`;
      setPending((list) => [...list, { key, preview: URL.createObjectURL(file), state: "uploading", file }]);
      void upload(file, key);
    }
  }

  async function save() {
    if (!dirty || report?.submittedAt) return;
    setBusy(true);
    try {
      apply(await saveMyReport({ data: { day, narrative, projectId } }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  }

  if (!report) {
    return error ? <ErrorBanner message={error} /> : <Skeleton lines={5} label="Opening today's report" />;
  }
  const submitted = Boolean(report.submittedAt);
  const photos = report.photos.length;

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
      </section>

      <section className="rounded-md border border-line bg-surface p-4">
        <h3 className="text-xl">Photos</h3>
        <p className="mt-1 text-base text-muted">
          {photos === 0 ? "Start with a photo of your work area." : `${photos} photo${photos === 1 ? "" : "s"} saved.`}
        </p>
        {photos + pending.length > 0 ? (
          <div className="mt-3 grid grid-cols-3 gap-2">
            {report.photos.map((p) => (
              <PhotoThumb key={p.id} id={p.id} thumb={p.thumb} alt={`Work photo ${clock(p.createdAt)}`} />
            ))}
            {pending.map((p) => (
              <button
                key={p.key}
                type="button"
                className="relative"
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
            ))}
          </div>
        ) : null}
        {!submitted ? (
          <label className="mt-3 flex h-14 w-full cursor-pointer items-center justify-center gap-2 rounded-md bg-copper text-lg font-medium text-ink focus-within:ring-4 focus-within:ring-copper/60">
            <span aria-hidden="true">📷</span> {photos === 0 ? "Take a photo" : "Add photos"}
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              capture="environment"
              multiple
              className="sr-only"
              data-testid="photo-input"
              onChange={(e) => {
                addFiles(e.target.files);
                e.target.value = "";
              }}
            />
          </label>
        ) : null}
      </section>

      <section className="rounded-md border border-line bg-surface p-4">
        <label htmlFor="narrative" className="text-xl">
          Your day
        </label>
        <p className="mt-1 text-base text-muted">In your own words: what you worked on, what got in the way, anything the owner should know.</p>
        <textarea
          id="narrative"
          className="field mt-2 min-h-40 text-base leading-relaxed"
          placeholder="Set the base cabinets on the east wall. Two boxes came damaged…"
          value={narrative}
          disabled={submitted}
          onChange={(e) => setNarrative(e.target.value)}
          onBlur={() => void save()}
        />
        {jobs.length > 0 ? (
          <>
            <label htmlFor="report-job" className="mt-3 block text-sm text-muted">
              Job (optional)
            </label>
            <select
              id="report-job"
              className="field mt-1"
              value={projectId}
              disabled={submitted}
              onChange={(e) => {
                setProjectId(e.target.value);
                rememberJob(e.target.value);
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
                    if (dirty) await saveMyReport({ data: { day, narrative, projectId } });
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
              disabled={!narrative.trim()}
              onClick={() => setAskLunch(true)}
            >
              {narrative.trim() ? "Submit my day" : "Write about your day to submit"}
            </button>
          )}
        </section>
      ) : null}
    </div>
  );
}
