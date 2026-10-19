import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { CalendarRange, ChevronLeft, ChevronRight } from "lucide-react";
import {
  assignCrew,
  copyCrewLastWeek,
  getCrewBoard,
  getCrewCertsMatrix,
  getCrewPerson,
  getMyCrewWeek,
  inviteCrew,
  listCrewCertTypes,
  listCrewTrades,
  loadDesk,
  publishCrewWeek,
  removeCrewAssignment,
  requestCrewOff,
  setCrewPersonTrade,
  upsertCrewPersonCert,
} from "@/lib/server/fns";
import { Button, Chip, EmptyState, ErrorBanner, Panel, Skeleton } from "@/components/ui";
import { can } from "@/lib/permissions";
import { invitableRoles } from "@/lib/permissions";
import { roleLabel, SUPER_ADMIN_PHONE_DISPLAY, samePhone } from "@/lib/roles";
import { CERT_EXPIRING_DAYS, addDays, certHealthLabel, formatWeekLabel, shortJobName, todayIso, weekStart, type CertHealth } from "@/lib/crew";
import { useOnline } from "@/lib/use-online";

type Board = Awaited<ReturnType<typeof getCrewBoard>>;
type Tab = "board" | "people" | "certs" | "team";

const HEALTH_CLASS: Record<CertHealth, string> = {
  ok: "bg-pine",
  expiring: "bg-copper",
  expired: "bg-danger",
  missing: "bg-danger",
};

export function CrewView({ role, onOpenSharing }: { role: string; onOpenSharing?: (projectId: string) => void }) {
  const [tab, setTab] = useState<Tab>("board");
  const canBoard = can(role, "crew.board.view");
  const canInvite = can(role, "crew.invite");

  useEffect(() => {
    if (!canBoard && tab !== "team") setTab(canInvite ? "team" : "board");
  }, [canBoard, canInvite, tab]);

  const tabs: { id: Tab; label: string; show: boolean }[] = [
    { id: "board", label: "Board", show: canBoard },
    { id: "people", label: "People", show: canBoard },
    { id: "certs", label: "Certs", show: canBoard && can(role, "skill.manage") },
    { id: "team", label: "Team", show: canInvite },
  ];

  return (
    <div className="grid min-w-0 gap-4" data-testid="crew-view">
      <div className="flex gap-1 overflow-x-auto border-b border-line" role="tablist" aria-label="Crew">
        {tabs
          .filter((t) => t.show)
          .map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => setTab(t.id)}
              className={`h-11 shrink-0 border-b-2 px-3 text-sm ${tab === t.id ? "border-copper text-fg" : "border-transparent text-muted"}`}
            >
              {t.label}
            </button>
          ))}
      </div>
      {tab === "board" && canBoard ? <BoardPane onOpenSharing={onOpenSharing} /> : null}
      {tab === "people" && canBoard ? <PeoplePane canManage={can(role, "skill.manage")} /> : null}
      {tab === "certs" && canBoard ? <CertsPane /> : null}
      {tab === "team" && canInvite ? <InvitePane /> : null}
    </div>
  );
}

