/** Spec 02 shared bits: status/source chips, OT badge, and B. "My hours" week strip. */
import { localDay } from "@/components/today-report";
import { useEffect, useState } from "react";
import { getMyHours } from "@/lib/server/fns";
import { ErrorBanner, Skeleton } from "@/components/ui";
import { shortHours, weekdayLabel } from "@/lib/time-cells";
import { STATUS_LABEL, WEEKLY_OT_MINUTES, formatMinutes, shiftDay, type EntrySource, type EntryStatus } from "@/lib/time";

const STATUS_TONE: Record<EntryStatus, string> = {
  submitted: "border-line bg-raised text-fg",
  approved: "border-pine/60 text-pine",
  rejected: "border-danger/70 text-danger",
  exported: "border-line text-muted",
};

export function StatusChip({ status }: { status: EntryStatus }) {
  return (
    <span className={`inline-flex h-7 items-center rounded-full border px-2.5 text-xs font-medium ${STATUS_TONE[status]}`} data-status={status}>
      {STATUS_LABEL[status]}
    </span>
  );
}

export function SourceChip({ source }: { source: EntrySource }) {
  return (
    <span className={`inline-flex h-6 items-center rounded-full border px-2 text-xs ${source === "derived" ? "border-line text-muted" : "border-copper/60 text-copper"}`}>
      {source}
    </span>
  );
}

export function OtBadge({ minutes }: { minutes: number }) {
  if (minutes <= WEEKLY_OT_MINUTES) return null;
  return (
    <span className="inline-flex h-6 items-center rounded-full bg-copper px-2 text-xs font-semibold text-ink" title="Over 40 hours this week">
      OT {formatMinutes(minutes - WEEKLY_OT_MINUTES)}
    </span>
  );
}


type Hours = Awaited<ReturnType<typeof getMyHours>>;

/** B. My hours: a Mon–Sun strip with hours, status chips and the week total. A rejected day opens its report. */
export function MyHours({ onFixDay }: { onFixDay?: (day: string) => void }) {
  const [week, setWeek] = useState("");
  const [data, setData] = useState<Hours | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setError("");
    getMyHours({ data: { week: week || localDay() } })
      .then((d) => !cancelled && setData(d))
      .catch((cause: unknown) => !cancelled && setError(cause instanceof Error ? cause.message : "Could not load your hours."));
    return () => {
      cancelled = true;
    };
  }, [week, attempt]);
  if (error) return <ErrorBanner message={error} onRetry={() => setAttempt((n) => n + 1)} />;
  if (!data) return <Skeleton lines={2} label="Loading your hours" />;
  const rejected = data.days.filter((d) => d.status === "rejected");
  return (
    <section className="rounded-md border border-line bg-surface p-4" aria-labelledby="my-hours-title" data-testid="my-hours">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="my-hours-title" className="text-xl">
          My hours
        </h2>
        <div className="flex items-center gap-1">
          <button type="button" className="h-11 rounded-md px-3 text-muted" aria-label="Previous week" onClick={() => setWeek(shiftDay(data.weekStart, -7))}>
            ‹
          </button>
          <span className="text-sm text-muted tabular-nums">Week of {weekdayLabel(data.weekStart).date}</span>
          <button type="button" className="h-11 rounded-md px-3 text-muted" aria-label="Next week" onClick={() => setWeek(shiftDay(data.weekStart, 7))}>
            ›
          </button>
        </div>
      </div>
      <ol className="mt-3 grid grid-cols-7 gap-1" aria-label="Hours by day">
        {data.days.map((d) => {
          const l = weekdayLabel(d.day);
          return (
            <li
              key={d.day}
              data-testid={`my-hours-${d.day}`}
              className={`grid min-w-0 justify-items-center gap-1 rounded-md border px-0.5 py-2 text-center ${d.day === data.today ? "border-copper" : "border-line"}`}
            >
              <span className="text-xs text-muted">{l.dow}</span>
              <span className="text-sm tabular-nums">{d.minutes ? shortHours(d.minutes) : "—"}</span>
              {d.status ? (
                <span
                  className={`size-2 rounded-full ${d.status === "approved" ? "bg-pine" : d.status === "rejected" ? "bg-danger" : d.status === "exported" ? "bg-muted" : "bg-copper"}`}
                  aria-label={STATUS_LABEL[d.status]}
                  title={STATUS_LABEL[d.status]}
                />
              ) : null}
            </li>
          );
        })}
      </ol>
      <div className="mt-3 flex items-baseline justify-between gap-2">
        <span className="text-sm text-muted">Week total</span>
        <span className="flex items-center gap-2">
          <OtBadge minutes={data.totalMinutes} />
          <span className="font-display text-2xl tabular-nums" data-testid="my-hours-total">
            {formatMinutes(data.totalMinutes)}
          </span>
        </span>
      </div>
      <ul className="mt-3 grid gap-2">
        {data.days
          .filter((d) => d.status)
          .map((d) => (
            <li key={d.day} className="flex flex-wrap items-center justify-between gap-2 text-base">
              <span>
                {weekdayLabel(d.day).dow} {weekdayLabel(d.day).date} · <span className="tabular-nums">{formatMinutes(d.minutes)}</span>
              </span>
              <StatusChip status={d.status!} />
              {d.status === "rejected" ? (
                <p className="w-full text-sm text-danger" data-testid="rejected-reason">
                  Sent back: {d.rejectReason}
                </p>
              ) : null}
            </li>
          ))}
      </ul>
      {rejected.length && onFixDay ? (
        <div className="mt-3 grid gap-2">
          {rejected.map((d) => (
            <button key={d.day} type="button" className="h-12 rounded-md border border-danger/70 text-base text-fg" onClick={() => onFixDay(d.day)}>
              Fix {weekdayLabel(d.day).dow} {weekdayLabel(d.day).date}
            </button>
          ))}
        </div>
      ) : null}
    </section>
  );
}
