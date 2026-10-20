import { useEffect, useRef, useState } from "react";
import { needsFreshAttention } from "@/lib/attention";
import { attentionRangeKey, shareAttentionFresh } from "@/lib/attention-inflight";
import { getAttention, listMyReports, listSharingReviewQueue, reviewReports } from "@/lib/server/fns";
import { EmptyState, ErrorBanner, Skeleton } from "@/components/ui";
import { ReportCard } from "@/components/report-card";
import { localDay } from "@/components/today-report";
import type { DailyReport } from "@/lib/server/reports.server";

function shift(day: string, days: number): string {
  const d = new Date(`${day}T12:00:00`);
  d.setDate(d.getDate() + days);
  return localDay(d);
}

export function MyReports() {
  const [reports, setReports] = useState<DailyReport[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    listMyReports()
      .then(setReports)
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "Could not load your reports."));
  }, []);
  if (error) return <ErrorBanner message={error} />;
  if (!reports) return <Skeleton lines={4} label="Loading your reports" />;
  if (reports.length === 0) return <EmptyState title="No reports yet" body="Your daily reports show up here once you start one." />;
  return (
    <div className="mx-auto grid max-w-2xl gap-3">
      {reports.map((r) => (
        <ReportCard key={r.id} report={r} showPerson={false} />
      ))}
    </div>
  );
}

type Review = Awaited<ReturnType<typeof reviewReports>>;

export type ReportFilters = { from: string; to: string; job: string; person: string };

