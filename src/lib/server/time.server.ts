/**
 * Timesheets (spec 02): hours out of the daily report, Lead approval, payroll CSV.
 *
 * Relative imports so PGLite server tests can load this under node:test. Every exported
 * function takes an optional `sql` for those tests; the app passes none.
 *
 * Who sees what (enforced here, never in the UI):
 *  - time.own: everyone, their own hours.
 *  - time.review / time.approve: Owner/Admin all jobs; Lead only jobs in job_leads, and never
 *    their own hours (those go to an Admin or Owner).
 *  - time.unlock, time.export, rate.*: Owner/Admin. time.export.void: Owner.
 *  - Pay rates and labor $ are only in payloads for rate.view; a Lead's payload has no rate keys.
 */
import { randomUUID } from "node:crypto";
import type { Sql } from "../db.ts";
import { assertCan, can, ForbiddenError } from "../permissions.ts";
import {
  COST_CODE_SEED,
  DEFAULT_TIMEZONE,
  MAX_DAY_MINUTES,
  PAYROLL_CSV_INCLUDE_RATES,
  STATUS_LABEL,
  TRADE_DEFAULT_CODE,
  allocateOvertime,
  computeHours,
  dayFlags,
  daysBetweenInclusive,
  isDayString,
  laborCents,
  lastFullWeek,
  lineErrors,
  parseClock,
  payWeekStart,
  payrollCsv,
  payrollFilename,
  shiftDay,
  weekDays7,
  zonedClock,
  zonedToIso,
  type EntrySource,
  type EntryStatus,
  type Flag,
  type Line,
  type PayrollRow,
} from "../time.ts";
import { dayStatusOf } from "../time-cells.ts";

export { ForbiddenError };

/**
 * [DECIDE] (no spec default) Who may approve their own hours. The spec only rules out Leads;
 * the conservative reading also sends an Admin's own hours to someone else. An Owner (or
 * superadmin) can approve their own, otherwise nobody could.
 */
export const SELF_APPROVE_ROLES = ["owner", "superadmin"] as const;
/** [DECIDE] (no spec default) One "Nudge" text per person per missing day. */
export const NUDGES_PER_PERSON_DAY = 1;
/** Longest export period, so a typo can't lock a year of hours. */
export const MAX_EXPORT_DAYS = 31;

type Me = { userId: string; companyId: string; role: string; name: string; timezone: string; weekStarts: number };
type Row = Record<string, unknown>;

const text = (v: unknown) => (v == null ? "" : String(v));
const num = (v: unknown) => (v == null ? 0 : Number(v));
const day10 = (v: unknown) => text(v).slice(0, 10);
function iso(v: unknown): string | null {
  if (v == null || v === "") return null;
  const d = v instanceof Date ? v : new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

async function db(sql?: Sql): Promise<Sql> {
  if (sql) return sql;
  const { getSql } = await import("../db.ts");
  return getSql();
}

async function me(sql: Sql, userId: string): Promise<Me> {
  const rows = await sql<{ company_id: string; role: string; name: string; timezone: string | null; week_starts: number | null }>`
    select p.company_id, p.role, p.name, c.timezone, c.week_starts
    from profiles p join companies c on c.id = p.company_id
    where p.user_id = ${userId}
  `;
  const r = rows[0];
  if (!r) throw new Error("Finish company setup first.");
  return {
    userId,
    companyId: text(r.company_id),
    role: text(r.role),
    name: text(r.name),
    timezone: text(r.timezone) || DEFAULT_TIMEZONE,
    weekStarts: r.week_starts == null ? 1 : Number(r.week_starts),
  };
}

/** Today in the company's time zone. */
export function companyToday(tz: string, now = new Date()): string {
  return zonedClock(now.toISOString(), tz)!.day;
}

function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] || name;
}

// ---------------------------------------------------------------- cost codes

/** The company's CSI-lite cost codes, and each trade's default code. Idempotent. */
export async function ensureCostCodes(sql: Sql, companyId: string): Promise<void> {
  for (const c of COST_CODE_SEED) {
    await sql`
      insert into cost_codes (id, company_id, code, name, kind)
      values (${randomUUID()}, ${companyId}, ${c.code}, ${c.name}, ${c.kind})
      on conflict (company_id, code) do nothing
    `;
  }
  const codes = await sql<{ id: string; code: string }>`select id, code from cost_codes where company_id = ${companyId}`;
  const byCode = new Map(codes.map((c) => [text(c.code), text(c.id)]));
  const trades = await sql<{ id: string; name: string }>`
    select id, name from trades where company_id = ${companyId} and default_cost_code_id is null
  `;
  for (const t of trades) {
    const id = byCode.get(TRADE_DEFAULT_CODE[text(t.name)] ?? "");
    if (id) await sql`update trades set default_cost_code_id = ${id} where id = ${text(t.id)}`;
  }
}

export type CostCode = { id: string; code: string; name: string; kind: string };

async function costCodes(sql: Sql, companyId: string): Promise<CostCode[]> {
  await ensureCostCodes(sql, companyId);
  const rows = await sql<Row>`
    select id, code, name, kind from cost_codes where company_id = ${companyId} and active = true order by code
  `;
  return rows.map((r) => ({ id: text(r.id), code: text(r.code), name: text(r.name), kind: text(r.kind) }));
}

/** The person's primary trade (lowest sort) → its default cost code. [ASSUMPTION] spec 02. */
async function defaultCostCodeFor(sql: Sql, companyId: string, userId: string): Promise<string | null> {
  const rows = await sql<{ id: string | null }>`
    select t.default_cost_code_id as id
    from person_trades pt join trades t on t.id = pt.trade_id
    where pt.user_id = ${userId} and pt.company_id = ${companyId} and t.default_cost_code_id is not null
    order by t.sort asc, t.name asc
    limit 1
  `;
  return rows[0]?.id ? text(rows[0].id) : null;
}

async function companyJobs(sql: Sql, companyId: string): Promise<{ id: string; name: string }[]> {
  const rows = await sql<Row>`select id, name from projects where company_id = ${companyId} and archived = false order by name`;
  return rows.map((r) => ({ id: text(r.id), name: text(r.name) }));
}

// ---------------------------------------------------------------- scope

