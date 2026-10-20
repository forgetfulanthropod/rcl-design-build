/**
 * Spec 02 · C. Approvals (Time) and D. Payroll export, for Owner, Admin and Lead.
 * Everything here is a view of what the server sends: a Lead's payload is already limited to
 * their jobs and carries no rates (time.server getTimeWeek).
 */
import { localDay } from "@/components/today-report";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { createColumnHelper, flexRender, getCoreRowModel, useReactTable } from "@tanstack/react-table";
import { AlertTriangle } from "lucide-react";
import {
  approveTime,
  editTime,
  getPayrollCsv,
  getTimeReport,
  getTimeWeek,
  listPayRates,
  listPayrollExports,
  nudgeTime,
  previewPayroll,
  rejectTime,
  runPayroll,
  setPayRate,
  unlockTime,
  voidPayroll,
} from "@/lib/server/fns";
import { Button, EmptyState, ErrorBanner, Skeleton } from "@/components/ui";
import { ReportCard } from "@/components/report-card";
import { OtBadge, SourceChip, StatusChip } from "@/components/time-parts";
import { useOnline } from "@/lib/use-online";
import { FLAG_LABEL, STATUS_LABEL, clock12, formatMinutes, shiftDay, type EntryStatus, type Flag } from "@/lib/time";
import { parseHoursInput } from "@/lib/time-input";
import { dayStatusOf, flagsOf, weekdayLabel } from "@/lib/time-cells";

type Week = Awaited<ReturnType<typeof getTimeWeek>>;
type Entry = Week["entries"][number];
type Missing = Week["missing"][number];
type Cell = { day: string; entries: Entry[]; minutes: number; status: EntryStatus | null; flags: Flag[]; missing: Missing | null };
type TimeRow = {
  key: string;
  userId: string;
  name: string;
  role: string;
  subCompany: string;
  jobId: string | null;
  jobName: string;
  cells: Record<string, Cell>;
  total: number;
  laborCents?: number;
};