export function ReportsReview({
  focus = "",
  initialDay = "",
  initial,
  onFilters,
}: {
  focus?: string;
  initialDay?: string;
  /** Filters from the URL (spec 05 · F1). */
  initial?: Partial<ReportFilters>;
  onFilters?: (filters: ReportFilters) => void;
}) {
  const today = localDay();
  const [from, setFrom] = useState(initial?.from || initialDay || today);
  const [to, setTo] = useState(initial?.to || initialDay || today);
  const [projectId, setProjectId] = useState(initial?.job ?? "");
  const [personId, setPersonId] = useState(initial?.person ?? "");
  const filtersInitial = useRef(JSON.stringify({ from, to, job: projectId, person: personId }));
  useEffect(() => {
    // Only after the user changes something (StrictMode-safe), so a view never rewrites the URL on mount.
    if (JSON.stringify({ from, to, job: projectId, person: personId }) === filtersInitial.current) return;
    filtersInitial.current = "";
    onFilters?.({ from, to, job: projectId, person: personId });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to, projectId, personId]);
  const [data, setData] = useState<Review | null>(null);
  const [error, setError] = useState("");
  const [moreFilters, setMoreFilters] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setError("");
    reviewReports({ data: { from: from <= to ? from : to, to: from <= to ? to : from, projectId, personId } })
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "Could not load reports.");
      });
    return () => {
      cancelled = true;
    };
  }, [from, to, projectId, personId]);

  useEffect(() => {
    if (focus && data) document.getElementById(`report-${focus}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [focus, data]);

  return (
    <div className="grid gap-4 lg:grid-cols-[18rem_1fr]">
      <form className="grid content-start gap-2 rounded-md border border-line bg-surface p-4" onSubmit={(e) => e.preventDefault()} aria-label="Filter reports">
        <div className="grid grid-cols-3 gap-2">
          {[
            ["Today", today, today],
            ["Yesterday", shift(today, -1), shift(today, -1)],
            ["7 days", shift(today, -6), today],
          ].map(([label, f, t]) => (
            <button
              key={label}
              type="button"
              onClick={() => {
                setFrom(f);
                setTo(t);
              }}
              className={`h-11 rounded-md border text-sm ${from === f && to === t ? "border-copper bg-copper text-ink" : "border-line text-fg"}`}
            >
              {label}
            </button>
          ))}
        </div>
        <button
          type="button"
          className="h-11 rounded-md text-sm text-copper underline lg:hidden"
          aria-expanded={moreFilters}
          onClick={() => setMoreFilters((v) => !v)}
        >
          {moreFilters ? "Fewer filters" : `Dates, job, person${projectId || personId ? " (filtered)" : ""}`}
        </button>
        <div className={`${moreFilters ? "grid" : "hidden"} gap-2 lg:grid`}>
        <label className="text-sm text-muted" htmlFor="rv-from">From</label>
        <input id="rv-from" type="date" className="field" value={from} onChange={(e) => setFrom(e.target.value)} />
        <label className="text-sm text-muted" htmlFor="rv-to">To</label>
        <input id="rv-to" type="date" className="field" value={to} onChange={(e) => setTo(e.target.value)} />
        <label className="text-sm text-muted" htmlFor="rv-job">Job</label>
        <select id="rv-job" className="field" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
          <option value="">All jobs</option>
          {data?.jobs.map((j) => (
            <option key={j.id} value={j.id}>
              {j.name}
            </option>
          ))}
        </select>
        <label className="text-sm text-muted" htmlFor="rv-person">Person</label>
        <select id="rv-person" className="field" value={personId} onChange={(e) => setPersonId(e.target.value)}>
          <option value="">Everyone</option>
          {data?.people.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        </div>
      </form>
      <div className="grid content-start gap-3">
        {error ? <ErrorBanner message={error} /> : null}
        {!data ? (
          <Skeleton lines={4} label="Loading reports" />
        ) : data.reports.length === 0 ? (
          <EmptyState title="No reports for this filter" body="Try another day, job, or person." />
        ) : (
          <>
            <p className="text-sm text-muted">
              {data.reports.length} report{data.reports.length === 1 ? "" : "s"} ·{" "}
              {data.reports.reduce((n, r) => n + r.photos.length, 0)} photos
            </p>
            {data.reports.map((r) => (
              <ReportCard key={r.id} report={r} highlight={r.id === focus} />
            ))}
          </>
        )}
      </div>
    </div>
  );
}

type Attention = Awaited<ReturnType<typeof getAttention>>;

const CAT_LABEL: Record<string, string> = {
  safety: "Safety",
  delay: "Delay",
  materials: "Materials",
  damage: "Damage",
  blocked: "Blocked",
  client: "Client",
  quality: "Quality",
  other: "Other",
};

type ReviewQueue = Awaited<ReturnType<typeof listSharingReviewQueue>>;

/**
 * Pinned system section (spec 06): jobs waiting for a sharing review, read live from the
 * review queue. Not stored with the AI summary and never sent to the model.
 */
function SharingReviewSection({ onReview }: { onReview: (projectId: string) => void }) {
  const [queue, setQueue] = useState<ReviewQueue | null>(null);
  useEffect(() => {
    let cancelled = false;
    listSharingReviewQueue()
      .then((rows) => !cancelled && setQueue(rows))
      .catch(() => !cancelled && setQueue([]));
    return () => {
      cancelled = true;
    };
  }, []);
  if (!queue || queue.length === 0) return null;
  return (
    <section className="grid min-w-0 gap-2 rounded-md border border-copper bg-surface p-4" aria-label="Sharing review needed" data-testid="sharing-review-section">
      <h2 className="font-display text-lg text-fg">Sharing review needed ({queue.length})</h2>
      <ul className="grid max-h-64 grid-cols-[minmax(0,1fr)] gap-2 overflow-y-auto md:max-h-none">
        {queue.map((job) => (
          <li key={job.id} className="flex min-w-0 items-center justify-between gap-3 border-t border-line pt-2 first:border-t-0 first:pt-0">
            <div className="min-w-0 flex-1">
              <p className="truncate text-base text-fg">{job.name}</p>
              <p className="truncate text-sm text-muted">
                Created by {job.requestedBy || "someone"}
                {job.requestedAt ? ` · ${new Date(job.requestedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}` : ""} · Using company defaults
              </p>
            </div>
            <button type="button" className="h-11 shrink-0 rounded-md bg-copper px-4 text-sm font-medium text-ink" onClick={() => onReview(job.id)} aria-label={`Review ${job.name}`}>
              Review
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function AttentionView({
  openReport,
  onReviewSharing,
  initial,
  onRange,
}: {
  openReport: (reportId: string, day: string) => void;
  onReviewSharing?: (projectId: string) => void;
  /** Range from the URL (spec 05 · F1). */
  initial?: { from?: string; to?: string };
  onRange?: (range: { from: string; to: string }) => void;
}) {
  const today = localDay();
  // F1 remounts on every nav. Remember the last range so Reports → Attention does not
  // reset to "today" and fire a second fresh generate for a range the user already ran.
  const remembered = (() => {
    if (typeof sessionStorage === "undefined") return null;
    try {
      const raw = sessionStorage.getItem("rcl.attentionRange");
      if (!raw) return null;
      const parsed = JSON.parse(raw) as { from?: string; to?: string };
      return parsed.from && parsed.to ? parsed : null;
    } catch {
      return null;
    }
  })();
  const [from, setFrom] = useState(initial?.from || remembered?.from || today);
  const [to, setTo] = useState(initial?.to || remembered?.to || today);
  const rangeInitial = useRef(JSON.stringify({ from, to }));
  useEffect(() => {
    // Only after the user changes something (StrictMode-safe), so a view never rewrites the URL on mount.
    if (JSON.stringify({ from, to }) === rangeInitial.current) return;
    rangeInitial.current = "";
    try {
      sessionStorage.setItem("rcl.attentionRange", JSON.stringify({ from, to }));
    } catch {
      /* ignore quota */
    }
    onRange?.({ from, to });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to]);
  const [data, setData] = useState<Attention | null>(null);
  const [busy, setBusy] = useState(false); // the instant, cache-only read
  const [fresh, setFresh] = useState(false); // a fresh AI summary is being written
  const [error, setError] = useState("");
  const seq = useRef(0);

  /**
   * Two steps so a cached summary shows at once: a cache-only read that never waits on the AI,
   * then, only when the reports changed or were never summarized (or on Refresh), the slow
   * generate call in the background with a progress bar. Stale results stay on screen meanwhile.
   */
  async function run(refresh = false) {
    const id = ++seq.current;
    const range = { from: from <= to ? from : to, to: from <= to ? to : from };
    setError("");
    try {
      let generate = refresh;
      if (!refresh) {
        setBusy(true);
        const quick = await getAttention({ data: { ...range, cachedOnly: true } });
        if (id !== seq.current) return;
        setData(quick);
        setBusy(false);
        generate = needsFreshAttention(quick.status, quick.stale);
      }
      if (!generate) return;
      setFresh(true);
      // F1: onRange replace or a remount can start a second generate for the same range; share one.
      const full = await shareAttentionFresh(`${attentionRangeKey(range.from, range.to)}|${refresh ? "refresh" : "auto"}`, () =>
        getAttention({ data: { ...range, refresh } }),
      );
      if (id !== seq.current) return;
      setData(full);
    } catch (cause) {
      if (id === seq.current) setError(cause instanceof Error ? cause.message : "Could not build the summary.");
    } finally {
      if (id === seq.current) {
        setBusy(false);
        setFresh(false);
      }
    }
  }

  useEffect(() => {
    void run(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to]);

  return (
    <div className="mx-auto grid min-w-0 max-w-3xl gap-4">
      {onReviewSharing ? <SharingReviewSection onReview={onReviewSharing} /> : null}
      <div className="grid gap-2 rounded-md border border-line bg-surface p-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
        <div className="grid grid-cols-3 gap-2 sm:col-span-3">
          {[
            ["Today", today, today],
            ["Yesterday", shift(today, -1), shift(today, -1)],
            ["7 days", shift(today, -6), today],
          ].map(([label, f, t]) => (
            <button
              key={label}
              type="button"
              onClick={() => {
                setFrom(f);
                setTo(t);
              }}
              className={`h-11 rounded-md border text-sm ${from === f && to === t ? "border-copper bg-copper text-ink" : "border-line text-fg"}`}
            >
              {label}
            </button>
          ))}
        </div>
        <label className="grid gap-1 text-sm text-muted">
          From
          <input type="date" className="field" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="grid gap-1 text-sm text-muted">
          To
          <input type="date" className="field" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
        <button type="button" className="h-11 rounded-md border border-line px-4 text-sm text-fg disabled:opacity-60" disabled={busy || fresh} onClick={() => void run(true)}>
          {fresh ? "Reading…" : "Refresh"}
        </button>
      </div>
      {fresh ? (
        <div className="grid gap-2" data-testid="attention-progress">
          <p className="text-sm text-muted" role="status">
            {data?.status === "ok" ? "Showing the last summary. " : ""}Reading {data?.reportCount || ""} report{data?.reportCount === 1 ? "" : "s"} for a fresh summary…
          </p>
          <div role="progressbar" aria-label="Writing a fresh summary" className="h-1 overflow-hidden rounded-full bg-raised">
            <div className="h-full w-1/3 animate-pulse rounded-full bg-copper" />
          </div>
        </div>
      ) : null}
      {error ? <ErrorBanner message={error} onRetry={() => void run(true)} /> : null}
      {(busy || fresh) && (!data || data.status === "pending") ? <Skeleton lines={4} label="Reading reports" /> : null}
      {data?.status === "no-key" ? (
        <EmptyState
          title="AI summary isn't set up"
          body="Set XAI_API_KEY on the server to get a list of items that need attention. Reports are still all in Reports."
        />
      ) : null}
      {data?.status === "error" ? <ErrorBanner message="The AI summary failed. Try Refresh in a minute." onRetry={() => void run(true)} /> : null}
      {data?.status === "empty" ? <EmptyState title="No reports in this range" body="Nothing to summarize yet." /> : null}
      {data?.status === "ok" ? (
        <>
          <p className="text-sm text-muted">
            Read {data.reportCount} report{data.reportCount === 1 ? "" : "s"}
            {data.generatedAt ? ` · ${data.stale ? "last summary" : data.cached ? "cached" : "generated"} ${new Date(data.generatedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : ""}
          </p>
          {data.items.length === 0 ? (
            <EmptyState title="Nothing needs attention" body="No safety, delay, material, damage, or client issues in these reports." />
          ) : (
            <ul className="grid gap-3" data-testid="attention-list">
              {data.items.map((item, i) => (
                <li key={i} className={`rounded-md border bg-surface p-4 ${item.severity === "high" ? "border-danger" : "border-line"}`}>
                  <p className="flex items-center gap-2 text-sm font-medium uppercase tracking-wide">
                    <span className={item.severity === "high" ? "text-danger" : item.severity === "medium" ? "text-copper" : "text-muted"}>
                      {item.severity === "high" ? "▲ High" : item.severity === "medium" ? "● Medium" : "○ Low"}
                    </span>
                    <span className="text-muted">· {CAT_LABEL[item.category] ?? item.category}</span>
                  </p>
                  <p className="mt-1 text-base text-fg">{item.summary}</p>
                  <button
                    type="button"
                    className="mt-2 inline-flex min-h-11 scroll-mb-24 items-center text-sm text-copper underline"
                    onClick={() => openReport(item.reportId, item.day)}
                  >
                    From {item.person}'s report, {new Date(`${item.day}T12:00:00`).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })}
                  </button>
                  {item.quote ? <blockquote className="mt-2 border-l-2 border-line pl-3 text-sm text-muted">“{item.quote}”</blockquote> : null}
                </li>
              ))}
            </ul>
          )}
        </>
      ) : null}
    </div>
  );
}