/** Jobs this Lead leads (job_leads), or null for "every job" (Owner/Admin). */
async function reviewScope(sql: Sql, m: Me): Promise<string[] | null> {
  assertCan(m.role, "time.review");
  if (can(m.role, "time.unlock")) return null; // Owner/Admin/superadmin see every job
  const rows = await sql<{ project_id: string }>`
    select jl.project_id from job_leads jl join projects p on p.id = jl.project_id
    where jl.user_id = ${m.userId} and p.company_id = ${m.companyId}
  `;
  return rows.map((r) => text(r.project_id));
}

function inScope(scope: string[] | null, projectId: string | null): boolean {
  return scope === null || (projectId != null && scope.includes(projectId));
}

function maySelfApprove(role: string): boolean {
  return (SELF_APPROVE_ROLES as readonly string[]).includes(role);
}

/** Whether `userId` may read this report as a time reviewer (drawer → daily report). */
export async function canReviewReport(userId: string, reportId: string, sqlIn?: Sql): Promise<boolean> {
  const sql = await db(sqlIn);
  const m = await me(sql, userId);
  if (!can(m.role, "time.review")) return false;
  const scope = await reviewScope(sql, m);
  const rows = await sql<{ project_id: string | null }>`
    select project_id from time_entries where report_id = ${reportId} and company_id = ${m.companyId}
    union
    select project_id from daily_reports where id = ${reportId} and company_id = ${m.companyId}
  `;
  return rows.some((r) => inScope(scope, r.project_id ? text(r.project_id) : null));
}

// ---------------------------------------------------------------- entries

export type TimeEntry = {
  id: string;
  userId: string;
  day: string;
  reportId: string | null;
  projectId: string | null;
  projectName: string;
  costCodeId: string | null;
  costCode: string;
  costCodeName: string;
  start: string; // "HH:MM" in company time, "" if none
  end: string;
  lunchMinutes: number;
  minutes: number;
  source: EntrySource;
  status: EntryStatus;
  rejectReason: string;
  approvedByName: string;
  approvedAt: string | null;
  editedByName: string;
  exportId: string | null;
};

const ENTRY_SELECT = `
  select e.id, e.user_id, e.day::text as day, e.report_id, e.project_id, coalesce(p.name, '') as project_name,
         e.cost_code_id, coalesce(cc.code, '') as cost_code, coalesce(cc.name, '') as cost_code_name,
         e.start_at, e.end_at, e.lunch_minutes, e.minutes, e.source, e.status, e.reject_reason,
         coalesce(ap.name, '') as approved_by_name, e.approved_at, coalesce(ed.name, '') as edited_by_name, e.export_id
  from time_entries e
  left join projects p on p.id = e.project_id
  left join cost_codes cc on cc.id = e.cost_code_id
  left join profiles ap on ap.user_id = e.approved_by
  left join profiles ed on ed.user_id = e.edited_by`;

function toEntry(r: Row, tz: string): TimeEntry {
  return {
    id: text(r.id),
    userId: text(r.user_id),
    day: day10(r.day),
    reportId: r.report_id ? text(r.report_id) : null,
    projectId: r.project_id ? text(r.project_id) : null,
    projectName: text(r.project_name),
    costCodeId: r.cost_code_id ? text(r.cost_code_id) : null,
    costCode: text(r.cost_code),
    costCodeName: text(r.cost_code_name),
    start: zonedClock(iso(r.start_at), tz)?.hhmm ?? "",
    end: zonedClock(iso(r.end_at), tz)?.hhmm ?? "",
    lunchMinutes: num(r.lunch_minutes),
    minutes: num(r.minutes),
    source: text(r.source) as EntrySource,
    status: text(r.status) as EntryStatus,
    rejectReason: text(r.reject_reason),
    approvedByName: text(r.approved_by_name),
    approvedAt: iso(r.approved_at),
    editedByName: text(r.edited_by_name),
    exportId: r.export_id ? text(r.export_id) : null,
  };
}

export const dayStatus = dayStatusOf;

function lockMessage(rows: { status: string; approved_by_name?: unknown }[]): string | null {
  if (rows.some((r) => r.status === "exported")) return "These hours are in a payroll export, so they can't change.";
  const approved = rows.find((r) => r.status === "approved");
  if (approved) {
    const who = text(approved.approved_by_name) || "an approver";
    return `Approved by ${who}. Ask ${firstName(who)} to reopen it.`;
  }
  return null;
}

// ---------------------------------------------------------------- A. submit step

export type SubmitDefaults = {
  timezone: string;
  start: string;
  startHint: "first-edit" | "previous" | "";
  end: string;
  lunchMinutes: number | null;
  lines: Line[];
  rejectReason: string;
  locked: string | null;
  jobs: { id: string; name: string }[];
  costCodes: CostCode[];
};

/** Prefills for the Hours card: start = first edit, end = now (or what was sent before a rejection). */
export async function getSubmitDefaults(userId: string, input: { day: string }, sqlIn?: Sql): Promise<SubmitDefaults> {
  const sql = await db(sqlIn);
  const m = await me(sql, userId);
  assertCan(m.role, "time.own");
  if (!isDayString(input.day)) throw new Error("Pick a day.");
  const reports = await sql<Row>`
    select id, project_id, first_edit_at, lunch_minutes from daily_reports where user_id = ${userId} and day = ${input.day}
  `;
  const report = reports[0];
  const [jobs, codes] = await Promise.all([companyJobs(sql, m.companyId), costCodes(sql, m.companyId)]);
  const fallbackCode = await defaultCostCodeFor(sql, m.companyId, userId);
  const now = zonedClock(new Date().toISOString(), m.timezone)!;
  const firstEdit = zonedClock(iso(report?.first_edit_at), m.timezone);
  const base: SubmitDefaults = {
    timezone: m.timezone,
    start: firstEdit && firstEdit.day === input.day ? firstEdit.hhmm : "",
    startHint: firstEdit ? "first-edit" : "",
    end: now.day === input.day ? now.hhmm : "",
    lunchMinutes: null,
    lines: [{ projectId: report?.project_id ? text(report.project_id) : null, costCodeId: fallbackCode, minutes: 0 }],
    rejectReason: "",
    locked: null,
    jobs,
    costCodes: codes,
  };
  if (!report) return base;
  const rows = await sql.query<Row>(`${ENTRY_SELECT} where e.report_id = $1 order by e.created_at, e.id`, [text(report.id)]);
  if (rows.length === 0) return base;
  const entries = rows.map((r) => toEntry(r, m.timezone));
  return {
    ...base,
    start: entries[0].start || base.start,
    startHint: entries[0].start ? "previous" : base.startHint,
    end: entries[0].end || base.end,
    lunchMinutes: entries[0].lunchMinutes,
    lines: entries.map((e) => ({ projectId: e.projectId, costCodeId: e.costCodeId, minutes: e.minutes })),
    rejectReason: entries.find((e) => e.rejectReason)?.rejectReason ?? "",
    locked: lockMessage(rows.map((r) => ({ status: text(r.status), approved_by_name: r.approved_by_name }))),
  };
}