function BoardPane({ onOpenSharing }: { onOpenSharing?: (projectId: string) => void }) {
  const online = useOnline();
  const [week, setWeek] = useState(() => weekStart(todayIso()));
  const [board, setBoard] = useState<Board | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [assign, setAssign] = useState<{ userId: string; day: string } | null>(null);
  const [publishWarn, setPublishWarn] = useState<Board["conflicts"] | null>(null);
  const [conflictsOnly, setConflictsOnly] = useState(false);

  const load = useCallback(() => {
    setError("");
    getCrewBoard({ data: { week } })
      .then(setBoard)
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "Could not load the board."));
  }, [week]);

  useEffect(() => {
    setBoard(null);
    load();
  }, [load]);

  const conflictUserDays = useMemo(() => {
    const set = new Set<string>();
    for (const c of board?.conflicts ?? []) set.add(`${c.userId}|${c.day}`);
    return set;
  }, [board]);

  async function saveAssign(projectId: string, part: string) {
    if (!assign) return;
    setBusy(true);
    setError("");
    try {
      await assignCrew({ data: { userId: assign.userId, projectId, day: assign.day, part } });
      setAssign(null);
      load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not assign.");
    } finally {
      setBusy(false);
    }
  }

  async function publish(confirmWarnings = false) {
    setBusy(true);
    setError("");
    try {
      const result = await publishCrewWeek({ data: { week, confirmWarnings } });
      if (result.warnings.length && !confirmWarnings) {
        setPublishWarn(result.warnings);
      } else {
        setPublishWarn(null);
        load();
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not publish.");
    } finally {
      setBusy(false);
    }
  }

  if (error && !board) return <ErrorBanner message={error} onRetry={load} />;
  if (!board) return <Skeleton lines={8} label="Loading the crew board" />;

  const people = conflictsOnly
    ? board.people.filter((p) => board.days.some((d) => conflictUserDays.has(`${p.userId}|${d}`)))
    : board.people;
  const inHouse = people.filter((p) => !p.subCompany);
  const bySub = new Map<string, typeof people>();
  for (const p of people.filter((x) => x.subCompany)) {
    const list = bySub.get(p.subCompany) ?? [];
    list.push(p);
    bySub.set(p.subCompany, list);
  }

  return (
    <div className="grid min-w-0 gap-4 lg:grid-cols-[1fr_18rem]">
      <div className="grid min-w-0 gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className="inline-flex h-11 w-11 items-center justify-center rounded-md border border-line" aria-label="Previous week" onClick={() => setWeek(addDays(week, -7))}>
            <ChevronLeft className="size-5" aria-hidden />
          </button>
          <p className="min-w-[9rem] text-center font-display text-lg">{formatWeekLabel(week)}</p>
          <button type="button" className="inline-flex h-11 w-11 items-center justify-center rounded-md border border-line" aria-label="Next week" onClick={() => setWeek(addDays(week, 7))}>
            <ChevronRight className="size-5" aria-hidden />
          </button>
          <button type="button" className="h-11 rounded-md border border-line px-3 text-sm" onClick={() => setWeek(weekStart(todayIso()))}>
            Today
          </button>
          <button
            type="button"
            className={`h-11 rounded-md border px-3 text-sm ${conflictsOnly ? "border-copper bg-copper text-ink" : "border-line"}`}
            onClick={() => setConflictsOnly((v) => !v)}
          >
            {board.conflicts.length} conflict{board.conflicts.length === 1 ? "" : "s"}
          </button>
          <div className="ml-auto flex flex-wrap gap-2">
            {board.canAssign ? (
              <Button type="button" tone="ghost" disabled={!online || busy} onClick={() => void copyCrewLastWeek({ data: { week } }).then(load).catch((c: unknown) => setError(c instanceof Error ? c.message : "Copy failed"))}>
                Copy last week
              </Button>
            ) : null}
            {board.canPublish ? (
              <Button type="button" disabled={!online || busy || board.draftCount === 0} onClick={() => void publish(false)}>
                Publish ({board.draftCount})
              </Button>
            ) : null}
          </div>
        </div>
        {error ? <ErrorBanner message={error} onRetry={() => setError("")} /> : null}
        {people.length === 0 ? (
          <EmptyState title="No crew yet" body="Invite people from the Team tab." />
        ) : (
          <div className="min-w-0 overflow-x-auto rounded-md border border-line" data-testid="crew-board-grid">
            <table className="w-full min-w-[40rem] border-collapse text-left text-sm">
              <thead>
                <tr className="text-muted">
                  <th className="sticky left-0 bg-surface p-2 font-normal">Person</th>
                  {board.days.map((d) => (
                    <th key={d} className="p-2 font-normal">
                      {new Date(`${d}T12:00:00`).toLocaleDateString("en-US", { weekday: "short", day: "numeric" })}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {inHouse.length ? (
                  <tr>
                    <td colSpan={7} className="bg-raised px-2 py-1 text-xs uppercase tracking-wide text-muted">
                      In-house
                    </td>
                  </tr>
                ) : null}
                {inHouse.map((person) => (
                  <PersonRow key={person.userId} person={person} days={board.days} board={board} conflictUserDays={conflictUserDays} onCell={(day) => board.canAssign && setAssign({ userId: person.userId, day })} onRemove={(id) => void removeCrewAssignment({ data: { id } }).then(load)} />
                ))}
                {[...bySub.entries()].map(([company, list]) => (
                  <Fragment key={company}>
                    <tr>
                      <td colSpan={7} className="bg-raised px-2 py-1 text-xs uppercase tracking-wide text-muted">
                        {company}
                      </td>
                    </tr>
                    {list.map((person) => (
                      <PersonRow key={person.userId} person={person} days={board.days} board={board} conflictUserDays={conflictUserDays} onCell={(day) => board.canAssign && setAssign({ userId: person.userId, day })} onRemove={(id) => void removeCrewAssignment({ data: { id } }).then(load)} />
                    ))}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-xs text-muted">
          Cert “Expiring” window: {CERT_EXPIRING_DAYS} days [DECIDE]. Draft = dashed border; published = solid.
        </p>
      </div>
      <aside className="grid min-w-0 content-start gap-3" aria-label="Jobs this week">
        <h2 className="font-display text-lg">Jobs this week</h2>
        {board.jobs.map((job) => (
          <article key={job.projectId} className="grid gap-2 rounded-md border border-line bg-surface p-3" data-testid="crew-job-card">
            <div className="flex min-w-0 items-start justify-between gap-2">
              <p className="min-w-0 truncate font-medium text-fg">{job.name}</p>
              {job.sharingReviewNeeded && onOpenSharing ? (
                <button type="button" className="shrink-0 rounded-full bg-copper px-2 py-0.5 text-xs font-semibold text-ink" onClick={() => onOpenSharing(job.projectId)}>
                  Sharing review needed
                </button>
              ) : null}
            </div>
            <p className="text-xs text-muted">{job.headcount.join("·")}</p>
            {job.requiredCerts.length ? <p className="text-xs text-muted">Needs: {job.requiredCerts.map((c) => c.name).join(", ")}</p> : null}
            {board.canAssign && job.isLead ? (
              <Button
                type="button"
                tone="ghost"
                disabled={!online}
                onClick={() => {
                  const first = board.people[0];
                  if (first) setAssign({ userId: first.userId, day: board.days[0] });
                }}
              >
                + Assign
              </Button>
            ) : null}
          </article>
        ))}
      </aside>

      {assign ? (
        <AssignPopover
          board={board}
          userId={assign.userId}
          day={assign.day}
          busy={busy}
          onClose={() => setAssign(null)}
          onSave={(projectId, part) => void saveAssign(projectId, part)}
        />
      ) : null}

      {publishWarn ? (
        <div className="fixed inset-0 z-40 grid place-items-center bg-black/60 p-4" role="dialog" aria-label="Publish with warnings">
          <div className="grid w-full max-w-md gap-3 rounded-md border border-line bg-surface p-5">
            <h2 className="font-display text-xl">Publish anyway?</h2>
            <p className="text-sm text-muted">There are cert or orientation warnings:</p>
            <ul className="grid gap-1 text-sm">
              {publishWarn.slice(0, 8).map((w, i) => (
                <li key={i}>{w.label}</li>
              ))}
            </ul>
            <div className="flex justify-end gap-2">
              <Button type="button" tone="ghost" onClick={() => setPublishWarn(null)}>
                Cancel
              </Button>
              <Button type="button" disabled={busy} onClick={() => void publish(true)}>
                Publish anyway
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function PersonRow({
  person,
  days,
  board,
  conflictUserDays,
  onCell,
  onRemove,
}: {
  person: Board["people"][number];
  days: string[];
  board: Board;
  conflictUserDays: Set<string>;
  onCell: (day: string) => void;
  onRemove: (id: string) => void;
}) {
  return (
    <tr data-testid={`crew-row-${person.userId}`}>
      <th className="sticky left-0 bg-surface p-2 text-left font-normal">
        <div className="flex min-w-0 items-center gap-2">
          <span className={`inline-block size-2.5 shrink-0 rounded-full ${HEALTH_CLASS[person.certHealth]}`} title={certHealthLabel(person.certHealth)} aria-label={`Certs ${certHealthLabel(person.certHealth)}`} />
          <div className="min-w-0">
            <p className="truncate text-fg">{person.name}</p>
            <p className="truncate text-xs text-muted">
              {person.trades
                .slice(0, 2)
                .map((t) => t.name)
                .join(" · ")}
              {person.trades.length > 2 ? ` +${person.trades.length - 2}` : ""}
            </p>
          </div>
        </div>
      </th>
      {days.map((day) => {
        const cells = board.assignments.filter((a) => a.userId === person.userId && a.day === day);
        const off = board.unavailability.find((u) => u.userId === person.userId && day >= u.fromDay && day <= u.toDay);
        const hasConflict = conflictUserDays.has(`${person.userId}|${day}`);
        return (
          <td key={day} className="p-1 align-top">
            <button
              type="button"
              className="grid min-h-11 w-full min-w-[4.5rem] gap-1 rounded-md border border-transparent p-1 text-left hover:border-line"
              onClick={() => onCell(day)}
              aria-label={`${person.name} ${day}`}
            >
              {off ? (
                <span className="rounded bg-[repeating-linear-gradient(-45deg,transparent,transparent_3px,rgba(0,0,0,0.08)_3px,rgba(0,0,0,0.08)_6px)] px-1 py-0.5 text-xs text-muted">
                  {off.reason.toUpperCase()}
                  {off.status === "requested" ? "?" : ""}
                </span>
              ) : null}
              {cells.map((a) => (
                <span
                  key={a.id}
                  className={`flex items-center justify-between gap-1 rounded border px-1 py-0.5 text-xs ${a.status === "draft" ? "border-dashed border-copper" : "border-line"}`}
                >
                  <span className="truncate">
                    {shortJobName(a.projectName)}
                    {a.part !== "full" ? ` ${a.part.toUpperCase()}` : ""}
                    {hasConflict ? " ⚠" : ""}
                  </span>
                  {board.canAssign && a.status === "draft" ? (
                    <span
                      role="button"
                      tabIndex={0}
                      className="text-muted underline"
                      onClick={(e) => {
                        e.stopPropagation();
                        onRemove(a.id);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.stopPropagation();
                          onRemove(a.id);
                        }
                      }}
                    >
                      ×
                    </span>
                  ) : null}
                </span>
              ))}
            </button>
          </td>
        );
      })}
    </tr>
  );
}

function AssignPopover({
  board,
  userId,
  day,
  busy,
  onClose,
  onSave,
}: {
  board: Board;
  userId: string;
  day: string;
  busy: boolean;
  onClose: () => void;
  onSave: (projectId: string, part: string) => void;
}) {
  const [projectId, setProjectId] = useState(board.jobs.find((j) => j.isLead)?.projectId ?? board.jobs[0]?.projectId ?? "");
  const [part, setPart] = useState("full");
  const person = board.people.find((p) => p.userId === userId);
  return (
    <div className="fixed inset-0 z-40 grid place-items-end bg-black/40 p-4 sm:place-items-center" role="dialog" aria-label="Assign">
      <div className="grid w-full max-w-sm gap-3 rounded-md border border-line bg-surface p-4">
        <h2 className="font-display text-lg">
          Assign {person?.name} · {day}
        </h2>
        <label className="grid gap-1 text-sm text-muted">
          Job
          <select className="field" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
            {board.jobs.filter((j) => j.isLead).map((j) => (
              <option key={j.projectId} value={j.projectId}>
                {j.name}
              </option>
            ))}
          </select>
        </label>
        <div className="grid grid-cols-3 gap-1" role="group" aria-label="Part of day">
          {(["full", "am", "pm"] as const).map((p) => (
            <button key={p} type="button" className={`h-11 rounded-md border text-sm ${part === p ? "border-copper bg-copper text-ink" : "border-line"}`} onClick={() => setPart(p)}>
              {p.toUpperCase()}
            </button>
          ))}
        </div>
        <div className="flex justify-end gap-2">
          <Button type="button" tone="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" disabled={busy || !projectId} onClick={() => onSave(projectId, part)}>
            Save
          </Button>
        </div>
      </div>
    </div>
  );
}

function PeoplePane({ canManage }: { canManage: boolean }) {
  const [board, setBoard] = useState<Board | null>(null);
  const [selected, setSelected] = useState("");
  const [detail, setDetail] = useState<Awaited<ReturnType<typeof getCrewPerson>> | null>(null);
  const [trades, setTrades] = useState<Awaited<ReturnType<typeof listCrewTrades>>>([]);
  const [certs, setCerts] = useState<Awaited<ReturnType<typeof listCrewCertTypes>>>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    getCrewBoard({ data: {} })
      .then(setBoard)
      .catch((c: unknown) => setError(c instanceof Error ? c.message : "Could not load people."));
    if (canManage) {
      void listCrewTrades().then(setTrades);
      void listCrewCertTypes().then(setCerts);
    }
  }, [canManage]);

  useEffect(() => {
    if (!selected) return;
    getCrewPerson({ data: { userId: selected } })
      .then(setDetail)
      .catch((c: unknown) => setError(c instanceof Error ? c.message : "Could not load person."));
  }, [selected]);

  if (error && !board) return <ErrorBanner message={error} />;
  if (!board) return <Skeleton lines={4} label="Loading people" />;

  return (
    <div className="grid gap-4 md:grid-cols-[16rem_1fr]" data-testid="crew-people">
      <ul className="grid content-start gap-1">
        {board.people.map((p) => (
          <li key={p.userId}>
            <button type="button" className={`flex h-11 w-full items-center justify-between rounded-md px-3 text-left text-sm ${selected === p.userId ? "bg-raised" : ""}`} onClick={() => setSelected(p.userId)}>
              <span className="truncate">{p.name}</span>
              <Chip>{roleLabel(p.role)}</Chip>
            </button>
          </li>
        ))}
      </ul>
      {detail ? (
        <div className="grid gap-3">
          <h2 className="font-display text-2xl">{detail.person.name}</h2>
          <p className="text-sm text-muted">
            {roleLabel(detail.person.role)}
            {detail.person.subCompany ? ` · ${detail.person.subCompany}` : ""}
          </p>
          <Panel title="Trades">
            <div className="flex flex-wrap gap-2">
              {detail.person.trades.map((t) => (
                <Chip key={t.id}>
                  {t.name} · {t.level}
                </Chip>
              ))}
              {!detail.person.trades.length ? <p className="text-sm text-muted">No trades yet.</p> : null}
            </div>
            {canManage ? (
              <form
                className="mt-2 flex flex-wrap gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  const fd = new FormData(e.currentTarget);
                  const tradeId = String(fd.get("trade") || "");
                  if (!tradeId) return;
                  void setCrewPersonTrade({ data: { userId: selected, tradeId, level: String(fd.get("level") || "journeyman") } })
                    .then(() => getCrewPerson({ data: { userId: selected } }).then(setDetail))
                    .catch((c: unknown) => setError(c instanceof Error ? c.message : "Could not save trade."));
                }}
              >
                <select name="trade" className="field" required defaultValue="">
                  <option value="" disabled>
                    Add trade
                  </option>
                  {trades.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
                <select name="level" className="field" defaultValue="journeyman">
                  <option value="apprentice">Apprentice</option>
                  <option value="journeyman">Journeyman</option>
                  <option value="lead">Lead</option>
                </select>
                <Button type="submit">Add</Button>
              </form>
            ) : null}
          </Panel>
          <Panel title="Certifications">
            {detail.certs.length === 0 ? <p className="text-sm text-muted">No certifications on file. Add OSHA 10 first, most jobs need it.</p> : null}
            <ul className="grid gap-2">
              {detail.certs.map((c) => (
                <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                  <span>
                    {c.name} {c.expiresOn ? `· exp ${c.expiresOn}` : ""}
                  </span>
                  <Chip hot={c.health === "expired" || c.health === "missing"}>{certHealthLabel(c.health)}</Chip>
                </li>
              ))}
            </ul>
            {canManage ? (
              <form
                className="mt-2 grid gap-2 sm:grid-cols-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  const fd = new FormData(e.currentTarget);
                  void upsertCrewPersonCert({
                    data: {
                      userId: selected,
                      certTypeId: String(fd.get("cert") || ""),
                      number: String(fd.get("number") || ""),
                      expiresOn: String(fd.get("expires") || "") || undefined,
                    },
                  })
                    .then(() => getCrewPerson({ data: { userId: selected } }).then(setDetail))
                    .catch((c: unknown) => setError(c instanceof Error ? c.message : "Could not save cert."));
                  e.currentTarget.reset();
                }}
              >
                <select name="cert" className="field" required defaultValue="">
                  <option value="" disabled>
                    Cert type
                  </option>
                  {certs.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
                <input name="number" className="field" placeholder="Number" />
                <input name="expires" type="date" className="field" aria-label="Expires" />
                <Button type="submit">Save cert</Button>
              </form>
            ) : null}
          </Panel>
          {error ? <ErrorBanner message={error} /> : null}
        </div>
      ) : (
        <EmptyState title="Select a person" body="Trades, certs, and availability show here." />
      )}
    </div>
  );
}

function CertsPane() {
  const [matrix, setMatrix] = useState<Awaited<ReturnType<typeof getCrewCertsMatrix>> | null>(null);
  const [error, setError] = useState("");
  const [expiringOnly, setExpiringOnly] = useState(false);
  useEffect(() => {
    getCrewCertsMatrix()
      .then(setMatrix)
      .catch((c: unknown) => setError(c instanceof Error ? c.message : "Could not load certs."));
  }, []);
  if (error) return <ErrorBanner message={error} />;
  if (!matrix) return <Skeleton lines={6} label="Loading certs matrix" />;
  return (
    <div className="grid min-w-0 gap-3" data-testid="crew-certs">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm text-fg">
          {matrix.expiringCount} expire in the next {matrix.certExpiringDays} days
        </p>
        <button type="button" className={`h-11 rounded-md border px-3 text-sm ${expiringOnly ? "border-copper bg-copper text-ink" : "border-line"}`} onClick={() => setExpiringOnly((v) => !v)}>
          Expiring only
        </button>
      </div>
      <div className="min-w-0 overflow-x-auto rounded-md border border-line">
        <table className="w-full min-w-[36rem] text-left text-sm">
          <thead className="text-muted">
            <tr>
              <th className="p-2 font-normal">Person</th>
              {matrix.certTypes.map((c) => (
                <th key={c.id} className="p-2 font-normal">
                  {c.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {matrix.people.map((p) => {
              const rowCells = matrix.certTypes.map((c) => matrix.cells[`${p.userId}|${c.id}`] ?? null);
              if (expiringOnly && !rowCells.some((c) => c?.health === "expiring")) return null;
              return (
                <tr key={p.userId} className="border-t border-line">
                  <td className="p-2">{p.name}</td>
                  {rowCells.map((cell, i) => (
                    <td key={i} className={`p-2 ${cell?.health === "expiring" ? "text-copper" : cell?.health === "expired" || cell?.health === "missing" ? "text-danger" : ""}`}>
                      {cell?.expiresOn || "—"}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function InvitePane() {
  // Re-use the existing invite flow via loadDesk profile — thin wrapper calling inviteCrew.
  const [channel, setChannel] = useState<"email" | "sms">("email");
  const [destination, setDestination] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState("labor");
  const [sent, setSent] = useState("");
  const [error, setError] = useState("");
  const [roles, setRoles] = useState<string[]>(["lead", "labor", "sub"]);

  useEffect(() => {
    void loadDesk().then((d) => {
      if (!d.needsSetup) setRoles(invitableRoles(d.profile.role));
    });
  }, []);

  return (
    <Panel title="Invite">
      <form
        className="grid max-w-md gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (channel === "sms" && samePhone(destination)) {
            setError(`That number belongs to Elvira (${SUPER_ADMIN_PHONE_DISPLAY}).`);
            return;
          }
          void inviteCrew({ data: { channel, destination, name, role } })
            .then((r) => {
              setSent(r.previewPath ?? "sent");
              setDestination("");
              setName("");
              setError("");
            })
            .catch((c: unknown) => setError(c instanceof Error ? c.message : "Could not send."));
        }}
      >
        <div className="grid grid-cols-2 gap-2">
          {(["sms", "email"] as const).map((item) => (
            <button key={item} type="button" onClick={() => setChannel(item)} className={`h-11 rounded-md border text-sm ${channel === item ? "border-copper bg-copper text-ink" : "border-line"}`}>
              {item === "sms" ? "Text" : "Email"}
            </button>
          ))}
        </div>
        <input className="field" placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} required />
        <input className="field" placeholder={channel === "sms" ? "Mobile number" : "Email"} value={destination} onChange={(e) => setDestination(e.target.value)} required />
        <select className="field" value={role} onChange={(e) => setRole(e.target.value)}>
          {roles.map((r) => (
            <option key={r} value={r}>
              {roleLabel(r)}
            </option>
          ))}
        </select>
        <Button type="submit">Send invite</Button>
        {error ? <p className="text-sm text-danger">{error}</p> : null}
        {sent && sent !== "sent" ? (
          <p className="text-sm text-muted">
            Dev preview:{" "}
            <a className="text-copper underline" href={sent}>
              {sent}
            </a>
          </p>
        ) : null}
        {sent === "sent" ? <p className="text-sm text-muted">Invite sent.</p> : null}
      </form>
    </Panel>
  );
}

/** Labor/Sub Today card. */
export function YoureOnCard() {
  const [data, setData] = useState<Awaited<ReturnType<typeof getMyCrewWeek>> | null>(null);
  useEffect(() => {
    getMyCrewWeek({ data: {} })
      .then(setData)
      .catch(() => setData(null));
  }, []);
  if (!data) return null;
  const today = data.today;
  return (
    <section className="grid gap-2 rounded-md border border-line bg-surface p-4" data-testid="youre-on" aria-label="You're on">
      <div className="flex items-center gap-2 text-sm text-muted">
        <CalendarRange className="size-4" aria-hidden />
        Today you&apos;re on
      </div>
      {today ? (
        <>
          <p className="font-display text-xl text-fg">{today.projectName}</p>
          {today.projectAddress ? (
            <a className="text-sm text-copper underline" href={`https://maps.google.com/?q=${encodeURIComponent(today.projectAddress)}`} target="_blank" rel="noreferrer">
              {today.projectAddress}
            </a>
          ) : null}
          {data.crewmates[today.day]?.length ? (
            <p className="text-sm text-muted">With {data.crewmates[today.day].map((c) => c.name).join(", ")}</p>
          ) : null}
          {data.tomorrow ? <p className="text-sm text-muted">Tomorrow: {data.tomorrow.projectName}</p> : null}
        </>
      ) : (
        <p className="text-base text-muted">No job assigned today. Ask your lead.</p>
      )}
      <MyWeekRequest data={data} onChange={setData} />
    </section>
  );
}

function MyWeekRequest({ data, onChange }: { data: Awaited<ReturnType<typeof getMyCrewWeek>>; onChange: (d: Awaited<ReturnType<typeof getMyCrewWeek>>) => void }) {
  const [open, setOpen] = useState(false);
  const [fromDay, setFrom] = useState(todayIso());
  const [toDay, setTo] = useState(todayIso());
  const [reason, setReason] = useState("pto");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  return (
    <div className="grid gap-2 border-t border-line pt-3">
      <button type="button" className="h-11 text-left text-sm text-copper underline" onClick={() => setOpen((v) => !v)}>
        Request a day off
      </button>
      {open ? (
        <form
          className="grid gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void requestCrewOff({ data: { fromDay, toDay, reason, note } })
              .then(() => getMyCrewWeek({ data: {} }).then(onChange))
              .then(() => {
                setOpen(false);
                setError("");
              })
              .catch((c: unknown) => setError(c instanceof Error ? c.message : "Could not request."));
          }}
        >
          <div className="grid grid-cols-2 gap-2">
            <label className="grid gap-1 text-sm text-muted">
              From
              <input type="date" className="field" value={fromDay} onChange={(e) => setFrom(e.target.value)} required />
            </label>
            <label className="grid gap-1 text-sm text-muted">
              To
              <input type="date" className="field" value={toDay} onChange={(e) => setTo(e.target.value)} required />
            </label>
          </div>
          <select className="field" value={reason} onChange={(e) => setReason(e.target.value)} aria-label="Reason">
            <option value="pto">PTO</option>
            <option value="sick">Sick</option>
            <option value="training">Training</option>
            <option value="other">Other</option>
          </select>
          <input className="field" placeholder="Note" value={note} onChange={(e) => setNote(e.target.value)} />
          <Button type="submit">Submit request</Button>
          {error ? <p className="text-sm text-danger">{error}</p> : null}
        </form>
      ) : null}
      {data.assignments.length ? (
        <ul className="grid gap-1 text-sm" data-testid="my-week">
          {data.days.map((d) => {
            const a = data.assignments.find((x) => x.day === d && x.userId);
            return (
              <li key={d} className="flex justify-between gap-2">
                <span className="text-muted">{new Date(`${d}T12:00:00`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}</span>
                <span className="truncate text-fg">{a ? a.projectName : "—"}</span>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
