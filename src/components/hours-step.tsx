/**
 * Spec 02 · A. The Hours card in the submit step: Start, End, the lunch dial, a big total,
 * the job · cost code line and "+ Split across jobs". Submit is "Submit 8h 15m".
 * The server checks everything again (time.server submitDayTime).
 */
import { useEffect, useMemo, useState } from "react";
import { getSubmitDefaults } from "@/lib/server/fns";
import { LunchDial } from "@/components/lunch-dial";
import { useOnline } from "@/lib/use-online";
import { ROUND_MINUTES, computeHours, formatMinutes, lineErrors, type Line } from "@/lib/time";
import { parseHoursInput } from "@/lib/time-input";

type Defaults = Awaited<ReturnType<typeof getSubmitDefaults>>;
export type SubmitHours = { lunchMinutes: number; start: string; end: string; lines: Line[] };

export function HoursStep({
  day,
  busy,
  onSubmit,
  onCancel,
}: {
  day: string;
  busy: boolean;
  onSubmit: (hours: SubmitHours) => void;
  onCancel: () => void;
}) {
  const online = useOnline();
  const [defaults, setDefaults] = useState<Defaults | null>(null);
  const [loadError, setLoadError] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [lunch, setLunch] = useState(30);
  const [lines, setLines] = useState<(Line & { text: string })[]>([{ projectId: null, costCodeId: null, minutes: 0, text: "" }]);
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getSubmitDefaults({ data: { day } })
      .then((d) => {
        if (cancelled) return;
        setDefaults(d);
        setStart((v) => v || d.start);
        setEnd((v) => v || d.end);
        if (d.lunchMinutes != null) setLunch(d.lunchMinutes);
        setLines(d.lines.map((l) => ({ ...l, text: d.lines.length > 1 ? formatMinutes(l.minutes).replace(/h /, ":").replace("m", "") : "" })));
      })
      .catch((cause: unknown) => !cancelled && setLoadError(cause instanceof Error ? cause.message : "Could not load your hours."));
    return () => {
      cancelled = true;
    };
  }, [day]);

  const hours = useMemo(() => computeHours({ start, end, lunch }), [start, end, lunch]);
  const split = lines.length > 1;
  const sent: Line[] = split
    ? lines.map((l) => ({ projectId: l.projectId, costCodeId: l.costCodeId, minutes: parseHoursInput(l.text) ?? -1 }))
    : [{ projectId: lines[0]?.projectId ?? null, costCodeId: lines[0]?.costCodeId ?? null, minutes: hours.minutes }];
  const splitErrors = split ? lineErrors(hours.minutes, sent) : [];
  const assigned = sent.reduce((n, l) => n + Math.max(0, l.minutes), 0);
  const errors = [...hours.errors, ...splitErrors];
  const locked = defaults?.locked ?? null;
  const canSubmit = !busy && online && !locked && errors.length === 0 && Boolean(defaults);
  const firstEditHint = defaults?.startHint === "first-edit" && start === defaults.start;
  const previousHint = defaults?.startHint === "previous" && start === defaults.start;

  const setLine = (i: number, patch: Partial<Line & { text: string }>) => setLines((list) => list.map((l, n) => (n === i ? { ...l, ...patch } : l)));

  return (
    <div className="grid gap-4" data-testid="hours-step">
      {defaults?.rejectReason ? (
        <p className="rounded-md border border-danger/60 p-3 text-base text-danger" role="alert">
          Sent back: {defaults.rejectReason}
        </p>
      ) : null}
      {loadError ? <p className="text-base text-danger">{loadError}</p> : null}
      <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-start">
        <div className="grid min-w-0 gap-3" data-testid="hours-card">
          <h3 className="text-xl">Your hours</h3>
          <div className="grid grid-cols-2 gap-3">
            <label className="grid gap-1 text-sm text-muted">
              Start
              <input
                type="time"
                className="field tabular-nums"
                value={start}
                aria-describedby="start-hint"
                onChange={(e) => {
                  setStart(e.target.value);
                  setTouched(true);
                }}
              />
            </label>
            <label className="grid gap-1 text-sm text-muted">
              End
              <input type="time" className="field tabular-nums" value={end} onChange={(e) => setEnd(e.target.value)} />
            </label>
          </div>
          <p id="start-hint" className="-mt-1 text-sm text-copper">
            {firstEditHint ? "Start is from your first edit. Change it if you started earlier." : previousHint ? "As you sent it before." : !start && !touched ? "Enter your start time." : " "}
          </p>
          <div className="flex items-baseline justify-between gap-2 border-t border-line pt-3">
            <span className="text-sm text-muted">Total</span>
            <span className="font-display text-4xl tabular-nums" data-testid="hours-total">
              {formatMinutes(hours.minutes)}
            </span>
          </div>
          {hours.errors.length === 0 && hours.rawMinutes !== hours.minutes ? (
            <p className="-mt-2 text-right text-sm text-muted tabular-nums" data-testid="hours-raw">
              {formatMinutes(hours.rawMinutes)} before rounding to {ROUND_MINUTES} min
            </p>
          ) : null}
          <div className="grid gap-2" data-testid="hours-lines">
            {lines.map((line, i) => (
              <div key={i} className={`grid gap-2 ${split ? "grid-cols-[minmax(0,1fr)_minmax(0,1fr)_5rem]" : "grid-cols-2"}`}>
                <select
                  aria-label={split ? `Job, line ${i + 1}` : "Job"}
                  className="field min-w-0"
                  value={line.projectId ?? ""}
                  onChange={(e) => setLine(i, { projectId: e.target.value || null })}
                >
                  <option value="">No job</option>
                  {defaults?.jobs.map((j) => (
                    <option key={j.id} value={j.id}>
                      {j.name}
                    </option>
                  ))}
                </select>
                <select
                  aria-label={split ? `Cost code, line ${i + 1}` : "Cost code"}
                  className="field min-w-0"
                  value={line.costCodeId ?? ""}
                  onChange={(e) => setLine(i, { costCodeId: e.target.value || null })}
                >
                  <option value="">No cost code</option>
                  {defaults?.costCodes.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.code} {c.name}
                    </option>
                  ))}
                </select>
                {split ? (
                  <input
                    aria-label={`Hours, line ${i + 1}`}
                    className="field tabular-nums"
                    inputMode="decimal"
                    placeholder="h:mm"
                    value={line.text}
                    onChange={(e) => setLine(i, { text: e.target.value })}
                  />
                ) : null}
              </div>
            ))}
            <div className="flex flex-wrap items-center justify-between gap-2 text-base">
              <button
                type="button"
                className="min-h-11 text-copper underline"
                onClick={() =>
                  setLines((list) =>
                    list.length === 1
                      ? [{ ...list[0], text: "" }, { projectId: null, costCodeId: list[0].costCodeId, minutes: 0, text: "" }]
                      : list.length < 6
                        ? [...list, { projectId: null, costCodeId: list[0].costCodeId, minutes: 0, text: "" }]
                        : list,
                  )
                }
              >
                + Split across jobs
              </button>
              {split ? (
                <>
                  <span className="tabular-nums text-muted" data-testid="hours-remaining">
                    Remaining {formatMinutes(Math.max(0, hours.minutes - assigned))}
                  </span>
                  <button type="button" className="min-h-11 text-muted underline" onClick={() => setLines((list) => [{ ...list[0], text: "" }])}>
                    One job
                  </button>
                </>
              ) : null}
            </div>
          </div>
        </div>
        <div className="grid justify-items-center gap-2">
          <h3 className="text-xl">How long was lunch?</h3>
          <LunchDial value={lunch} onChange={setLunch} />
        </div>
      </div>
      {errors.length && (touched || start) ? (
        <ul className="grid gap-1 text-base text-danger" data-testid="hours-errors">
          {errors.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      ) : null}
      {locked ? <p className="text-base text-muted">{locked}</p> : null}
      <button
        type="button"
        className="h-14 w-full scroll-mb-24 rounded-md bg-copper text-lg font-medium text-ink disabled:opacity-60"
        disabled={!canSubmit}
        onClick={() => onSubmit({ lunchMinutes: lunch, start, end, lines: sent })}
      >
        {busy ? "Submitting…" : `Submit ${formatMinutes(hours.minutes)}`}
      </button>
      <button type="button" className="h-12 text-base text-muted underline" onClick={onCancel}>
        Not yet
      </button>
    </div>
  );
}