export type SubmitTimeInput = { day: string; lunchMinutes: number; start: string; end: string; lines?: Line[] };

/**
 * Submits the day: validates start/end/lunch and the job lines (client rules, again on the
 * server), writes time_entries and stamps the report submitted. Every check runs before the
 * first write. A day with approved or exported hours can't be re-sent.
 */
export async function submitDayTime(
  userId: string,
  input: SubmitTimeInput,
  sqlIn?: Sql,
  clockNow: Date = new Date(),
): Promise<{ minutes: number; source: EntrySource }> {
  const sql = await db(sqlIn);
  const m = await me(sql, userId);
  assertCan(m.role, "time.own");
  if (!isDayString(input.day)) throw new Error("Pick a day.");
  const lunch = Number(input.lunchMinutes);
  if (!Number.isInteger(lunch) || lunch < 0 || lunch > 60) throw new Error("Lunch must be 0 to 60 minutes.");
  const reports = await sql<Row>`
    select id, narrative, project_id, first_edit_at, submitted_at from daily_reports where user_id = ${userId} and day = ${input.day}
  `;
  const report = reports[0];
  if (!report || !text(report.narrative).trim()) throw new Error("Write a few words about your day before submitting.");
  if (report.submitted_at) throw new Error("Today's report is already submitted.");
  const reportId = text(report.id);

  const existing = await sql<Row>`
    select e.status, coalesce(ap.name, '') as approved_by_name
    from time_entries e left join profiles ap on ap.user_id = e.approved_by
    where e.report_id = ${reportId}
  `;
  const locked = lockMessage(existing.map((r) => ({ status: text(r.status), approved_by_name: r.approved_by_name })));
  if (locked) throw new Error(locked);

  const hours = computeHours({ start: input.start, end: input.end, lunch });
  if (hours.errors.length) throw new Error(hours.errors[0]);

  const total = hours.minutes;
  let lines: Line[] =
    input.lines && input.lines.length
      ? input.lines.map((l) => ({ projectId: l.projectId || null, costCodeId: l.costCodeId || null, minutes: Number(l.minutes) }))
      : [{ projectId: report.project_id ? text(report.project_id) : null, costCodeId: await defaultCostCodeFor(sql, m.companyId, userId), minutes: total }];
  if (lines.length > 6) throw new Error("Up to 6 lines a day.");
  const errors = lineErrors(total, lines);
  if (errors.length) throw new Error(errors[0]);

  const jobIds = new Set((await companyJobs(sql, m.companyId)).map((j) => j.id));
  const codeIds = new Set((await costCodes(sql, m.companyId)).map((c) => c.id));
  for (const l of lines) {
    if (l.projectId && !jobIds.has(l.projectId)) throw new Error("Pick one of your company's jobs.");
    if (l.costCodeId && !codeIds.has(l.costCodeId)) throw new Error("Pick a cost code from the list.");
  }
  // Zero-minute split lines carry nothing; keep at least one line.
  const kept = lines.filter((l) => l.minutes > 0);
  lines = kept.length ? kept : [lines[0]];

  const startAt = zonedToIso(input.day, input.start, m.timezone);
  const endAt = zonedToIso(input.day, input.end, m.timezone);
  const firstEdit = zonedClock(iso(report.first_edit_at), m.timezone);
  const now = zonedClock(clockNow.toISOString(), m.timezone)!;
  const endNow = Math.abs((parseClock(input.end) ?? -99) - (parseClock(now.hhmm) ?? 0)) <= 2;
  const source: EntrySource = firstEdit?.hhmm === input.start && endNow ? "derived" : "edited";

  await sql`delete from time_entries where report_id = ${reportId} and status in ('submitted', 'rejected')`;
  for (const l of lines) {
    await sql`
      insert into time_entries (
        id, company_id, user_id, day, report_id, project_id, cost_code_id, start_at, end_at, lunch_minutes, minutes, source, status
      ) values (
        ${randomUUID()}, ${m.companyId}, ${userId}, ${input.day}, ${reportId}, ${l.projectId}, ${l.costCodeId},
        ${startAt}, ${endAt}, ${lunch}, ${l.minutes}, ${source}, ${"submitted"}
      )
    `;
  }
  await sql`
    update daily_reports set lunch_minutes = ${lunch}, start_at = ${startAt}, end_at = ${endAt}, submitted_at = now(), last_edit_at = now()
    where id = ${reportId}
  `;
  return { minutes: total, source };
}

/** A day whose hours were rejected is reopened, so its report can be fixed after the 36 h window. */
export async function isReopenedDay(userId: string, day: string, sqlIn?: Sql): Promise<boolean> {
  const sql = await db(sqlIn);
  const rows = await sql<{ id: string }>`
    select r.id from daily_reports r
    where r.user_id = ${userId} and r.day = ${day} and r.submitted_at is null
      and exists (select 1 from time_entries e where e.report_id = r.id and e.status = 'rejected')
  `;
  return Boolean(rows[0]);
}

// ---------------------------------------------------------------- B. my hours

export type MyHoursDay = { day: string; minutes: number; status: EntryStatus | null; rejectReason: string; reportId: string | null; lines: TimeEntry[] };
export type MyHours = { weekStart: string; today: string; days: MyHoursDay[]; totalMinutes: number };

export async function getMyHours(userId: string, input: { week?: string } = {}, sqlIn?: Sql): Promise<MyHours> {
  const sql = await db(sqlIn);
  const m = await me(sql, userId);
  assertCan(m.role, "time.own");
  const today = companyToday(m.timezone);
  const start = payWeekStart(input.week && isDayString(input.week) ? input.week : today, m.weekStarts);
  const days = weekDays7(start);
  const rows = await sql.query<Row>(
    `${ENTRY_SELECT} where e.user_id = $1 and e.company_id = $2 and e.day between $3 and $4 order by e.day, e.created_at`,
    [userId, m.companyId, days[0], days[6]],
  );
  const entries = rows.map((r) => toEntry(r, m.timezone));
  const out = days.map((day) => {
    const lines = entries.filter((e) => e.day === day);
    return {
      day,
      minutes: lines.reduce((n, e) => n + e.minutes, 0),
      status: dayStatus(lines.map((e) => e.status)),
      rejectReason: lines.find((e) => e.status === "rejected")?.rejectReason ?? "",
      reportId: lines[0]?.reportId ?? null,
      lines,
    };
  });
  return { weekStart: start, today, days: out, totalMinutes: out.reduce((n, d) => n + d.minutes, 0) };
}

