import { useEffect, useRef, useState } from "react";
import { getAttention, listMyReports, reviewReports } from "@/lib/server/fns";
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

export function AttentionView({
  openReport,
  initial,
  onRange,
}: {
  openReport: (reportId: string, day: string) => void;
  /** Range from the URL (spec 05 · F1). */
  initial?: { from?: string; to?: string };
  onRange?: (range: { from: string; to: string }) => void;
}) {
  const today = localDay();
  const [from, setFrom] = useState(initial?.from || today);
  const [to, setTo] = useState(initial?.to || today);
  const rangeInitial = useRef(JSON.stringify({ from, to }));
  useEffect(() => {
    // Only after the user changes something (StrictMode-safe), so a view never rewrites the URL on mount.
    if (JSON.stringify({ from, to }) === rangeInitial.current) return;
    rangeInitial.current = "";
    onRange?.({ from, to });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to]);
  const [data, setData] = useState<Attention | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function run(refresh = false) {
    setBusy(true);
    setError("");
    try {
      setData(await getAttention({ data: { from: from <= to ? from : to, to: from <= to ? to : from, refresh } }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not build the summary.");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    void run(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to]);

  return (
    <div className="mx-auto grid max-w-3xl gap-4">
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
        <button type="button" className="h-11 rounded-md border border-line px-4 text-sm text-fg disabled:opacity-60" disabled={busy} onClick={() => void run(true)}>
          {busy ? "Reading…" : "Refresh"}
        </button>
      </div>
      {error ? <ErrorBanner message={error} onRetry={() => void run(true)} /> : null}
      {busy && !data ? <Skeleton lines={4} label="Reading reports" /> : null}
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
            {data.generatedAt ? ` · ${data.cached ? "cached" : "generated"} ${new Date(data.generatedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : ""}
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
                  {item.quote ? <blockquote className="mt-2 border-l-2 border-line pl-3 text-sm text-muted">“{item.quote}”</blockquote> : null}
                  <button
                    type="button"
                    className="mt-2 inline-flex min-h-11 items-center text-sm text-copper underline"
                    onClick={() => openReport(item.reportId, item.day)}
                  >
                    From {item.person}'s report, {new Date(`${item.day}T12:00:00`).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      ) : null}
    </div>
  );
}