const money = (cents: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(cents / 100);
const errText = (cause: unknown, fallback: string) => (cause instanceof Error ? cause.message : fallback);

function buildRows(week: Week, opts: { job: string; status: string; attention: boolean }): TimeRow[] {
  const byLead = week.scope === "lead";
  const people = new Map(week.people.map((p) => [p.userId, p]));
  const entries = week.entries.filter((e) => (!opts.job || e.projectId === opts.job) && (!opts.status || e.status === opts.status));
  const missing = opts.status ? [] : week.missing.filter((m) => !opts.job || m.projectId === opts.job);
  const rows = new Map<string, TimeRow>();
  const rowFor = (userId: string, jobId: string | null, jobName: string) => {
    const key = byLead ? `${jobId ?? ""}|${userId}` : userId;
    let row = rows.get(key);
    if (!row) {
      const p = people.get(userId);
      row = {
        key,
        userId,
        name: p?.name ?? "Someone",
        role: p?.role ?? "",
        subCompany: p?.subCompany ?? "",
        jobId: byLead ? jobId : null,
        jobName: byLead ? jobName : "",
        cells: Object.fromEntries(week.days.map((d) => [d, { day: d, entries: [], minutes: 0, status: null, flags: [], missing: null }])),
        total: 0,
        laborCents: week.laborCents ? (week.laborCents[userId] ?? 0) : undefined,
      };
      rows.set(key, row);
    }
    return row;
  };
  for (const e of entries) {
    const row = rowFor(e.userId, e.projectId, e.projectName || "No job");
    const cell = row.cells[e.day];
    if (!cell) continue;
    cell.entries.push(e);
    cell.minutes += e.minutes;
    row.total += e.minutes;
  }
  for (const m of missing) {
    const row = rowFor(m.userId, m.projectId, m.projectName);
    const cell = row.cells[m.day];
    if (cell && cell.entries.length === 0) cell.missing = m;
  }
  for (const row of rows.values()) {
    for (const cell of Object.values(row.cells)) {
      cell.status = dayStatusOf(cell.entries.map((e) => e.status));
      cell.flags = flagsOf(cell.entries);
    }
  }
  let list = [...rows.values()];
  if (opts.attention) {
    list = list.filter((r) => Object.values(r.cells).some((c) => c.flags.length || c.missing || c.status === "rejected"));
  }
  return list.sort((a, b) => a.jobName.localeCompare(b.jobName) || a.name.localeCompare(b.name));
}

function isClean(cell: Cell, week: Week, userId: string): boolean {
  return (
    cell.entries.length > 0 &&
    cell.entries.every((e) => e.status === "submitted") &&
    cell.flags.length === 0 &&
    (userId !== week.meId || week.can.selfApprove)
  );
}

function download(filename: string, csv: string) {
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function TimeView() {
  const online = useOnline();
  const [week, setWeek] = useState("");
  const [data, setData] = useState<Week | null>(null);
  const [error, setError] = useState("");
  const [actionError, setActionError] = useState("");
  const [notice, setNotice] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [job, setJob] = useState("");
  const [status, setStatus] = useState("");
  const [attention, setAttention] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<{ rowKey: string; day: string } | null>(null);
  const [nudge, setNudge] = useState<{ missing: Missing; name: string } | null>(null);
  const [sheet, setSheet] = useState<"" | "export" | "rates">("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setError("");
    getTimeWeek({ data: { week: week || localDay(), today: localDay() } })
      .then((d) => {
        if (cancelled) return;
        setData(d);
        setWeek((w) => w || d.weekStart);
      })
      .catch((cause: unknown) => !cancelled && setError(errText(cause, "Could not load hours.")));
    return () => {
      cancelled = true;
    };
  }, [week, attempt]);

  const rows = useMemo(() => (data ? buildRows(data, { job, status, attention }) : []), [data, job, status, attention]);
  const reload = () => setAttempt((n) => n + 1);

  async function act(work: () => Promise<unknown>, done: string) {
    setBusy(true);
    setActionError("");
    setNotice("");
    try {
      await work();
      setNotice(done);
      reload();
      return true;
    } catch (cause) {
      setActionError(errText(cause, "Could not save that."));
      return false;
    } finally {
      setBusy(false);
    }
  }

  if (error) return <ErrorBanner message={error} onRetry={reload} />;
  if (!data) return <Skeleton lines={6} label="Loading hours" />;

  const scopeRows = selected.size ? rows.filter((r) => selected.has(r.key)) : rows;
  const cleanIds = scopeRows.flatMap((r) => Object.values(r.cells).filter((c) => isClean(c, data, r.userId)).flatMap((c) => c.entries.map((e) => e.id)));
  const openRow = open ? rows.find((r) => r.key === open.rowKey) : null;
  const openCell = openRow && open ? openRow.cells[open.day] : null;
  const anyHours = data.entries.length > 0 || data.missing.length > 0;

  return (
    <div className="grid min-w-0 gap-4" data-testid="time-view">
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <button type="button" className="h-11 rounded-md px-3 text-muted" aria-label="Previous week" onClick={() => setWeek(shiftDay(data.weekStart, -7))}>
            ‹
          </button>
          <h2 className="text-xl tabular-nums" data-testid="time-week">
            Week of {weekdayLabel(data.weekStart).date}
          </h2>
          <button type="button" className="h-11 rounded-md px-3 text-muted" aria-label="Next week" onClick={() => setWeek(shiftDay(data.weekStart, 7))}>
            ›
          </button>
        </div>
        <div className="flex flex-wrap gap-2">
          {data.can.rates ? (
            <Button tone="ghost" onClick={() => setSheet("rates")}>
              Pay rates
            </Button>
          ) : null}
          {data.can.export ? (
            <Button tone="ghost" onClick={() => setSheet("export")}>
              Export payroll
            </Button>
          ) : null}
        </div>
      </div>

      <div className="flex min-w-0 flex-wrap items-end gap-3">
        <label className="grid gap-1 text-sm text-muted">
          Job
          <select className="field min-w-40" value={job} onChange={(e) => setJob(e.target.value)}>
            <option value="">{data.scope === "lead" ? "My jobs" : "All jobs"}</option>
            {data.jobs.map((j) => (
              <option key={j.id} value={j.id}>
                {j.name}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-sm text-muted">
          Status
          <select className="field min-w-36" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">Any status</option>
            {(Object.keys(STATUS_LABEL) as EntryStatus[]).map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex min-h-11 items-center gap-2 text-base">
          <input type="checkbox" className="size-5 accent-copper" checked={attention} onChange={(e) => setAttention(e.target.checked)} />
          Needs attention
        </label>
      </div>

      {actionError ? <ErrorBanner message={actionError} onRetry={() => setActionError("")} /> : null}
      {notice ? (
        <p role="status" className="text-base text-pine">
          {notice}
        </p>
      ) : null}

      {!anyHours ? (
        <EmptyState title="No hours this week yet." body="They appear as reports are submitted." />
      ) : (
        <>
          {data.can.approve ? (
            <div className="flex flex-wrap items-center gap-3 rounded-md border border-line bg-surface p-3" data-testid="bulk-bar">
              <Button
                disabled={busy || !online || cleanIds.length === 0}
                onClick={() => void act(() => approveTime({ data: { ids: cleanIds } }), `Approved ${cleanIds.length} ${cleanIds.length === 1 ? "entry" : "entries"}.`).then(() => setSelected(new Set()))}
              >
                Approve {cleanIds.length} clean {cleanIds.length === 1 ? "entry" : "entries"}
              </Button>
              <span className="text-sm text-muted">
                {selected.size ? `${selected.size} selected. ` : ""}Flagged days and your own hours are left out.
              </span>
            </div>
          ) : null}
          <WeekTable data={data} rows={rows} selected={selected} setSelected={setSelected} onOpen={(rowKey, day) => setOpen({ rowKey, day })} onNudge={(m, name) => setNudge({ missing: m, name })} />
          <PhoneDayList data={data} rows={rows} busy={busy || !online} onOpen={(rowKey, day) => setOpen({ rowKey, day })} onApprove={(ids) => void act(() => approveTime({ data: { ids } }), "Approved.")} onNudge={(m, name) => setNudge({ missing: m, name })} />
        </>
      )}

      {openRow && openCell ? (
        <EntryDrawer
          key={`${open!.rowKey}-${open!.day}`}
          data={data}
          row={openRow}
          cell={openCell}
          busy={busy || !online}
          onClose={() => setOpen(null)}
          act={act}
        />
      ) : null}

      <Sheet open={Boolean(nudge)} onClose={() => setNudge(null)} title={`Text ${nudge?.name.split(" ")[0] ?? ""} a reminder?`} side="center">
        {nudge ? (
          <div className="grid gap-3">
            <p className="text-base text-muted">
              {nudge.name} was on {nudge.missing.projectName} on {weekdayLabel(nudge.missing.day).dow} {weekdayLabel(nudge.missing.day).date} and hasn't sent a report. This sends a text (or an email when there's no phone).
            </p>
            <div className="flex justify-end gap-2">
              <Button tone="quiet" onClick={() => setNudge(null)}>
                Cancel
              </Button>
              <Button
                disabled={busy || !online}
                onClick={() =>
                  void act(async () => {
                    const r = await nudgeTime({ data: { userId: nudge.missing.userId, day: nudge.missing.day } });
                    return r;
                  }, `Reminder sent to ${nudge.name}.`).then((ok) => ok && setNudge(null))
                }
              >
                Send text
              </Button>
            </div>
          </div>
        ) : null}
      </Sheet>

      {data.can.export ? <ExportSheet open={sheet === "export"} onClose={() => setSheet("")} canVoid={data.can.voidExport} onChanged={reload} onShow={(day) => {
        setSheet("");
        setStatus("");
        setAttention(true);
        setWeek(day);
      }} /> : null}
      {data.can.rates ? <RatesSheet open={sheet === "rates"} onClose={() => setSheet("")} onChanged={reload} /> : null}
    </div>
  );
}

function CellButton({ row, cell, onOpen, onNudge }: { row: TimeRow; cell: Cell; onOpen: () => void; onNudge: (m: Missing, name: string) => void }) {
  const l = weekdayLabel(cell.day);
  if (cell.missing && cell.entries.length === 0) {
    return (
      <div className="grid justify-items-center gap-1">
        <span className="text-xs font-medium text-danger">No report</span>
        {cell.missing.nudged ? (
          <span className="text-xs text-muted">Nudged</span>
        ) : (
          <button type="button" className="h-8 rounded-md border border-line px-2 text-xs" aria-label={`Nudge ${row.name} for ${l.dow} ${l.date}`} onClick={() => onNudge(cell.missing!, row.name)}>
            Nudge
          </button>
        )}
      </div>
    );
  }
  if (cell.entries.length === 0) return <span className="text-muted">—</span>;
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`${row.name}, ${l.dow} ${l.date}: ${formatMinutes(cell.minutes)}, ${cell.status ? STATUS_LABEL[cell.status] : ""}${cell.flags.length ? ", needs a check" : ""}`}
      className="inline-flex min-h-11 w-full items-center justify-center gap-1 rounded-md px-1 tabular-nums hover:bg-raised focus-visible:ring-2 focus-visible:ring-copper"
      data-testid={`cell-${row.userId}-${cell.day}`}
      data-status={cell.status ?? ""}
    >
      {formatMinutes(cell.minutes)}
      <span
        aria-hidden="true"
        className={`size-2 shrink-0 rounded-full ${cell.status === "approved" ? "bg-pine" : cell.status === "rejected" ? "bg-danger" : cell.status === "exported" ? "bg-muted" : "bg-copper"}`}
      />
      {cell.flags.length ? <AlertTriangle className="size-3.5 shrink-0 text-danger" aria-hidden="true" /> : null}
    </button>
  );
}

const helper = createColumnHelper<TimeRow>();

function WeekTable({
  data,
  rows,
  selected,
  setSelected,
  onOpen,
  onNudge,
}: {
  data: Week;
  rows: TimeRow[];
  selected: Set<string>;
  setSelected: (s: Set<string>) => void;
  onOpen: (rowKey: string, day: string) => void;
  onNudge: (m: Missing, name: string) => void;
}) {
  const columns = useMemo(
    () => [
      helper.display({
        id: "select",
        header: () => (
          <input
            type="checkbox"
            aria-label="Select all rows"
            className="size-5 accent-copper"
            checked={rows.length > 0 && rows.every((r) => selected.has(r.key))}
            onChange={(e) => setSelected(new Set(e.target.checked ? rows.map((r) => r.key) : []))}
          />
        ),
        cell: (c) => (
          <input
            type="checkbox"
            aria-label={`Select ${c.row.original.name}`}
            className="size-5 accent-copper"
            checked={selected.has(c.row.original.key)}
            onChange={(e) => {
              const next = new Set(selected);
              if (e.target.checked) next.add(c.row.original.key);
              else next.delete(c.row.original.key);
              setSelected(next);
            }}
          />
        ),
      }),
      helper.accessor("name", {
        header: "Person",
        cell: (c) => (
          <div className="min-w-0">
            <p className="truncate text-fg">{c.getValue()}</p>
            {c.row.original.role === "sub" ? <p className="truncate text-xs text-muted">Sub · {c.row.original.subCompany || "outside crew"}</p> : null}
          </div>
        ),
      }),
      ...data.days.map((day) =>
        helper.display({
          id: day,
          header: () => {
            const l = weekdayLabel(day);
            return (
              <span className={day === data.today ? "text-copper" : ""}>
                {l.dow}
                <span className="block text-xs font-normal text-muted">{l.date}</span>
              </span>
            );
          },
          cell: (c) => <CellButton row={c.row.original} cell={c.row.original.cells[day]} onOpen={() => onOpen(c.row.original.key, day)} onNudge={onNudge} />,
        }),
      ),
      helper.accessor("total", {
        header: "Week",
        cell: (c) => (
          <span className="flex items-center justify-end gap-1 tabular-nums">
            {formatMinutes(c.getValue())}
            <OtBadge minutes={c.getValue()} />
          </span>
        ),
      }),
      ...(data.laborCents
        ? [
            helper.accessor("laborCents", {
              header: "Labor $",
              cell: (c) => <span className="tabular-nums">{money(c.getValue() ?? 0)}</span>,
            }),
          ]
        : []),
    ],
    [data, rows, selected, setSelected, onOpen, onNudge],
  );
  const table = useReactTable({ data: rows, columns, getCoreRowModel: getCoreRowModel(), getRowId: (r) => r.key });
  let lastJob: string | null = null;
  return (
    <div className="hidden min-w-0 overflow-x-auto rounded-md border border-line md:block">
      <table className="w-full min-w-[56rem] border-collapse text-sm" data-testid="time-table">
        <thead className="bg-surface text-left text-muted">
          {table.getHeaderGroups().map((g) => (
            <tr key={g.id}>
              {g.headers.map((h) => (
                <th key={h.id} scope="col" className="border-b border-line px-2 py-2 font-medium">
                  {flexRender(h.column.columnDef.header, h.getContext())}
                </th>
              ))}
            </tr>
          ))}
        </thead>
        <tbody>
          {table.getRowModel().rows.flatMap((r) => {
            const out: ReactNode[] = [];
            if (data.scope === "lead" && r.original.jobName !== lastJob) {
              lastJob = r.original.jobName;
              out.push(
                <tr key={`job-${r.id}`}>
                  <th colSpan={columns.length} scope="colgroup" className="bg-raised px-2 py-1.5 text-left text-sm font-medium text-copper">
                    {r.original.jobName}
                  </th>
                </tr>,
              );
            }
            out.push(
              <tr key={r.id} className="border-b border-line last:border-0" data-testid={`row-${r.original.userId}`}>
                {r.getVisibleCells().map((c) => (
                  <td key={c.id} className="px-2 py-1 text-center first:text-left [&:nth-child(2)]:text-left">
                    {flexRender(c.column.columnDef.cell, c.getContext())}
                  </td>
                ))}
              </tr>,
            );
            return out;
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Phones: a day list grouped by job, with tap-to-approve on clean days (spec frame 6). */
function PhoneDayList({
  data,
  rows,
  busy,
  onOpen,
  onApprove,
  onNudge,
}: {
  data: Week;
  rows: TimeRow[];
  busy: boolean;
  onOpen: (rowKey: string, day: string) => void;
  onApprove: (ids: string[]) => void;
  onNudge: (m: Missing, name: string) => void;
}) {
  const days = [...data.days].reverse().filter((d) => rows.some((r) => r.cells[d].entries.length || r.cells[d].missing));
  return (
    <div className="grid gap-4 md:hidden" data-testid="time-phone-list">
      {days.map((day) => {
        const l = weekdayLabel(day);
        return (
          <section key={day} className="grid gap-2">
            <h3 className="text-lg">
              {l.dow} {l.date}
            </h3>
            <ul className="grid gap-2">
              {rows
                .filter((r) => r.cells[day].entries.length || r.cells[day].missing)
                .map((r) => {
                  const cell = r.cells[day];
                  const jobs = [...new Set(cell.entries.map((e) => e.projectName || "No job"))].join(", ") || cell.missing?.projectName;
                  return (
                    <li key={r.key} className="grid gap-2 rounded-md border border-line bg-surface p-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate text-base text-fg">{r.name}</p>
                          <p className="truncate text-sm text-muted">{jobs}</p>
                        </div>
                        {cell.entries.length ? (
                          <span className="font-display text-xl tabular-nums">{formatMinutes(cell.minutes)}</span>
                        ) : (
                          <span className="text-sm font-medium text-danger">No report</span>
                        )}
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        {cell.status ? <StatusChip status={cell.status} /> : null}
                        {cell.flags.map((f) => (
                          <span key={f} className="text-sm text-danger">
                            ⚠ {FLAG_LABEL[f]}
                          </span>
                        ))}
                        <span className="flex-1" />
                        {cell.entries.length ? (
                          <Button tone="ghost" onClick={() => onOpen(r.key, day)}>
                            Open
                          </Button>
                        ) : null}
                        {cell.entries.length && data.can.approve && isClean(cell, data, r.userId) ? (
                          <Button disabled={busy} onClick={() => onApprove(cell.entries.map((e) => e.id))}>
                            Approve
                          </Button>
                        ) : null}
                        {cell.missing && !cell.entries.length && !cell.missing.nudged && data.can.approve ? (
                          <Button tone="ghost" onClick={() => onNudge(cell.missing!, r.name)}>
                            Nudge
                          </Button>
                        ) : null}
                      </div>
                    </li>
                  );
                })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

export function Sheet({
  open,
  onClose,
  title,
  side = "right",
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  side?: "right" | "center";
  children: ReactNode;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={(next) => (next ? null : onClose())}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/60" />
        <Dialog.Content
          aria-describedby={undefined}
          className={
            side === "right"
              ? "fixed inset-y-0 right-0 z-50 grid w-[min(100vw,36rem)] content-start gap-4 overflow-y-auto border-l border-line bg-surface p-5"
              : "fixed left-1/2 top-1/2 z-50 grid max-h-[90dvh] w-[min(92vw,32rem)] -translate-x-1/2 -translate-y-1/2 gap-3 overflow-y-auto rounded-md border border-line bg-surface p-5"
          }
        >
          <div className="flex items-start justify-between gap-3">
            <Dialog.Title className="font-display text-xl text-fg">{title}</Dialog.Title>
            <Dialog.Close className="h-11 rounded-md px-3 text-muted" aria-label="Close">
              ✕
            </Dialog.Close>
          </div>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function EntryDrawer({
  data,
  row,
  cell,
  busy,
  onClose,
  act,
}: {
  data: Week;
  row: TimeRow;
  cell: Cell;
  busy: boolean;
  onClose: () => void;
  act: (work: () => Promise<unknown>, done: string) => Promise<boolean>;
}) {
  const l = weekdayLabel(cell.day);
  // The whole day you can see, not just this job group: approve and reject act on the person-day.
  const lines = data.entries.filter((e) => e.userId === row.userId && e.day === cell.day);
  const minutes = lines.reduce((n, e) => n + e.minutes, 0);
  const status = dayStatusOf(lines.map((e) => e.status));
  const flags = flagsOf(lines);
  const [report, setReport] = useState<Awaited<ReturnType<typeof getTimeReport>> | undefined>(undefined);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [editing, setEditing] = useState("");
  const ids = lines.map((e) => e.id);
  const own = row.userId === data.meId && !data.can.selfApprove;
  const reportId = lines.find((e) => e.reportId)?.reportId ?? null;
  useEffect(() => {
    if (!reportId) return;
    getTimeReport({ data: { reportId } })
      .then(setReport)
      .catch(() => setReport(null));
  }, [reportId]);
  const submitted = lines.length > 0 && lines.every((e) => e.status === "submitted");
  const approved = lines.length > 0 && lines.every((e) => e.status === "approved");
  // Start, end and lunch belong to the day; show them once unless the lines disagree.
  const span = (e: (typeof lines)[number]) => `${clock12(e.start)} – ${clock12(e.end)} · Lunch ${e.lunchMinutes} min`;
  const daySpan = lines.length > 0 && lines.every((e) => span(e) === span(lines[0])) ? span(lines[0]) : null;

  return (
    <Sheet open onClose={onClose} title={`${row.name} · ${l.dow} ${l.date}`}>
      <div className="flex flex-wrap items-center gap-2">
        {status ? <StatusChip status={status} /> : null}
        <span className="font-display text-3xl tabular-nums">{formatMinutes(minutes)}</span>
        {flags.map((f) => (
          <span key={f} className="text-sm text-danger">
            ⚠ Check: {FLAG_LABEL[f]}
          </span>
        ))}
      </div>
      {daySpan ? <p className="text-sm text-muted tabular-nums">{daySpan}</p> : null}
      <ul className="grid gap-2" data-testid="drawer-lines">
        {lines.map((e) => (
          <li key={e.id} className="grid gap-2 rounded-md border border-line p-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="text-base text-fg">
                {e.projectName || "No job"} · {e.costCode ? `${e.costCode} ${e.costCodeName}` : "No cost code"}
              </p>
              <span className="tabular-nums">{formatMinutes(e.minutes)}</span>
            </div>
            {daySpan ? null : <p className="text-sm text-muted tabular-nums">{span(e)}</p>}
            <div className="flex flex-wrap items-center gap-2">
              <SourceChip source={e.source} />
              {e.editedByName ? <span className="text-xs text-muted">Edited by {e.editedByName}</span> : null}
              {e.status === "rejected" ? <span className="text-sm text-danger">Sent back: {e.rejectReason}</span> : null}
              {e.approvedByName && e.status !== "rejected" ? <span className="text-xs text-muted">Approved by {e.approvedByName}</span> : null}
              <span className="flex-1" />
              {data.can.approve && !own && (e.status === "submitted" || e.status === "rejected") ? (
                <button type="button" className="h-11 px-2 text-sm text-copper underline" onClick={() => setEditing(editing === e.id ? "" : e.id)}>
                  {editing === e.id ? "Cancel edit" : "Edit"}
                </button>
              ) : null}
            </div>
            {editing === e.id ? (
              <EditLine
                entry={e}
                data={data}
                busy={busy}
                onSave={(patch) =>
                  void act(() => editTime({ data: { id: e.id, ...patch } }), "Saved the change.").then((ok) => ok && setEditing(""))
                }
              />
            ) : null}
          </li>
        ))}
      </ul>

      {own ? <p className="text-base text-muted">These are your own hours. An admin or owner approves them.</p> : null}
      {data.can.approve && !own && submitted ? (
        rejecting ? (
          <div className="grid gap-2">
            <label htmlFor="reject-reason" className="text-sm text-muted">
              Why? They'll see this and fix the report.
            </label>
            <textarea id="reject-reason" className="field min-h-24" value={reason} onChange={(e) => setReason(e.target.value)} />
            <div className="flex gap-2">
              <Button
                disabled={busy || !reason.trim()}
                onClick={() => void act(() => rejectTime({ data: { ids, reason } }), "Sent back.").then((ok) => ok && onClose())}
              >
                Send back
              </Button>
              <Button tone="quiet" onClick={() => setRejecting(false)}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            <Button disabled={busy} onClick={() => void act(() => approveTime({ data: { ids } }), "Approved.").then((ok) => ok && onClose())}>
              Approve
            </Button>
            <Button tone="ghost" onClick={() => setRejecting(true)}>
              Reject
            </Button>
          </div>
        )
      ) : null}
      {data.can.unlock && approved ? (
        <Button tone="ghost" disabled={busy} onClick={() => void act(() => unlockTime({ data: { ids } }), "Reopened.").then((ok) => ok && onClose())}>
          Reopen
        </Button>
      ) : null}

      <section className="grid gap-2">
        <h3 className="text-lg">Daily report</h3>
        {report === undefined && reportId ? <Skeleton lines={2} label="Loading the report" /> : null}
        {report ? <ReportCard report={report} showPerson={false} /> : null}
        {report === null || !reportId ? <p className="text-base text-muted">No report linked.</p> : null}
      </section>
    </Sheet>
  );
}

function EditLine({
  entry,
  data,
  busy,
  onSave,
}: {
  entry: Entry;
  data: Week;
  busy: boolean;
  onSave: (patch: { projectId: string | null; costCodeId: string | null; minutes: number }) => void;
}) {
  const [projectId, setProjectId] = useState(entry.projectId ?? "");
  const [costCodeId, setCostCodeId] = useState(entry.costCodeId ?? "");
  const [hours, setHours] = useState(`${Math.floor(entry.minutes / 60)}:${String(entry.minutes % 60).padStart(2, "0")}`);
  const minutes = parseHoursInput(hours);
  return (
    <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_6rem]">
      <select aria-label="Job" className="field min-w-0" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
        <option value="">No job</option>
        {data.jobs.map((j) => (
          <option key={j.id} value={j.id}>
            {j.name}
          </option>
        ))}
      </select>
      <select aria-label="Cost code" className="field min-w-0" value={costCodeId} onChange={(e) => setCostCodeId(e.target.value)}>
        <option value="">No cost code</option>
        {data.costCodes.map((c) => (
          <option key={c.id} value={c.id}>
            {c.code} {c.name}
          </option>
        ))}
      </select>
      <input aria-label="Hours" className="field tabular-nums" value={hours} onChange={(e) => setHours(e.target.value)} />
      <Button className="sm:col-span-3" disabled={busy || minutes == null} onClick={() => onSave({ projectId: projectId || null, costCodeId: costCodeId || null, minutes: minutes ?? 0 })}>
        Save change
      </Button>
    </div>
  );
}

type Preview = Awaited<ReturnType<typeof previewPayroll>>;
type Exports = Awaited<ReturnType<typeof listPayrollExports>>;

function ExportSheet({
  open,
  onClose,
  canVoid,
  onChanged,
  onShow,
}: {
  open: boolean;
  onClose: () => void;
  canVoid: boolean;
  onChanged: () => void;
  onShow: (day: string) => void;
}) {
  const online = useOnline();
  const [kind, setKind] = useState<"payroll" | "sub_hours">("payroll");
  const [period, setPeriod] = useState({ start: "", end: "" });
  const [preview, setPreview] = useState<Preview | null>(null);
  const [history, setHistory] = useState<Exports | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [tick, setTick] = useState(0);
  const [confirmVoid, setConfirmVoid] = useState("");

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setError("");
    previewPayroll({ data: { start: period.start || undefined, end: period.end || undefined, kind } })
      .then((p) => {
        if (cancelled) return;
        setPreview(p);
        setPeriod((v) => (v.start ? v : p.period));
      })
      .catch((cause: unknown) => !cancelled && setError(errText(cause, "Could not check the period.")));
    listPayrollExports()
      .then((h) => !cancelled && setHistory(h))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [open, kind, period.start, period.end, tick]);

  const blocking = preview?.notApproved.length ?? 0;
  return (
    <Sheet open={open} onClose={onClose} title="Payroll export">
      <fieldset className="flex flex-wrap gap-4">
        <legend className="sr-only">Export</legend>
        {(["payroll", "sub_hours"] as const).map((k) => (
          <label key={k} className="flex min-h-11 items-center gap-2 text-base">
            <input type="radio" name="export-kind" className="size-5 accent-copper" checked={kind === k} onChange={() => setKind(k)} />
            {k === "payroll" ? "Payroll" : "Sub hours"}
          </label>
        ))}
      </fieldset>
      <div className="grid grid-cols-2 gap-3">
        <label className="grid gap-1 text-sm text-muted">
          From
          <input type="date" className="field" value={period.start} onChange={(e) => setPeriod((v) => ({ ...v, start: e.target.value }))} />
        </label>
        <label className="grid gap-1 text-sm text-muted">
          To
          <input type="date" className="field" value={period.end} onChange={(e) => setPeriod((v) => ({ ...v, end: e.target.value }))} />
        </label>
      </div>
      {error ? <ErrorBanner message={error} /> : null}
      {!preview && !error ? <Skeleton lines={2} label="Checking the period" /> : null}
      {preview ? (
        <ul className="grid gap-1 text-base" data-testid="export-checks">
          {blocking ? (
            <li className="text-danger">
              ⚠ {blocking} {blocking === 1 ? "entry" : "entries"} not approved.{" "}
              <button type="button" className="min-h-11 underline" onClick={() => onShow(preview.period.start)}>
                Show them
              </button>
            </li>
          ) : (
            <li className="text-pine">✓ Everything in the period is approved.</li>
          )}
          {kind === "payroll" ? <li className="text-muted">Sub hours excluded{preview.subExcluded ? ` (${preview.subExcluded})` : ""}.</li> : null}
          {preview.alreadyExported ? <li className="text-muted">{preview.alreadyExported} already exported, left out.</li> : null}
          <li className="text-muted">
            {preview.rowCount} {preview.rowCount === 1 ? "row" : "rows"} · {preview.filename}
          </li>
        </ul>
      ) : null}
      {preview && preview.preview.length ? (
        <div className="min-w-0 overflow-x-auto rounded-md border border-line">
          <table className="w-full text-sm" data-testid="export-preview">
            <thead className="text-left text-muted">
              <tr>
                <th className="px-2 py-1 font-medium">Name</th>
                <th className="px-2 py-1 font-medium">Date</th>
                <th className="px-2 py-1 font-medium">Job</th>
                <th className="px-2 py-1 font-medium">Code</th>
                <th className="px-2 py-1 text-right font-medium">Reg</th>
                <th className="px-2 py-1 text-right font-medium">OT</th>
              </tr>
            </thead>
            <tbody>
              {preview.preview.map((r, i) => (
                <tr key={i} className="border-t border-line">
                  <td className="px-2 py-1">{r.employeeName}</td>
                  <td className="px-2 py-1 tabular-nums">{r.workDate}</td>
                  <td className="px-2 py-1">{r.jobName}</td>
                  <td className="px-2 py-1">{r.costCode}</td>
                  <td className="px-2 py-1 text-right tabular-nums">{(r.regularMinutes / 60).toFixed(2)}</td>
                  <td className="px-2 py-1 text-right tabular-nums">{(r.overtimeMinutes / 60).toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      <Button
        disabled={busy || !online || !preview || blocking > 0 || preview.rowCount === 0}
        onClick={async () => {
          setBusy(true);
          setError("");
          try {
            const r = await runPayroll({ data: { start: period.start, end: period.end, kind } });
            download(r.filename, r.csv);
            setTick((n) => n + 1);
            onChanged();
          } catch (cause) {
            setError(errText(cause, "Could not export."));
          } finally {
            setBusy(false);
          }
        }}
      >
        Download CSV
      </Button>
      <p className="text-sm text-muted">Downloading marks these hours exported. Nobody can change them until the export is voided.</p>

      <section className="grid gap-2">
        <h3 className="text-lg">Past exports</h3>
        {history && history.length === 0 ? <p className="text-base text-muted">None yet.</p> : null}
        <ul className="grid gap-2" data-testid="export-history">
          {(history ?? []).map((x) => (
            <li key={x.id} className="grid gap-2 rounded-md border border-line p-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="text-base">
                  {x.kind === "payroll" ? "Payroll" : "Sub hours"} · {x.periodStart} to {x.periodEnd}
                </span>
                <span className="text-sm text-muted">{x.rowCount} rows</span>
              </div>
              <p className="text-sm text-muted">
                By {x.createdByName} · {new Date(x.createdAt).toLocaleString()}
                {x.voidedAt ? ` · Void (${x.voidedByName})` : ""}
              </p>
              <div className="flex flex-wrap gap-2">
                <Button tone="ghost" onClick={() => void getPayrollCsv({ data: { id: x.id } }).then((r) => download(r.filename, r.csv))}>
                  Download again
                </Button>
                {canVoid && !x.voidedAt ? (
                  confirmVoid === x.id ? (
                    <>
                      <Button
                        disabled={busy || !online}
                        onClick={async () => {
                          setBusy(true);
                          try {
                            await voidPayroll({ data: { id: x.id } });
                            setConfirmVoid("");
                            setTick((n) => n + 1);
                            onChanged();
                          } catch (cause) {
                            setError(errText(cause, "Could not void it."));
                          } finally {
                            setBusy(false);
                          }
                        }}
                      >
                        Yes, void it
                      </Button>
                      <Button tone="quiet" onClick={() => setConfirmVoid("")}>
                        Keep it
                      </Button>
                    </>
                  ) : (
                    <Button tone="quiet" onClick={() => setConfirmVoid(x.id)}>
                      Void export
                    </Button>
                  )
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      </section>
    </Sheet>
  );
}

type Rates = Awaited<ReturnType<typeof listPayRates>>;

function RatesSheet({ open, onClose, onChanged }: { open: boolean; onClose: () => void; onChanged: () => void }) {
  const online = useOnline();
  const [rates, setRates] = useState<Rates | null>(null);
  const [error, setError] = useState("");
  const [tick, setTick] = useState(0);
  const [form, setForm] = useState<{ userId: string; rate: string; burden: string; effectiveOn: string } | null>(null);
  useEffect(() => {
    if (!open) return;
    listPayRates()
      .then(setRates)
      .catch((cause: unknown) => setError(errText(cause, "Could not load pay rates.")));
  }, [open, tick]);
  const today = new Date().toISOString().slice(0, 10);
  return (
    <Sheet open={open} onClose={onClose} title="Pay rates">
      <p className="text-base text-muted">Only owners and admins see these. They price approved hours on job budgets.</p>
      {error ? <ErrorBanner message={error} /> : null}
      {!rates && !error ? <Skeleton lines={3} label="Loading pay rates" /> : null}
      <ul className="grid gap-2" data-testid="pay-rates">
        {(rates ?? []).map((p) => (
          <li key={p.userId} className="grid gap-2 rounded-md border border-line p-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="text-base">{p.name}</span>
              <span className="tabular-nums text-muted">
                {p.current ? `${money(p.current.rateCents).replace(".00", "")}/h · +${p.current.burdenPct}% burden` : "No rate"}
              </span>
            </div>
            {form?.userId === p.userId ? (
              <div className="grid grid-cols-3 gap-2">
                <label className="grid gap-1 text-sm text-muted">
                  $/hour
                  <input className="field" inputMode="decimal" value={form.rate} onChange={(e) => setForm({ ...form, rate: e.target.value })} />
                </label>
                <label className="grid gap-1 text-sm text-muted">
                  Burden %
                  <input className="field" inputMode="decimal" value={form.burden} onChange={(e) => setForm({ ...form, burden: e.target.value })} />
                </label>
                <label className="grid gap-1 text-sm text-muted">
                  From
                  <input type="date" className="field" value={form.effectiveOn} onChange={(e) => setForm({ ...form, effectiveOn: e.target.value })} />
                </label>
                <Button
                  className="col-span-3"
                  disabled={!online}
                  onClick={async () => {
                    setError("");
                    try {
                      await setPayRate({
                        data: { userId: p.userId, rateCents: Math.round(Number(form.rate) * 100), burdenPct: Number(form.burden || 0), effectiveOn: form.effectiveOn },
                      });
                      setForm(null);
                      setTick((n) => n + 1);
                      onChanged();
                    } catch (cause) {
                      setError(errText(cause, "Could not save the rate."));
                    }
                  }}
                >
                  Save rate
                </Button>
              </div>
            ) : (
              <Button
                tone="ghost"
                className="justify-self-start"
                onClick={() =>
                  setForm({
                    userId: p.userId,
                    rate: p.current ? String(p.current.rateCents / 100) : "",
                    burden: p.current ? String(p.current.burdenPct) : "0",
                    effectiveOn: today,
                  })
                }
              >
                {p.current ? "Change rate" : "Set rate"}
              </Button>
            )}
          </li>
        ))}
      </ul>
    </Sheet>
  );
}