// ---------------------------------------------------------------- C. approvals

export type MissingCell = { userId: string; day: string; projectId: string; projectName: string; nudged: boolean };
export type TimePerson = { userId: string; name: string; role: string; subCompany: string };
export type TimeWeek = {
  weekStart: string;
  days: string[];
  today: string;
  timezone: string;
  meId: string;
  people: TimePerson[];
  entries: (TimeEntry & { flags: Flag[] })[];
  missing: MissingCell[];
  jobs: { id: string; name: string }[];
  costCodes: CostCode[];
  scope: "all" | "lead";
  can: { approve: boolean; selfApprove: boolean; unlock: boolean; export: boolean; voidExport: boolean; rates: boolean };
  /** Only with rate.view: approved/exported labor $ per person this week. Omitted otherwise. */
  laborCents?: Record<string, number>;
};

export async function getTimeWeek(userId: string, input: { week?: string; today?: string } = {}, sqlIn?: Sql): Promise<TimeWeek> {
  const sql = await db(sqlIn);
  const m = await me(sql, userId);
  const scope = await reviewScope(sql, m);
  // "Today" for missing reports: the reviewer's own calendar day when it's within a day of the company's.
  const companyDay = companyToday(m.timezone);
  const today =
    input.today && isDayString(input.today) && Math.abs(daysBetweenInclusive(companyDay, input.today) - 1) <= 1 ? input.today : companyDay;
  const start = payWeekStart(input.week && isDayString(input.week) ? input.week : today, m.weekStarts);
  const days = weekDays7(start);
  const params: unknown[] = [m.companyId, days[0], days[6]];
  let where = "e.company_id = $1 and e.day between $2 and $3";
  if (scope) {
    params.push(scope);
    where += ` and e.project_id = any($${params.length}::text[])`;
  }
  const rows = await sql.query<Row>(`${ENTRY_SELECT} ${"where " + where} order by e.day, e.created_at`, params);
  const entries = rows.map((r) => toEntry(r, m.timezone));
  const dayTotals = new Map<string, number>();
  for (const e of entries) dayTotals.set(`${e.userId}|${e.day}`, (dayTotals.get(`${e.userId}|${e.day}`) ?? 0) + e.minutes);
  const flagged = entries.map((e) => ({ ...e, flags: dayFlags(dayTotals.get(`${e.userId}|${e.day}`) ?? 0, Boolean(e.start)) }));

  // Missing: assigned on the crew board (01) up to today, with no submitted report that day.
  const aParams: unknown[] = [m.companyId, days[0], days[6] < today ? days[6] : today];
  let aWhere = "a.company_id = $1 and a.day between $2 and $3";
  if (scope) {
    aParams.push(scope);
    aWhere += ` and a.project_id = any($${aParams.length}::text[])`;
  }
  const assigned = await sql.query<Row>(
    `select distinct on (a.user_id, a.day) a.user_id, a.day::text as day, a.project_id, coalesce(p.name, '') as project_name,
            exists (select 1 from outbound_messages o where o.company_id = a.company_id and o.recipient_user_id = a.user_id
                    and o.kind = 'time_nudge' and o.subject like '%' || a.day::text || '%') as nudged
     from crew_assignments a join projects p on p.id = a.project_id
     where ${aWhere}
       and not exists (select 1 from daily_reports r where r.user_id = a.user_id and r.day = a.day and r.submitted_at is not null)
     order by a.user_id, a.day, a.part`,
    aParams,
  );
  const missing: MissingCell[] = assigned.map((r) => ({
    userId: text(r.user_id),
    day: day10(r.day),
    projectId: text(r.project_id),
    projectName: text(r.project_name),
    nudged: r.nudged === true || r.nudged === "t",
  }));

  const ids = [...new Set([...entries.map((e) => e.userId), ...missing.map((x) => x.userId)])];
  const peopleRows = ids.length
    ? await sql.query<Row>(
        `select user_id, name, role, coalesce(sub_company, '') as sub_company from profiles where company_id = $1 and user_id = any($2::text[]) order by name`,
        [m.companyId, ids],
      )
    : [];
  const people = peopleRows.map((r) => ({ userId: text(r.user_id), name: text(r.name), role: text(r.role), subCompany: text(r.sub_company) }));
  const allJobs = await companyJobs(sql, m.companyId);
  const payload: TimeWeek = {
    weekStart: start,
    days,
    today,
    timezone: m.timezone,
    meId: m.userId,
    people,
    entries: flagged,
    missing,
    jobs: scope ? allJobs.filter((j) => scope.includes(j.id)) : allJobs,
    costCodes: await costCodes(sql, m.companyId),
    scope: scope ? "lead" : "all",
    can: {
      approve: can(m.role, "time.approve"),
      selfApprove: maySelfApprove(m.role),
      unlock: can(m.role, "time.unlock"),
      export: can(m.role, "time.export"),
      voidExport: can(m.role, "time.export.void"),
      rates: can(m.role, "rate.view"),
    },
  };
  if (can(m.role, "rate.view")) {
    const rates = await ratesByUser(sql, m.companyId, ids);
    const labor: Record<string, number> = {};
    for (const e of entries) {
      if (e.status !== "approved" && e.status !== "exported") continue;
      const r = rateOn(rates.get(e.userId) ?? [], e.day);
      labor[e.userId] = (labor[e.userId] ?? 0) + (r ? laborCents(e.minutes, r.rateCents, r.burdenPct) : 0);
    }
    payload.laborCents = labor;
  }
  return payload;
}

type LoadedEntry = { id: string; userId: string; projectId: string | null; status: EntryStatus; reportId: string | null };

async function loadForAction(sql: Sql, m: Me, ids: string[], action: "time.approve" | "time.unlock"): Promise<LoadedEntry[]> {
  assertCan(m.role, action);
  const clean = [...new Set(ids.filter((id) => typeof id === "string" && id))].slice(0, 500);
  if (clean.length === 0) throw new Error("Pick some hours first.");
  const rows = await sql.query<Row>(
    `select id, user_id, project_id, status, report_id from time_entries where company_id = $1 and id = any($2::text[])`,
    [m.companyId, clean],
  );
  if (rows.length !== clean.length) throw new Error("Not found");
  const scope = await reviewScope(sql, m);
  const out = rows.map((r) => ({
    id: text(r.id),
    userId: text(r.user_id),
    projectId: r.project_id ? text(r.project_id) : null,
    status: text(r.status) as EntryStatus,
    reportId: r.report_id ? text(r.report_id) : null,
  }));
  for (const e of out) {
    if (!inScope(scope, e.projectId)) throw new ForbiddenError(action);
    if (action === "time.approve" && e.userId === m.userId && !maySelfApprove(m.role)) {
      throw new Error("Your own hours go to an admin or owner to approve.");
    }
  }
  return out;
}

function needStatus(entries: LoadedEntry[], allowed: EntryStatus[], verb: string) {
  const bad = entries.find((e) => !allowed.includes(e.status));
  if (!bad) return;
  if (bad.status === "exported") throw new Error("These hours are in a payroll export, so they can't change.");
  throw new Error(`Only ${allowed.map((s) => STATUS_LABEL[s].toLowerCase()).join(" or ")} hours can be ${verb}.`);
}

export async function approveEntries(userId: string, input: { ids: string[] }, sqlIn?: Sql): Promise<{ approved: number }> {
  const sql = await db(sqlIn);
  const m = await me(sql, userId);
  const entries = await loadForAction(sql, m, input.ids, "time.approve");
  needStatus(entries, ["submitted"], "approved");
  await sql.query(
    `update time_entries set status = 'approved', approved_by = $1, approved_at = now(), reject_reason = null, updated_at = now()
     where company_id = $2 and id = any($3::text[])`,
    [m.userId, m.companyId, entries.map((e) => e.id)],
  );
  return { approved: entries.length };
}

export async function rejectEntries(userId: string, input: { ids: string[]; reason: string }, sqlIn?: Sql): Promise<{ rejected: number }> {
  const sql = await db(sqlIn);
  const m = await me(sql, userId);
  const reason = (input.reason ?? "").trim();
  if (!reason) throw new Error("Say why, so they can fix it.");
  if (reason.length > 500) throw new Error("Keep the reason under 500 characters.");
  const entries = await loadForAction(sql, m, input.ids, "time.approve");
  needStatus(entries, ["submitted"], "rejected");
  // Rejecting reopens the whole report; refuse while another line of that day is already locked in,
  // or the worker couldn't re-send it.
  const reportIds0 = [...new Set(entries.map((e) => e.reportId).filter((id): id is string => Boolean(id)))];
  if (reportIds0.length) {
    const locked = await sql.query<Row>(
      `select id from time_entries where company_id = $1 and report_id = any($2::text[]) and status in ('approved', 'exported') and not (id = any($3::text[]))`,
      [m.companyId, reportIds0, entries.map((e) => e.id)],
    );
    if (locked.length) throw new Error("Part of this day is already approved. Ask an admin to reopen it first, then send it back.");
  }
  await sql.query(
    `update time_entries set status = 'rejected', reject_reason = $1, approved_by = null, approved_at = null, updated_at = now()
     where company_id = $2 and id = any($3::text[])`,
    [reason, m.companyId, entries.map((e) => e.id)],
  );
  // The worker fixes it in the report: reopen it.
  const reportIds = [...new Set(entries.map((e) => e.reportId).filter((id): id is string => Boolean(id)))];
  if (reportIds.length) {
    await sql.query(`update daily_reports set submitted_at = null where company_id = $1 and id = any($2::text[])`, [m.companyId, reportIds]);
  }
  return { rejected: entries.length };
}

/** Inline edit by an approver: job, cost code or minutes. Records edited_by and source = edited. */
export async function editEntry(
  userId: string,
  input: { id: string; projectId: string | null; costCodeId: string | null; minutes: number },
  sqlIn?: Sql,
): Promise<{ ok: true }> {
  const sql = await db(sqlIn);
  const m = await me(sql, userId);
  const [entry] = await loadForAction(sql, m, [input.id], "time.approve");
  needStatus([entry], ["submitted", "rejected"], "edited (reopen approved hours first)");
  const minutes = Number(input.minutes);
  if (!Number.isInteger(minutes) || minutes < 0 || minutes > MAX_DAY_MINUTES) throw new Error(`Hours must be 0 to ${MAX_DAY_MINUTES / 60}.`);
  const projectId = input.projectId || null;
  if (projectId && !(await companyJobs(sql, m.companyId)).some((j) => j.id === projectId)) throw new Error("Pick one of your company's jobs.");
  if (!inScope(await reviewScope(sql, m), projectId)) throw new ForbiddenError("time.approve");
  const costCodeId = input.costCodeId || null;
  if (costCodeId && !(await costCodes(sql, m.companyId)).some((c) => c.id === costCodeId)) throw new Error("Pick a cost code from the list.");
  await sql`
    update time_entries set project_id = ${projectId}, cost_code_id = ${costCodeId}, minutes = ${minutes},
      source = ${"edited"}, edited_by = ${m.userId}, status = ${"submitted"}, reject_reason = null, updated_at = now()
    where id = ${entry.id} and company_id = ${m.companyId}
  `;
  return { ok: true };
}

/** Owner/Admin: reopen approved hours (back to submitted). Exported hours need "Void export". */
export async function unlockEntries(userId: string, input: { ids: string[] }, sqlIn?: Sql): Promise<{ unlocked: number }> {
  const sql = await db(sqlIn);
  const m = await me(sql, userId);
  const entries = await loadForAction(sql, m, input.ids, "time.unlock");
  needStatus(entries, ["approved"], "reopened");
  await sql.query(
    `update time_entries set status = 'submitted', approved_by = null, approved_at = null, updated_at = now()
     where company_id = $1 and id = any($2::text[])`,
    [m.companyId, entries.map((e) => e.id)],
  );
  return { unlocked: entries.length };
}

/** Text (or email, without a phone) a person who was on the board but hasn't sent their report. */
export async function nudgeMissing(
  userId: string,
  input: { userId: string; day: string },
  sqlIn?: Sql,
): Promise<{ channel: "sms" | "email"; to: string }> {
  const sql = await db(sqlIn);
  const m = await me(sql, userId);
  assertCan(m.role, "time.approve");
  if (!isDayString(input.day)) throw new Error("Pick a day.");
  const scope = await reviewScope(sql, m);
  const assigned = await sql<{ project_id: string }>`
    select project_id from crew_assignments where company_id = ${m.companyId} and user_id = ${input.userId} and day = ${input.day}
  `;
  if (!assigned.some((a) => inScope(scope, text(a.project_id)))) throw new ForbiddenError("time.approve");
  const done = await sql`select id from daily_reports where user_id = ${input.userId} and day = ${input.day} and submitted_at is not null`;
  if (done[0]) throw new Error("Their report is already in.");
  const sent = await sql<{ n: number }>`
    select count(*) as n from outbound_messages
    where company_id = ${m.companyId} and recipient_user_id = ${input.userId} and kind = ${"time_nudge"} and subject like ${"%" + input.day + "%"}
  `;
  if (num(sent[0]?.n) >= NUDGES_PER_PERSON_DAY) throw new Error("Already nudged for that day.");
  const people = await sql<{ name: string; phone: string | null; email: string | null }>`
    select name, phone, email from profiles where user_id = ${input.userId} and company_id = ${m.companyId}
  `;
  const p = people[0];
  if (!p) throw new Error("Not found");
  const phone = text(p.phone);
  const channel: "sms" | "email" = phone ? "sms" : "email";
  const to = phone || text(p.email);
  if (!to) throw new Error("No phone or email for them.");
  const label = new Date(`${input.day}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
  const subject = `Daily report reminder · ${input.day}`;
  let absoluteUrl = (path: string) => path;
  let deliver: ((s: Sql, row: { id: string; channel: string; to: string; subject: string; body: string }) => Promise<void>) | null = null;
  if (!sqlIn) {
    const mailer = await import("./mailer.server.ts");
    absoluteUrl = mailer.absoluteUrl;
    deliver = mailer.deliverOutbound;
  }
  const body = `${firstName(text(p.name))}, your daily report for ${label} isn't in yet. Two minutes: what you did, a photo, your hours. ${absoluteUrl("/")}\n— ${m.name}`;
  const id = randomUUID();
  await sql`
    insert into outbound_messages (id, company_id, sender_user_id, recipient_user_id, channel, to_address, subject, body, link_path, kind)
    values (${id}, ${m.companyId}, ${m.userId}, ${input.userId}, ${channel}, ${to}, ${subject}, ${body}, ${"/"}, ${"time_nudge"})
  `;
  if (deliver) await deliver(sql, { id, channel, to, subject, body });
  else await sql`update outbound_messages set status = ${"skipped"}, error = ${"test"} where id = ${id}`;
  return { channel, to };
}

// ---------------------------------------------------------------- rates (money)

type Rate = { effectiveOn: string; rateCents: number; burdenPct: number };

async function ratesByUser(sql: Sql, companyId: string, userIds: string[]): Promise<Map<string, Rate[]>> {
  const out = new Map<string, Rate[]>();
  if (userIds.length === 0) return out;
  const rows = await sql.query<Row>(
    `select user_id, effective_on::text as effective_on, rate_cents, burden_pct from pay_rates
     where company_id = $1 and user_id = any($2::text[]) order by effective_on desc`,
    [companyId, userIds],
  );
  for (const r of rows) {
    const list = out.get(text(r.user_id)) ?? [];
    list.push({ effectiveOn: day10(r.effective_on), rateCents: num(r.rate_cents), burdenPct: num(r.burden_pct) });
    out.set(text(r.user_id), list);
  }
  return out;
}

/** The rate in effect on `day` (latest effective_on ≤ day); list sorted newest first. */
export function rateOn(list: Rate[], day: string): Rate | null {
  return list.find((r) => r.effectiveOn <= day) ?? null;
}

export type PayRateRow = { userId: string; name: string; role: string; current: Rate | null; history: Rate[] };

export async function listPayRates(userId: string, sqlIn?: Sql): Promise<PayRateRow[]> {
  const sql = await db(sqlIn);
  const m = await me(sql, userId);
  assertCan(m.role, "rate.view");
  const people = await sql<Row>`
    select user_id, name, role from profiles where company_id = ${m.companyId} and role <> ${"sub"} and coalesce(active, true) order by name
  `;
  const rates = await ratesByUser(sql, m.companyId, people.map((p) => text(p.user_id)));
  const today = companyToday(m.timezone);
  return people.map((p) => {
    const history = rates.get(text(p.user_id)) ?? [];
    return { userId: text(p.user_id), name: text(p.name), role: text(p.role), current: rateOn(history, today), history };
  });
}

export async function setPayRate(
  userId: string,
  input: { userId: string; effectiveOn: string; rateCents: number; burdenPct: number },
  sqlIn?: Sql,
): Promise<{ ok: true }> {
  const sql = await db(sqlIn);
  const m = await me(sql, userId);
  assertCan(m.role, "rate.edit");
  if (!isDayString(input.effectiveOn)) throw new Error("Pick the day the rate starts.");
  const cents = Number(input.rateCents);
  const burden = Number(input.burdenPct);
  if (!Number.isInteger(cents) || cents < 0 || cents > 100_000) throw new Error("Enter an hourly rate up to $1,000.");
  if (!Number.isFinite(burden) || burden < 0 || burden > 200) throw new Error("Burden must be 0 to 200%.");
  const found = await sql`select user_id from profiles where user_id = ${input.userId} and company_id = ${m.companyId}`;
  if (!found[0]) throw new Error("Not found");
  await sql`
    insert into pay_rates (company_id, user_id, effective_on, rate_cents, burden_pct)
    values (${m.companyId}, ${input.userId}, ${input.effectiveOn}, ${cents}, ${Math.round(burden * 100) / 100})
    on conflict (user_id, effective_on) do update set rate_cents = excluded.rate_cents, burden_pct = excluded.burden_pct
  `;
  return { ok: true };
}

// ---------------------------------------------------------------- D. payroll export

export type ExportKind = "payroll" | "sub_hours";
export type ExportPreview = {
  period: { start: string; end: string };
  kind: ExportKind;
  notApproved: { userId: string; name: string; day: string; status: EntryStatus }[];
  subExcluded: number;
  alreadyExported: number;
  rowCount: number;
  preview: PayrollRow[];
  filename: string;
};

function periodOf(input: { start?: string; end?: string }, m: Me): { start: string; end: string } {
  const fallback = lastFullWeek(companyToday(m.timezone), m.weekStarts);
  const start = input.start || fallback.start;
  const end = input.end || fallback.end;
  if (!isDayString(start) || !isDayString(end)) throw new Error("Pick the period's first and last day.");
  if (end < start) throw new Error("The period ends before it starts.");
  if (daysBetweenInclusive(start, end) > MAX_EXPORT_DAYS) throw new Error(`Export up to ${MAX_EXPORT_DAYS} days at a time.`);
  return { start, end };
}

async function buildExport(sql: Sql, m: Me, period: { start: string; end: string }, kind: ExportKind) {
  const rows = await sql.query<Row>(
    `select e.id, e.user_id, e.day::text as day, e.project_id, e.minutes, e.status, e.source,
            coalesce(pr.name, '') as name, coalesce(pr.email, '') as email, coalesce(pr.employee_number, '') as employee_number,
            pr.role, coalesce(pr.sub_company, '') as sub_company,
            coalesce(p.name, '') as job_name, coalesce(cc.code, '') as cost_code, coalesce(cc.name, '') as cost_code_name,
            coalesce(ap.name, '') as approved_by, e.approved_at, coalesce(ed.name, '') as edited_by
     from time_entries e
     join profiles pr on pr.user_id = e.user_id
     left join projects p on p.id = e.project_id
     left join cost_codes cc on cc.id = e.cost_code_id
     left join profiles ap on ap.user_id = e.approved_by
     left join profiles ed on ed.user_id = e.edited_by
     where e.company_id = $1 and e.day between $2 and $3
     order by pr.name, e.day, job_name, cost_code`,
    [m.companyId, period.start, period.end],
  );
  const isSub = (r: Row) => text(r.role) === "sub";
  const population = rows.filter((r) => (kind === "sub_hours" ? isSub(r) : !isSub(r)));
  const notApproved = population
    .filter((r) => text(r.status) === "submitted" || text(r.status) === "rejected")
    .map((r) => ({ userId: text(r.user_id), name: text(r.name), day: day10(r.day), status: text(r.status) as EntryStatus }));
  const approved = population.filter((r) => text(r.status) === "approved");

  // One row per person × day × job × cost code.
  type Group = { key: string; userId: string; day: string; ids: string[]; minutes: number; r: Row; approvedAt: string; edited: string[] };
  const groups = new Map<string, Group>();
  for (const r of approved) {
    const key = [text(r.user_id), day10(r.day), text(r.project_id), text(r.cost_code)].join("|");
    const g = groups.get(key) ?? { key, userId: text(r.user_id), day: day10(r.day), ids: [], minutes: 0, r, approvedAt: "", edited: [] };
    g.ids.push(text(r.id));
    g.minutes += num(r.minutes);
    const at = iso(r.approved_at) ?? "";
    if (at > g.approvedAt) {
      g.approvedAt = at;
      g.r = r;
    }
    if (text(r.source) === "edited" && text(r.edited_by)) g.edited.push(text(r.edited_by));
    groups.set(key, g);
  }
  const list = [...groups.values()];
  const ot = allocateOvertime(
    list.map((g) => ({ key: g.key, userId: g.userId, day: g.day, order: `${text(g.r.job_name)}|${text(g.r.cost_code)}`, minutes: g.minutes })),
    { weekStarts: m.weekStarts },
  );
  const rates = PAYROLL_CSV_INCLUDE_RATES && kind === "payroll" ? await ratesByUser(sql, m.companyId, [...new Set(list.map((g) => g.userId))]) : null;
  const payroll: PayrollRow[] = list.map((g) => {
    const split = ot.get(g.key)!;
    const rate = rates ? rateOn(rates.get(g.userId) ?? [], g.day) : null;
    return {
      employeeNumber: text(g.r.employee_number),
      employeeName: text(g.r.name),
      email: text(g.r.email),
      workDate: g.day,
      jobName: text(g.r.job_name),
      jobId: text(g.r.project_id),
      costCode: text(g.r.cost_code),
      costCodeName: text(g.r.cost_code_name),
      regularMinutes: split.regular,
      overtimeMinutes: split.overtime,
      approvedBy: text(g.r.approved_by),
      approvedAt: g.approvedAt,
      notes: g.edited.length ? `Edited by ${[...new Set(g.edited)].join(", ")}` : "",
      subCompany: kind === "sub_hours" ? text(g.r.sub_company) : undefined,
      rateCents: rate?.rateCents,
      amountCents: rate ? Math.round((split.regular / 60) * rate.rateCents + (split.overtime / 60) * rate.rateCents * 1.5) : undefined,
    };
  });
  return {
    notApproved,
    subExcluded: kind === "payroll" ? rows.filter(isSub).length : 0,
    alreadyExported: population.filter((r) => text(r.status) === "exported").length,
    payroll,
    entryIds: list.flatMap((g) => g.ids),
  };
}

export async function previewPayrollExport(
  userId: string,
  input: { start?: string; end?: string; kind?: ExportKind } = {},
  sqlIn?: Sql,
): Promise<ExportPreview> {
  const sql = await db(sqlIn);
  const m = await me(sql, userId);
  assertCan(m.role, "time.export");
  const kind: ExportKind = input.kind === "sub_hours" ? "sub_hours" : "payroll";
  const period = periodOf(input, m);
  const built = await buildExport(sql, m, period, kind);
  return {
    period,
    kind,
    notApproved: built.notApproved,
    subExcluded: built.subExcluded,
    alreadyExported: built.alreadyExported,
    rowCount: built.payroll.length,
    preview: built.payroll.slice(0, 5),
    filename: payrollFilename(kind, period),
  };
}

/** Builds the CSV, marks its entries exported and records the export. Blocked while any hours in the period aren't approved. */
export async function runPayrollExport(
  userId: string,
  input: { start?: string; end?: string; kind?: ExportKind },
  sqlIn?: Sql,
): Promise<{ id: string; csv: string; filename: string; rowCount: number }> {
  const sql = await db(sqlIn);
  const m = await me(sql, userId);
  assertCan(m.role, "time.export");
  const kind: ExportKind = input.kind === "sub_hours" ? "sub_hours" : "payroll";
  const period = periodOf(input, m);
  const built = await buildExport(sql, m, period, kind);
  const n = built.notApproved.length;
  if (n) throw new Error(`${n} ${n === 1 ? "entry isn't" : "entries aren't"} approved yet. Approve or reject ${n === 1 ? "it" : "them"} first.`);
  if (built.payroll.length === 0) throw new Error("No approved hours to export in that period.");
  const csv = payrollCsv(built.payroll, period, { kind });
  const id = randomUUID();
  await sql`
    insert into payroll_exports (id, company_id, period_start, period_end, kind, row_count, created_by, csv)
    values (${id}, ${m.companyId}, ${period.start}, ${period.end}, ${kind}, ${built.payroll.length}, ${m.userId}, ${csv.replace(/^\uFEFF/, "")})
  `;
  await sql.query(
    `update time_entries set status = 'exported', export_id = $1, updated_at = now() where company_id = $2 and status = 'approved' and id = any($3::text[])`,
    [id, m.companyId, built.entryIds],
  );
  return { id, csv, filename: payrollFilename(kind, period), rowCount: built.payroll.length };
}

export type ExportRecord = {
  id: string;
  kind: ExportKind;
  periodStart: string;
  periodEnd: string;
  rowCount: number;
  createdByName: string;
  createdAt: string;
  voidedAt: string | null;
  voidedByName: string;
};

export async function listPayrollExports(userId: string, sqlIn?: Sql): Promise<ExportRecord[]> {
  const sql = await db(sqlIn);
  const m = await me(sql, userId);
  assertCan(m.role, "time.export");
  const rows = await sql<Row>`
    select x.id, x.kind, x.period_start::text as period_start, x.period_end::text as period_end, x.row_count,
           coalesce(c.name, '') as created_by_name, x.created_at, x.voided_at, coalesce(v.name, '') as voided_by_name
    from payroll_exports x
    left join profiles c on c.user_id = x.created_by
    left join profiles v on v.user_id = x.voided_by
    where x.company_id = ${m.companyId}
    order by x.created_at desc
    limit 50
  `;
  return rows.map((r) => ({
    id: text(r.id),
    kind: text(r.kind) as ExportKind,
    periodStart: day10(r.period_start),
    periodEnd: day10(r.period_end),
    rowCount: num(r.row_count),
    createdByName: text(r.created_by_name),
    createdAt: iso(r.created_at) ?? "",
    voidedAt: iso(r.voided_at),
    voidedByName: text(r.voided_by_name),
  }));
}

export async function getPayrollExportCsv(userId: string, input: { id: string }, sqlIn?: Sql): Promise<{ csv: string; filename: string }> {
  const sql = await db(sqlIn);
  const m = await me(sql, userId);
  assertCan(m.role, "time.export");
  const rows = await sql<Row>`
    select csv, kind, period_start::text as period_start, period_end::text as period_end from payroll_exports where id = ${input.id} and company_id = ${m.companyId}
  `;
  const r = rows[0];
  if (!r) throw new Error("Not found");
  // Stored without the BOM (some drivers drop it); hand back exactly what the first download was.
  return { csv: `\uFEFF${text(r.csv).replace(/^\uFEFF/, "")}`, filename: payrollFilename(text(r.kind) as ExportKind, { start: day10(r.period_start), end: day10(r.period_end) }) };
}

/** Owner: void an export. Its entries go back to approved; the export row stays as the audit trail. */
export async function voidPayrollExport(userId: string, input: { id: string }, sqlIn?: Sql): Promise<{ restored: number }> {
  const sql = await db(sqlIn);
  const m = await me(sql, userId);
  assertCan(m.role, "time.export.void");
  const rows = await sql<{ voided_at: unknown }>`select voided_at from payroll_exports where id = ${input.id} and company_id = ${m.companyId}`;
  if (!rows[0]) throw new Error("Not found");
  if (rows[0].voided_at) throw new Error("That export is already void.");
  const restored = await sql<{ id: string }>`
    update time_entries set status = 'approved', export_id = null, updated_at = now()
    where export_id = ${input.id} and company_id = ${m.companyId} and status = 'exported'
    returning id
  `;
  await sql`update payroll_exports set voided_at = now(), voided_by = ${m.userId} where id = ${input.id}`;
  return { restored: restored.length };
}

// ---------------------------------------------------------------- demo seed

/** Demo: cost codes, pay rates, employee numbers, and hours from the seeded week of reports. */
export async function seedDemoTime(
  sql: Sql,
  companyId: string,
  ids: { owner: string; lead: string; labor: string; subcontractor: string },
): Promise<void> {
  await ensureCostCodes(sql, companyId);
  await sql`update profiles set employee_number = ${"E-1042"} where user_id = ${ids.labor}`;
  await sql`update profiles set employee_number = ${"E-1007"} where user_id = ${ids.lead}`;
  const since = shiftDay(new Date().toISOString().slice(0, 10), -90);
  for (const [who, cents] of [
    [ids.labor, 2800],
    [ids.lead, 3600],
  ] as const) {
    await sql`
      insert into pay_rates (company_id, user_id, effective_on, rate_cents, burden_pct)
      values (${companyId}, ${who}, ${since}, ${cents}, ${18})
      on conflict do nothing
    `;
  }
  const reports = await sql<Row>`
    select id, user_id, day::text as day, project_id, first_edit_at, submitted_at, lunch_minutes
    from daily_reports where company_id = ${companyId} and submitted_at is not null order by day
  `;
  const today = new Date().toISOString().slice(0, 10);
  for (const r of reports) {
    const start = new Date(String(iso(r.first_edit_at)));
    const end = new Date(String(iso(r.submitted_at)));
    const lunch = num(r.lunch_minutes);
    const raw = Math.round((end.getTime() - start.getTime()) / 60_000) - lunch;
    const minutes = Math.min(MAX_DAY_MINUTES, Math.max(0, Math.round(raw / 15) * 15));
    const user = text(r.user_id);
    const day = day10(r.day);
    const code = await defaultCostCodeFor(sql, companyId, user);
    // Older days approved (the Lead approves crew; the Owner approves the Lead), recent ones waiting.
    const old = day < shiftDay(today, -3);
    const approver = user === ids.lead ? ids.owner : ids.lead;
    await sql`
      insert into time_entries (id, company_id, user_id, day, report_id, project_id, cost_code_id, start_at, end_at, lunch_minutes,
                                minutes, source, status, approved_by, approved_at)
      values (${randomUUID()}, ${companyId}, ${user}, ${day}, ${text(r.id)}, ${r.project_id ? text(r.project_id) : null}, ${code},
              ${start.toISOString()}, ${end.toISOString()}, ${lunch}, ${minutes}, ${"derived"},
              ${old ? "approved" : "submitted"}, ${old ? approver : null}, ${old ? end.toISOString() : null})
    `;
    await sql`update daily_reports set start_at = ${start.toISOString()}, end_at = ${end.toISOString()} where id = ${text(r.id)}`;
  }
}
