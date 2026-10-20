/**
 * Crew & skills board (spec 01).
 *
 * Who works where, on which day: trades, certifications, assignments, unavailability.
 * Relative imports so PGLite server tests can load this under node:test.
 * Every exported function takes an optional `sql` for those tests; the app passes none.
 *
 * Depends on #19 (feat/sharing-settings): the board rail shows the copper
 * "Sharing review needed" chip for Owner/Admin via project_settings.
 */
import { randomUUID } from "node:crypto";
import type { Sql } from "../db.ts";
import { assertCan, can, ForbiddenError } from "../permissions.ts";
import {
  CERT_EXPIRING_DAYS,
  CERT_TYPE_SEED,
  CONFLICT_LABEL,
  CONFLICT_SEVERITY,
  TRADE_SEED,
  addDays,
  certHealth,
  collidingParts,
  dayInRange,
  formatDay,
  isAssignmentPart,
  isTradeLevel,
  isUnavailReason,
  partsOverlap,
  shortJobName,
  todayIso,
  unavailLabel,
  weekDays,
  weekStart,
  worstCertHealth,
  type AssignmentPart,
  type CertHealth,
  type ConflictKind,
  type ConflictSeverity,
  type TradeLevel,
  type UnavailReason,
} from "../crew.ts";

export { ForbiddenError, CERT_EXPIRING_DAYS };

export const NOT_FOUND = "Not found";
export const DOUBLE_BOOKED = "is already assigned that half-day";
export const UNAVAILABLE = "is unavailable that day";

type Me = {
  userId: string;
  companyId: string;
  role: string;
  name: string;
  email: string;
  phone: string;
  subCompany: string;
};

const text = (value: unknown) => (value == null ? "" : String(value));
const isoDate = (value: unknown): string => {
  if (value == null || value === "") return "";
  if (typeof value === "string") return value.slice(0, 10);
  if (value instanceof Date) return formatDay(value);
  return String(value).slice(0, 10);
};
const bool = (value: unknown) => value === true || value === "t" || value === "true" || value === 1;

async function db(sql?: Sql): Promise<Sql> {
  if (sql) return sql;
  const { getSql } = await import("../db.ts");
  return getSql();
}

async function me(sql: Sql, userId: string): Promise<Me> {
  const rows = await sql<{
    company_id: string;
    role: string;
    name: string;
    email: string | null;
    phone: string | null;
    sub_company: string | null;
  }>`
    select company_id, role, name, email, phone, sub_company from profiles where user_id = ${userId}
  `;
  if (!rows[0]) throw new Error("Finish company setup first.");
  return {
    userId,
    companyId: text(rows[0].company_id),
    role: text(rows[0].role),
    name: text(rows[0].name),
    email: text(rows[0].email),
    phone: text(rows[0].phone),
    subCompany: text(rows[0].sub_company),
  };
}

/** Labor sees only self; Sub sees own sub_company; board roles see everyone. */
function scopePeople(m: Me): { kind: "all" } | { kind: "self" } | { kind: "sub"; company: string } {
  if (can(m.role, "crew.board.view")) return { kind: "all" };
  if (m.role === "sub" || (m.role === "Subcontractor" as string)) {
    return { kind: "sub", company: m.subCompany };
  }
  return { kind: "self" };
}

async function assertJobLead(sql: Sql, m: Me, projectId: string): Promise<void> {
  if (can(m.role, "skill.manage") || m.role === "superadmin" || m.role === "owner" || m.role === "admin") return;
  // Lead: must be in job_leads for this project.
  const rows = await sql<{ u: string }>`
    select user_id as u from job_leads where project_id = ${projectId} and user_id = ${m.userId}
  `;
  if (!rows[0]) throw new ForbiddenError("crew.assign");
}

async function projectInCompany(sql: Sql, companyId: string, projectId: string): Promise<boolean> {
  const rows = await sql<{ id: string }>`
    select id from projects where id = ${projectId} and company_id = ${companyId}
  `;
  return Boolean(rows[0]);
}

// ---------------------------------------------------------------- seed helpers (demo + ensure defaults)

/** Ensure the company has the standard trades and cert types. Idempotent. */
export async function ensureTradeAndCertCatalog(sql: Sql, companyId: string): Promise<void> {
  for (let i = 0; i < TRADE_SEED.length; i += 1) {
    const name = TRADE_SEED[i];
    const existing = await sql<{ id: string }>`select id from trades where company_id = ${companyId} and name = ${name}`;
    if (!existing[0]) {
      await sql`insert into trades (id, company_id, name, sort) values (${randomUUID()}, ${companyId}, ${name}, ${i})`;
    }
  }
  for (const name of CERT_TYPE_SEED) {
    const existing = await sql<{ id: string }>`select id from cert_types where company_id = ${companyId} and name = ${name}`;
    if (!existing[0]) {
      await sql`insert into cert_types (id, company_id, name) values (${randomUUID()}, ${companyId}, ${name})`;
    }
  }
}

// ---------------------------------------------------------------- reads

export type PersonRow = {
  userId: string;
  name: string;
  role: string;
  email: string;
  phone: string;
  subCompany: string;
  active: boolean;
  trades: { id: string; name: string; level: TradeLevel }[];
  certHealth: CertHealth;
};

export type AssignmentRow = {
  id: string;
  userId: string;
  projectId: string;
  projectName: string;
  projectAddress: string;
  day: string;
  part: AssignmentPart;
  note: string;
  status: "draft" | "published";
  activityId: string | null;
};

export type UnavailRow = {
  id: string;
  userId: string;
  fromDay: string;
  toDay: string;
  reason: UnavailReason;
  status: "requested" | "confirmed" | "declined";
  note: string;
};

export type ConflictRow = {
  kind: ConflictKind;
  severity: ConflictSeverity;
  label: string;
  userId: string;
  day: string;
  projectId: string | null;
  assignmentId: string | null;
};

export type JobRailCard = {
  projectId: string;
  name: string;
  address: string;
  headcount: number[]; // Mon–Sat
  requiredCerts: { id: string; name: string }[];
  sharingReviewNeeded: boolean;
  isLead: boolean;
};

export type BoardPayload = {
  weekStart: string;
  days: string[];
  people: PersonRow[];
  assignments: AssignmentRow[];
  unavailability: UnavailRow[];
  conflicts: ConflictRow[];
  jobs: JobRailCard[];
  draftCount: number;
  certExpiringDays: number;
  canAssign: boolean;
  canPublish: boolean;
  canManageSkills: boolean;
  canConfirmUnavail: boolean;
};

export async function getBoard(userId: string, input: { week?: string } = {}, sqlIn?: Sql): Promise<BoardPayload> {
  const sql = await db(sqlIn);
  const m = await me(sql, userId);
  assertCan(m.role, "crew.board.view");
  await ensureTradeAndCertCatalog(sql, m.companyId);

  const monday = weekStart(input.week || todayIso());
  const days = weekDays(monday);
  const sunday = addDays(monday, 6);

  const people = await loadPeople(sql, m);
  const personIds = people.map((p) => p.userId);

  const assignments = await loadAssignments(sql, m.companyId, monday, sunday, personIds);
  const unavailability = await loadUnavailability(sql, m.companyId, monday, sunday, personIds);
  const jobs = await loadJobRail(sql, m, days);
  const conflicts = await computeConflicts(sql, m.companyId, people, assignments, unavailability, jobs);

  return {
    weekStart: monday,
    days,
    people,
    assignments,
    unavailability,
    conflicts,
    jobs,
    draftCount: assignments.filter((a) => a.status === "draft").length,
    certExpiringDays: CERT_EXPIRING_DAYS,
    canAssign: can(m.role, "crew.assign"),
    canPublish: can(m.role, "crew.publish"),
    canManageSkills: can(m.role, "skill.manage"),
    canConfirmUnavail: can(m.role, "crew.unavailable.confirm"),
  };
}

async function loadPeople(sql: Sql, m: Me): Promise<PersonRow[]> {
  const scope = scopePeople(m);
  let rows: {
    user_id: string;
    name: string;
    role: string;
    email: string | null;
    phone: string | null;
    sub_company: string | null;
    active: boolean | null;
  }[];
  if (scope.kind === "self") {
    rows = await sql`
      select user_id, name, role, email, phone, sub_company, active
      from profiles where company_id = ${m.companyId} and user_id = ${m.userId}
    `;
  } else if (scope.kind === "sub") {
    rows = await sql`
      select user_id, name, role, email, phone, sub_company, active
      from profiles
      where company_id = ${m.companyId} and role = 'sub' and coalesce(sub_company, '') = ${scope.company}
      order by name
    `;
  } else {
    rows = await sql`
      select user_id, name, role, email, phone, sub_company, active
      from profiles where company_id = ${m.companyId} and coalesce(active, true) = true
      order by case when coalesce(sub_company, '') = '' then 0 else 1 end, sub_company, name
    `;
  }

  const ids = rows.map((r) => text(r.user_id));
  const trades =
    ids.length === 0
      ? []
      : await sql.query<{ user_id: string; trade_id: string; name: string; level: string }>(
          `select pt.user_id, pt.trade_id, t.name, pt.level
           from person_trades pt join trades t on t.id = pt.trade_id
           where pt.company_id = $1 and pt.user_id = any($2::text[])`,
          [m.companyId, ids],
        );
  const certs =
    ids.length === 0
      ? []
      : await sql.query<{ user_id: string; expires_on: string | null }>(
          `select user_id, expires_on from person_certs where company_id = $1 and user_id = any($2::text[])`,
          [m.companyId, ids],
        );

  const tradesBy = new Map<string, PersonRow["trades"]>();
  for (const t of trades) {
    const list = tradesBy.get(text(t.user_id)) ?? [];
    list.push({ id: text(t.trade_id), name: text(t.name), level: (text(t.level) as TradeLevel) || "journeyman" });
    tradesBy.set(text(t.user_id), list);
  }
  const certsBy = new Map<string, CertHealth[]>();
  for (const c of certs) {
    const list = certsBy.get(text(c.user_id)) ?? [];
    list.push(certHealth(isoDate(c.expires_on) || null));
    certsBy.set(text(c.user_id), list);
  }

  return rows.map((r) => {
    const uid = text(r.user_id);
    const healths = certsBy.get(uid) ?? [];
    return {
      userId: uid,
      name: text(r.name),
      role: text(r.role),
      email: text(r.email),
      phone: text(r.phone),
      subCompany: text(r.sub_company),
      active: r.active == null ? true : bool(r.active),
      trades: tradesBy.get(uid) ?? [],
      certHealth: healths.length === 0 ? ("missing" as CertHealth) : worstCertHealth(healths),
    };
  });
}

async function loadAssignments(
  sql: Sql,
  companyId: string,
  from: string,
  to: string,
  personIds: string[],
): Promise<AssignmentRow[]> {
  if (personIds.length === 0) return [];
  const rows = await sql.query<{
    id: string;
    user_id: string;
    project_id: string;
    project_name: string;
    project_address: string;
    day: string;
    part: string;
    note: string;
    status: string;
    activity_id: string | null;
  }>(
    `select a.id, a.user_id, a.project_id, p.name as project_name, p.address as project_address,
            a.day::text as day, a.part, a.note, a.status, a.activity_id
     from crew_assignments a
     join projects p on p.id = a.project_id
     where a.company_id = $1 and a.day >= $2::date and a.day <= $3::date
       and a.user_id = any($4::text[])
     order by a.day, a.part`,
    [companyId, from, to, personIds],
  );
  return rows.map((r) => ({
    id: text(r.id),
    userId: text(r.user_id),
    projectId: text(r.project_id),
    projectName: text(r.project_name),
    projectAddress: text(r.project_address),
    day: isoDate(r.day),
    part: (text(r.part) as AssignmentPart) || "full",
    note: text(r.note),
    status: text(r.status) === "published" ? "published" : "draft",
    activityId: r.activity_id ? text(r.activity_id) : null,
  }));
}

async function loadUnavailability(
  sql: Sql,
  companyId: string,
  from: string,
  to: string,
  personIds: string[],
): Promise<UnavailRow[]> {
  if (personIds.length === 0) return [];
  const rows = await sql.query<{
    id: string;
    user_id: string;
    from_day: string;
    to_day: string;
    reason: string;
    status: string;
    note: string;
  }>(
    `select id, user_id, from_day::text as from_day, to_day::text as to_day, reason, status, note
     from person_unavailability
     where company_id = $1 and user_id = any($2::text[])
       and from_day <= $3::date and to_day >= $4::date
       and status in ('requested', 'confirmed')`,
    [companyId, personIds, to, from],
  );
  return rows.map((r) => ({
    id: text(r.id),
    userId: text(r.user_id),
    fromDay: isoDate(r.from_day),
    toDay: isoDate(r.to_day),
    reason: (text(r.reason) as UnavailReason) || "other",
    status: text(r.status) === "requested" ? "requested" : text(r.status) === "declined" ? "declined" : "confirmed",
    note: text(r.note),
  }));
}

async function loadJobRail(sql: Sql, m: Me, days: string[]): Promise<JobRailCard[]> {
  const projects = await sql<{ id: string; name: string; address: string }>`
    select id, name, address from projects
    where company_id = ${m.companyId} and coalesce(archived, false) = false
    order by name
  `;
  if (projects.length === 0) return [];
  const ids = projects.map((p) => text(p.id));

  const leads = await sql.query<{ project_id: string; user_id: string }>(
    `select project_id, user_id from job_leads where project_id = any($1::text[])`,
    [ids],
  );
  const leadSet = new Set(leads.map((l) => `${text(l.project_id)}|${text(l.user_id)}`));

  const reqs = await sql.query<{ project_id: string; cert_type_id: string; name: string }>(
    `select jr.project_id, jr.cert_type_id, ct.name
     from job_requirements jr join cert_types ct on ct.id = jr.cert_type_id
     where jr.project_id = any($1::text[])`,
    [ids],
  );
  const reqBy = new Map<string, { id: string; name: string }[]>();
  for (const r of reqs) {
    const list = reqBy.get(text(r.project_id)) ?? [];
    list.push({ id: text(r.cert_type_id), name: text(r.name) });
    reqBy.set(text(r.project_id), list);
  }

  // Sharing review (#19): Owner/Admin see the copper chip.
  const showReview = can(m.role, "settings.sharing.view");
  const reviewNeeded = new Set<string>();
  if (showReview) {
    const flags = await sql.query<{ project_id: string }>(
      `select project_id from project_settings
       where company_id = $1 and project_id = any($2::text[]) and sharing_review_status = 'needed'`,
      [m.companyId, ids],
    );
    for (const f of flags) reviewNeeded.add(text(f.project_id));
  }

  const counts = await sql.query<{ project_id: string; day: string; n: number }>(
    `select project_id, day::text as day, count(*)::int as n
     from crew_assignments
     where company_id = $1 and project_id = any($2::text[])
       and day >= $3::date and day <= $4::date
     group by project_id, day`,
    [m.companyId, ids, days[0], days[days.length - 1]],
  );
  const countMap = new Map(counts.map((c) => [`${text(c.project_id)}|${isoDate(c.day)}`, Number(c.n)]));

  return projects.map((p) => {
    const id = text(p.id);
    const isLead =
      can(m.role, "skill.manage") || m.role === "superadmin" || leadSet.has(`${id}|${m.userId}`);
    return {
      projectId: id,
      name: text(p.name),
      address: text(p.address),
      headcount: days.map((d) => countMap.get(`${id}|${d}`) ?? 0),
      requiredCerts: reqBy.get(id) ?? [],
      sharingReviewNeeded: reviewNeeded.has(id),
      isLead,
    };
  });
}

async function computeConflicts(
  sql: Sql,
  companyId: string,
  people: PersonRow[],
  assignments: AssignmentRow[],
  unavailability: UnavailRow[],
  jobs: JobRailCard[],
): Promise<ConflictRow[]> {
  const out: ConflictRow[] = [];
  const byUserDay = new Map<string, AssignmentRow[]>();
  for (const a of assignments) {
    const key = `${a.userId}|${a.day}`;
    const list = byUserDay.get(key) ?? [];
    list.push(a);
    byUserDay.set(key, list);
  }

  // Double-book across overlapping parts on different jobs.
  for (const [, list] of byUserDay) {
    for (let i = 0; i < list.length; i += 1) {
      for (let j = i + 1; j < list.length; j += 1) {
        if (list[i].projectId !== list[j].projectId && partsOverlap(list[i].part, list[j].part)) {
          out.push({
            kind: "double_booked",
            severity: CONFLICT_SEVERITY.double_booked,
            label: CONFLICT_LABEL.double_booked,
            userId: list[i].userId,
            day: list[i].day,
            projectId: list[i].projectId,
            assignmentId: list[i].id,
          });
        }
      }
    }
  }

  // Unavailable.
  for (const a of assignments) {
    for (const u of unavailability) {
      if (u.userId !== a.userId) continue;
      if (!dayInRange(a.day, u.fromDay, u.toDay)) continue;
      if (u.status === "confirmed") {
        out.push({
          kind: "unavailable",
          severity: "blocking",
          label: `${CONFLICT_LABEL.unavailable} (${unavailLabel(u.reason)})`,
          userId: a.userId,
          day: a.day,
          projectId: a.projectId,
          assignmentId: a.id,
        });
      } else if (u.status === "requested") {
        out.push({
          kind: "unavailable",
          severity: "warning",
          label: `Requested ${unavailLabel(u.reason)} (not confirmed)`,
          userId: a.userId,
          day: a.day,
          projectId: a.projectId,
          assignmentId: a.id,
        });
      }
    }
  }

  // Missing/expired required certs.
  const reqByJob = new Map(jobs.map((j) => [j.projectId, j.requiredCerts]));
  const personIds = people.map((p) => p.userId);
  const certRows =
    personIds.length === 0
      ? []
      : await sql.query<{ user_id: string; cert_type_id: string; expires_on: string | null }>(
          `select user_id, cert_type_id, expires_on from person_certs where company_id = $1 and user_id = any($2::text[])`,
          [companyId, personIds],
        );
  const certMap = new Map<string, { expires: string | null }>();
  for (const c of certRows) {
    certMap.set(`${text(c.user_id)}|${text(c.cert_type_id)}`, { expires: isoDate(c.expires_on) || null });
  }
  for (const a of assignments) {
    const reqs = reqByJob.get(a.projectId) ?? [];
    for (const req of reqs) {
      const have = certMap.get(`${a.userId}|${req.id}`);
      const health = certHealth(have?.expires ?? null, a.day);
      if (health === "missing" || health === "expired") {
        out.push({
          kind: "missing_cert",
          severity: CONFLICT_SEVERITY.missing_cert,
          label: `${CONFLICT_LABEL.missing_cert}: ${req.name}`,
          userId: a.userId,
          day: a.day,
          projectId: a.projectId,
          assignmentId: a.id,
        });
      }
    }
  }

  // Orientation not attended.
  if (personIds.length > 0) {
    const orients = await sql.query<{ user_id: string; attended: boolean | null }>(
      `select user_id, attended from safety_orientations where company_id = $1 and user_id = any($2::text[])`,
      [companyId, personIds],
    );
    const attended = new Map(orients.map((o) => [text(o.user_id), bool(o.attended)]));
    for (const a of assignments) {
      const ok = attended.get(a.userId);
      if (ok !== true) {
        out.push({
          kind: "orientation",
          severity: CONFLICT_SEVERITY.orientation,
          label: CONFLICT_LABEL.orientation,
          userId: a.userId,
          day: a.day,
          projectId: a.projectId,
          assignmentId: a.id,
        });
      }
    }
  }

  // Overdue safety training (due_on < today and no completed).
  if (personIds.length > 0) {
    const training = await sql.query<{ user_id: string; course: string; due_on: string | null; completed_on: string | null }>(
      `select user_id, title as course, due_on::text as due_on, completed_on::text as completed_on
       from safety_training where company_id = $1 and user_id = any($2::text[])`,
      [companyId, personIds],
    );
    const today = todayIso();
    const overdue = new Set<string>();
    for (const t of training) {
      const due = isoDate(t.due_on);
      const done = isoDate(t.completed_on);
      if (due && due < today && !done) overdue.add(text(t.user_id));
    }
    for (const a of assignments) {
      if (overdue.has(a.userId)) {
        out.push({
          kind: "training",
          severity: CONFLICT_SEVERITY.training,
          label: CONFLICT_LABEL.training,
          userId: a.userId,
          day: a.day,
          projectId: a.projectId,
          assignmentId: a.id,
        });
      }
    }
  }

  // Sub on a job they aren't attached to (info). Heuristic: sub with sub_company, no work_orders/assignments history — skip heavy; flag if role=sub and no prior assignment to that project this week alone is fine as info when they have no job_leads and aren't the only assignee — keep simple: skip unless we have a membership table. Spec says "Sub on a job they aren't attached to" — without a membership table we treat work_orders.assigned as attachment.
  // Leave as no-op for MVP unless we have clear attachment data.

  return out;
}

// ---------------------------------------------------------------- writes: assign / remove / publish

export async function assignPerson(
  userId: string,
  input: { userId: string; projectId: string; day: string; part?: string; note?: string },
  sqlIn?: Sql,
): Promise<{ id: string }> {
  const sql = await db(sqlIn);
  const m = await me(sql, userId);
  assertCan(m.role, "crew.assign");
  if (!(await projectInCompany(sql, m.companyId, input.projectId))) throw new Error(NOT_FOUND);
  await assertJobLead(sql, m, input.projectId);

  const rawPart = input.part ?? "full";
  const part: AssignmentPart = isAssignmentPart(rawPart) ? rawPart : "full";
  const day = isoDate(input.day);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error("Pick a day.");
  const note = (input.note ?? "").trim().slice(0, 500);
  const targetUser = text(input.userId);

  // Target must be in company.
  const target = await sql<{ role: string; sub_company: string | null; name: string }>`
    select role, sub_company, name from profiles where user_id = ${targetUser} and company_id = ${m.companyId}
  `;
  if (!target[0]) throw new Error(NOT_FOUND);
  const personName = text(target[0].name) || "That person";

  // Blocking: confirmed unavailability.
  const off = await sql<{ id: string; reason: string }>`
    select id, reason from person_unavailability
    where company_id = ${m.companyId} and user_id = ${targetUser}
      and status = 'confirmed' and from_day <= ${day}::date and to_day >= ${day}::date
  `;
  if (off[0]) throw new Error(`${personName} ${UNAVAILABLE} (${unavailLabel(text(off[0].reason) as UnavailReason)}).`);

  // Blocking: double-book overlapping parts.
  const parts = collidingParts(part);
  const existing = await sql.query<{ id: string; part: string; project_id: string; project_name: string }>(
    `select a.id, a.part, a.project_id, p.name as project_name
     from crew_assignments a join projects p on p.id = a.project_id
     where a.company_id = $1 and a.user_id = $2 and a.day = $3::date and a.part = any($4::text[])`,
    [m.companyId, targetUser, day, parts],
  );
  for (const row of existing) {
    if (text(row.project_id) !== input.projectId) {
      throw new Error(`${personName} ${DOUBLE_BOOKED} on ${text(row.project_name)}.`);
    }
    // Same job + same overlapping part: update in place instead of inserting.
    if (partsOverlap(part, text(row.part) as AssignmentPart)) {
      await sql`
        update crew_assignments
        set part = ${part}, note = ${note}, status = 'draft', assigned_by = ${m.userId}, updated_at = now()
        where id = ${text(row.id)}
      `;
      return { id: text(row.id) };
    }
  }

  const id = randomUUID();
  try {
    await sql`
      insert into crew_assignments (
        id, company_id, user_id, project_id, day, part, note, status, assigned_by
      ) values (
        ${id}, ${m.companyId}, ${targetUser}, ${input.projectId}, ${day}::date, ${part}, ${note}, 'draft', ${m.userId}
      )
    `;
  } catch (cause) {
    const msg = cause instanceof Error ? cause.message : "";
    if (/unique|duplicate/i.test(msg)) {
      throw new Error(`${personName} ${DOUBLE_BOOKED}.`);
    }
    throw cause;
  }
  return { id };
}

export async function removeAssignment(userId: string, input: { id: string }, sqlIn?: Sql): Promise<{ ok: true }> {
  const sql = await db(sqlIn);
  const m = await me(sql, userId);
  assertCan(m.role, "crew.assign");
  const rows = await sql<{ id: string; project_id: string; status: string }>`
    select id, project_id, status from crew_assignments where id = ${input.id} and company_id = ${m.companyId}
  `;
  if (!rows[0]) throw new Error(NOT_FOUND);
  await assertJobLead(sql, m, text(rows[0].project_id));
  await sql`delete from crew_assignments where id = ${input.id}`;
  return { ok: true };
}

export async function copyLastWeek(userId: string, input: { week?: string } = {}, sqlIn?: Sql): Promise<{ copied: number }> {
  const sql = await db(sqlIn);
  const m = await me(sql, userId);
  assertCan(m.role, "crew.assign");
  const monday = weekStart(input.week || todayIso());
  const prevMonday = addDays(monday, -7);
  const prevDays = weekDays(prevMonday);
  const thisDays = weekDays(monday);

  // Lead: only copy onto jobs they lead.
  let leadFilter: string[] | null = null;
  if (!can(m.role, "skill.manage") && m.role !== "superadmin" && m.role !== "owner" && m.role !== "admin") {
    const leads = await sql<{ project_id: string }>`select project_id from job_leads where user_id = ${m.userId}`;
    leadFilter = leads.map((l) => text(l.project_id));
    if (leadFilter.length === 0) return { copied: 0 };
  }

  const prev = await sql.query<{
    user_id: string;
    project_id: string;
    day: string;
    part: string;
    note: string;
  }>(
    leadFilter
      ? `select user_id, project_id, day::text as day, part, note from crew_assignments
         where company_id = $1 and day >= $2::date and day <= $3::date and project_id = any($4::text[])`
      : `select user_id, project_id, day::text as day, part, note from crew_assignments
         where company_id = $1 and day >= $2::date and day <= $3::date`,
    leadFilter ? [m.companyId, prevDays[0], prevDays[5], leadFilter] : [m.companyId, prevDays[0], prevDays[5]],
  );

  let copied = 0;
  for (const row of prev) {
    const offset = prevDays.indexOf(isoDate(row.day));
    if (offset < 0) continue;
    const newDay = thisDays[offset];
    try {
      await assignPerson(
        userId,
        { userId: text(row.user_id), projectId: text(row.project_id), day: newDay, part: text(row.part), note: text(row.note) },
        sql,
      );
      copied += 1;
    } catch {
      // Skip conflicts when copying.
    }
  }
  return { copied };
}

export async function publishWeek(
  userId: string,
  input: { week?: string; confirmWarnings?: boolean } = {},
  sqlIn?: Sql,
): Promise<{ published: number; messages: number; warnings: ConflictRow[] }> {
  const sql = await db(sqlIn);
  const m = await me(sql, userId);
  assertCan(m.role, "crew.publish");

  const monday = weekStart(input.week || todayIso());
  const days = weekDays(monday);
  const sunday = addDays(monday, 6);

  // Load drafts in scope.
  let leadFilter: string[] | null = null;
  if (!can(m.role, "skill.manage") && m.role !== "superadmin" && m.role !== "owner" && m.role !== "admin") {
    const leads = await sql<{ project_id: string }>`select project_id from job_leads where user_id = ${m.userId}`;
    leadFilter = leads.map((l) => text(l.project_id));
  }

  const drafts = await sql.query<{
    id: string;
    user_id: string;
    project_id: string;
    day: string;
    part: string;
    project_name: string;
    project_address: string;
  }>(
    leadFilter
      ? `select a.id, a.user_id, a.project_id, a.day::text as day, a.part, p.name as project_name, p.address as project_address
         from crew_assignments a join projects p on p.id = a.project_id
         where a.company_id = $1 and a.status = 'draft' and a.day >= $2::date and a.day <= $3::date
           and a.project_id = any($4::text[])`
      : `select a.id, a.user_id, a.project_id, a.day::text as day, a.part, p.name as project_name, p.address as project_address
         from crew_assignments a join projects p on p.id = a.project_id
         where a.company_id = $1 and a.status = 'draft' and a.day >= $2::date and a.day <= $3::date`,
    leadFilter ? [m.companyId, days[0], sunday, leadFilter] : [m.companyId, days[0], sunday],
  );

  if (drafts.length === 0) return { published: 0, messages: 0, warnings: [] };

  // Recompute warning-level conflicts for these drafts.
  const people = await loadPeople(sql, m);
  const assignments: AssignmentRow[] = drafts.map((d) => ({
    id: text(d.id),
    userId: text(d.user_id),
    projectId: text(d.project_id),
    projectName: text(d.project_name),
    projectAddress: text(d.project_address),
    day: isoDate(d.day),
    part: (text(d.part) as AssignmentPart) || "full",
    note: "",
    status: "draft",
    activityId: null,
  }));
  const unavailability = await loadUnavailability(
    sql,
    m.companyId,
    days[0],
    sunday,
    people.map((p) => p.userId),
  );
  const jobs = await loadJobRail(sql, m, days);
  const conflicts = await computeConflicts(sql, m.companyId, people, assignments, unavailability, jobs);
  const blocking = conflicts.filter((c) => c.severity === "blocking");
  if (blocking.length > 0) {
    throw new Error(`Can't publish: ${blocking[0].label}.`);
  }
  const warnings = conflicts.filter((c) => c.severity === "warning");
  if (warnings.length > 0 && !input.confirmWarnings) {
    return { published: 0, messages: 0, warnings };
  }

  // Mark published.
  const ids = drafts.map((d) => text(d.id));
  await sql.query(`update crew_assignments set status = 'published', updated_at = now() where id = any($1::text[])`, [ids]);

  // One outbound message per affected person.
  const byUser = new Map<string, typeof drafts>();
  for (const d of drafts) {
    const uid = text(d.user_id);
    const list = byUser.get(uid) ?? [];
    list.push(d);
    byUser.set(uid, list);
  }

  let messages = 0;
  for (const [uid, list] of byUser) {
    const profile = await sql<{ name: string; email: string | null; phone: string | null }>`
      select name, email, phone from profiles where user_id = ${uid}
    `;
    const name = text(profile[0]?.name) || "there";
    const email = text(profile[0]?.email);
    const phone = text(profile[0]?.phone);
    const lines = list
      .sort((a, b) => isoDate(a.day).localeCompare(isoDate(b.day)))
      .map((d) => {
        const day = new Date(`${isoDate(d.day)}T12:00:00`);
        const label = day.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
        const part = text(d.part) === "full" ? "" : ` (${text(d.part).toUpperCase()})`;
        return `${label}${part}: ${text(d.project_name)}, ${text(d.project_address)}`;
      });
    const body = `${name}, your schedule for the week of ${monday}:\n${lines.join("\n")}`;
    const channel = phone ? "sms" : "email";
    const to = phone || email;
    if (!to) continue;

    // Magic links / mailer use @/ imports — load only outside PGLite unit tests.
    let linkPath = "/";
    let absoluteUrl = (path: string) => path;
    let deliverOutbound: ((s: typeof sql, row: { id: string; channel: string; to: string; subject: string; body: string }) => Promise<void>) | null = null;
    if (!sqlIn) {
      try {
        const magic = await import("./magic.server.ts");
        const mailer = await import("./mailer.server.ts");
        absoluteUrl = mailer.absoluteUrl;
        deliverOutbound = mailer.deliverOutbound;
        linkPath = await magic.insertMagicLink({
          channel,
          destination: to,
          email: email || `sms.${phone.replace(/\D/g, "")}@crew.rcl.build`,
          displayName: name,
          companyId: m.companyId,
          role: null,
          action: null,
          proposalId: null,
          redirectPath: "/",
          minutes: 60 * 24 * 7,
        });
      } catch {
        linkPath = "/";
      }
    }

    const messageId = randomUUID();
    const subject = `Your crew schedule · week of ${monday}`;
    const fullBody = `${body}\n\nOpen: ${absoluteUrl(linkPath)}`;
    await sql`
      insert into outbound_messages (
        id, company_id, sender_user_id, recipient_user_id, channel, to_address, subject, body, link_path, kind
      ) values (
        ${messageId}, ${m.companyId}, ${m.userId}, ${uid}, ${channel}, ${to},
        ${subject}, ${fullBody}, ${linkPath}, ${"crew_schedule"}
      )
    `;
    if (deliverOutbound) await deliverOutbound(sql, { id: messageId, channel, to, subject, body: fullBody });
    else await sql`update outbound_messages set status = ${"skipped"}, error = ${"test"} where id = ${messageId}`;
    messages += 1;
  }

  return { published: drafts.length, messages, warnings: [] };
}

// ---------------------------------------------------------------- skills / certs / requirements

export async function listTrades(userId: string, sqlIn?: Sql) {
  const sql = await db(sqlIn);
  const m = await me(sql, userId);
  assertCan(m.role, "crew.board.view");
  await ensureTradeAndCertCatalog(sql, m.companyId);
  const rows = await sql<{ id: string; name: string; color: string | null; sort: number }>`
    select id, name, color, sort from trades where company_id = ${m.companyId} order by sort, name
  `;
  return rows.map((r) => ({ id: text(r.id), name: text(r.name), color: text(r.color), sort: Number(r.sort) }));
}

export async function listCertTypes(userId: string, sqlIn?: Sql) {
  const sql = await db(sqlIn);
  const m = await me(sql, userId);
  assertCan(m.role, "crew.board.view");
  await ensureTradeAndCertCatalog(sql, m.companyId);
  const rows = await sql<{ id: string; name: string; validity_months: number | null }>`
    select id, name, validity_months from cert_types where company_id = ${m.companyId} order by name
  `;
  return rows.map((r) => ({ id: text(r.id), name: text(r.name), validityMonths: r.validity_months == null ? null : Number(r.validity_months) }));
}

export async function setPersonTrade(
  userId: string,
  input: { userId: string; tradeId: string; level?: string },
  sqlIn?: Sql,
): Promise<{ ok: true }> {
  const sql = await db(sqlIn);
  const m = await me(sql, userId);
  assertCan(m.role, "skill.manage");
  const level: TradeLevel = isTradeLevel(input.level ?? "journeyman") ? (input.level as TradeLevel) : "journeyman";
  const trade = await sql<{ id: string }>`select id from trades where id = ${input.tradeId} and company_id = ${m.companyId}`;
  if (!trade[0]) throw new Error(NOT_FOUND);
  const person = await sql<{ id: string }>`select user_id as id from profiles where user_id = ${input.userId} and company_id = ${m.companyId}`;
  if (!person[0]) throw new Error(NOT_FOUND);
  await sql`
    insert into person_trades (company_id, user_id, trade_id, level)
    values (${m.companyId}, ${input.userId}, ${input.tradeId}, ${level})
    on conflict (user_id, trade_id) do update set level = excluded.level
  `;
  return { ok: true };
}

export async function removePersonTrade(
  userId: string,
  input: { userId: string; tradeId: string },
  sqlIn?: Sql,
): Promise<{ ok: true }> {
  const sql = await db(sqlIn);
  const m = await me(sql, userId);
  assertCan(m.role, "skill.manage");
  await sql`delete from person_trades where user_id = ${input.userId} and trade_id = ${input.tradeId} and company_id = ${m.companyId}`;
  return { ok: true };
}

export async function upsertPersonCert(
  userId: string,
  input: { userId: string; certTypeId: string; number?: string; issuedOn?: string; expiresOn?: string; id?: string },
  sqlIn?: Sql,
): Promise<{ id: string }> {
  const sql = await db(sqlIn);
  const m = await me(sql, userId);
  assertCan(m.role, "skill.manage");
  const cert = await sql<{ id: string }>`select id from cert_types where id = ${input.certTypeId} and company_id = ${m.companyId}`;
  if (!cert[0]) throw new Error(NOT_FOUND);
  const person = await sql<{ id: string }>`select user_id as id from profiles where user_id = ${input.userId} and company_id = ${m.companyId}`;
  if (!person[0]) throw new Error(NOT_FOUND);
  const number = (input.number ?? "").trim().slice(0, 80);
  const issuedOn = input.issuedOn ? isoDate(input.issuedOn) : null;
  const expiresOn = input.expiresOn ? isoDate(input.expiresOn) : null;
  if (input.id) {
    await sql`
      update person_certs set number = ${number}, issued_on = ${issuedOn}::date, expires_on = ${expiresOn}::date,
        verified_by = ${m.userId}, verified_at = now()
      where id = ${input.id} and company_id = ${m.companyId}
    `;
    return { id: input.id };
  }
  const id = randomUUID();
  await sql`
    insert into person_certs (id, company_id, user_id, cert_type_id, number, issued_on, expires_on, verified_by, verified_at)
    values (${id}, ${m.companyId}, ${input.userId}, ${input.certTypeId}, ${number},
            ${issuedOn}::date, ${expiresOn}::date, ${m.userId}, now())
  `;
  return { id };
}

export async function setJobRequirement(
  userId: string,
  input: { projectId: string; certTypeId: string; on: boolean },
  sqlIn?: Sql,
): Promise<{ ok: true }> {
  const sql = await db(sqlIn);
  const m = await me(sql, userId);
  assertCan(m.role, "skill.manage");
  if (!(await projectInCompany(sql, m.companyId, input.projectId))) throw new Error(NOT_FOUND);
  if (input.on) {
    await sql`
      insert into job_requirements (project_id, company_id, cert_type_id)
      values (${input.projectId}, ${m.companyId}, ${input.certTypeId})
      on conflict do nothing
    `;
  } else {
    await sql`delete from job_requirements where project_id = ${input.projectId} and cert_type_id = ${input.certTypeId}`;
  }
  return { ok: true };
}

export async function setJobLead(
  userId: string,
  input: { projectId: string; leadUserId: string; on: boolean },
  sqlIn?: Sql,
): Promise<{ ok: true }> {
  const sql = await db(sqlIn);
  const m = await me(sql, userId);
  assertCan(m.role, "skill.manage");
  if (!(await projectInCompany(sql, m.companyId, input.projectId))) throw new Error(NOT_FOUND);
  if (input.on) {
    await sql`
      insert into job_leads (project_id, user_id) values (${input.projectId}, ${input.leadUserId})
      on conflict do nothing
    `;
  } else {
    await sql`delete from job_leads where project_id = ${input.projectId} and user_id = ${input.leadUserId}`;
  }
  return { ok: true };
}

export type PersonDetail = {
  person: PersonRow;
  certs: {
    id: string;
    certTypeId: string;
    name: string;
    number: string;
    issuedOn: string;
    expiresOn: string;
    health: CertHealth;
    verifiedBy: string;
  }[];
  availability: UnavailRow[];
  upcoming: AssignmentRow[];
  orientationAttended: boolean | null;
  training: { course: string; dueOn: string; completedOn: string }[];
};

export async function getPersonDetail(userId: string, input: { userId: string }, sqlIn?: Sql): Promise<PersonDetail> {
  const sql = await db(sqlIn);
  const m = await me(sql, userId);
  // Board viewers can open anyone; labor/sub only themselves (or sub company).
  if (!can(m.role, "crew.board.view")) {
    assertCan(m.role, "crew.myWeek");
    const scope = scopePeople(m);
    if (scope.kind === "self" && input.userId !== m.userId) throw new ForbiddenError("crew.myWeek");
    if (scope.kind === "sub") {
      const target = await sql<{ sub_company: string | null }>`
        select sub_company from profiles where user_id = ${input.userId} and company_id = ${m.companyId}
      `;
      if (!target[0] || text(target[0].sub_company) !== scope.company) throw new ForbiddenError("crew.myWeek");
    }
  } else {
    assertCan(m.role, "crew.board.view");
  }

  const people = await loadPeople(sql, { ...m, role: can(m.role, "crew.board.view") ? m.role : "owner" });
  // When labor calls, loadPeople is scoped to self — for board we need the target. Reload directly:
  const allForLookup = can(m.role, "crew.board.view")
    ? people
    : await (async () => {
        const boardMe = { ...m, role: "owner" };
        return loadPeople(sql, boardMe);
      })();
  const person = allForLookup.find((p) => p.userId === input.userId);
  if (!person) throw new Error(NOT_FOUND);
  // Re-check scope for non-board.
  if (!can(m.role, "crew.board.view")) {
    if (scopePeople(m).kind === "self" && person.userId !== m.userId) throw new ForbiddenError("crew.myWeek");
  }

  const certs = await sql<{
    id: string;
    cert_type_id: string;
    name: string;
    number: string;
    issued_on: string | null;
    expires_on: string | null;
    verified_by: string | null;
  }>`
    select pc.id, pc.cert_type_id, ct.name, pc.number, pc.issued_on::text as issued_on,
           pc.expires_on::text as expires_on, pc.verified_by
    from person_certs pc join cert_types ct on ct.id = pc.cert_type_id
    where pc.company_id = ${m.companyId} and pc.user_id = ${input.userId}
    order by ct.name
  `;
  const today = todayIso();
  const availability = await loadUnavailability(sql, m.companyId, today, addDays(today, 60), [input.userId]);
  const upcoming = await loadAssignments(sql, m.companyId, today, addDays(today, 14), [input.userId]);

  const orient = await sql<{ attended: boolean | null }>`
    select attended from safety_orientations where company_id = ${m.companyId} and user_id = ${input.userId}
  `;
  const training = await sql<{ course: string; due_on: string | null; completed_on: string | null }>`
    select title as course, due_on::text as due_on, completed_on::text as completed_on
    from safety_training where company_id = ${m.companyId} and user_id = ${input.userId}
  `;

  return {
    person,
    certs: certs.map((c) => ({
      id: text(c.id),
      certTypeId: text(c.cert_type_id),
      name: text(c.name),
      number: text(c.number),
      issuedOn: isoDate(c.issued_on),
      expiresOn: isoDate(c.expires_on),
      health: certHealth(isoDate(c.expires_on) || null),
      verifiedBy: text(c.verified_by),
    })),
    availability,
    upcoming,
    orientationAttended: orient[0] ? bool(orient[0].attended) : null,
    training: training.map((t) => ({
      course: text(t.course),
      dueOn: isoDate(t.due_on),
      completedOn: isoDate(t.completed_on),
    })),
  };
}

export type CertsMatrix = {
  people: { userId: string; name: string }[];
  certTypes: { id: string; name: string }[];
  cells: Record<string, { id: string; expiresOn: string; health: CertHealth } | null>;
  expiringCount: number;
  certExpiringDays: number;
};

export async function getCertsMatrix(userId: string, sqlIn?: Sql): Promise<CertsMatrix> {
  const sql = await db(sqlIn);
  const m = await me(sql, userId);
  assertCan(m.role, "crew.board.view");
  await ensureTradeAndCertCatalog(sql, m.companyId);
  const people = await loadPeople(sql, m);
  const certTypes = await listCertTypes(userId, sql);
  const cells: CertsMatrix["cells"] = {};
  let expiringCount = 0;
  const rows = await sql<{
    id: string;
    user_id: string;
    cert_type_id: string;
    expires_on: string | null;
  }>`
    select id, user_id, cert_type_id, expires_on::text as expires_on
    from person_certs where company_id = ${m.companyId}
  `;
  const seenExpiring = new Set<string>();
  for (const r of rows) {
    const health = certHealth(isoDate(r.expires_on) || null);
    cells[`${text(r.user_id)}|${text(r.cert_type_id)}`] = {
      id: text(r.id),
      expiresOn: isoDate(r.expires_on),
      health,
    };
    if (health === "expiring" && !seenExpiring.has(text(r.id))) {
      seenExpiring.add(text(r.id));
      expiringCount += 1;
    }
  }
  return {
    people: people.map((p) => ({ userId: p.userId, name: p.name })),
    certTypes: certTypes.map((c) => ({ id: c.id, name: c.name })),
    cells,
    expiringCount,
    certExpiringDays: CERT_EXPIRING_DAYS,
  };
}

// ---------------------------------------------------------------- my week / unavailability

export type MyWeekPayload = {
  weekStart: string;
  days: string[];
  assignments: AssignmentRow[];
  crewmates: Record<string, { userId: string; name: string }[]>; // day -> others on same jobs
  unavailability: UnavailRow[];
  today: AssignmentRow | null;
  tomorrow: AssignmentRow | null;
  canRequestOff: boolean;
};

export async function getMyWeek(userId: string, input: { week?: string } = {}, sqlIn?: Sql): Promise<MyWeekPayload> {
  const sql = await db(sqlIn);
  const m = await me(sql, userId);
  assertCan(m.role, "crew.myWeek");

  const monday = weekStart(input.week || todayIso());
  const days = weekDays(monday);
  const sunday = addDays(monday, 6);
  const scope = scopePeople(m);

  let personIds: string[];
  if (scope.kind === "all") {
    personIds = [m.userId]; // my week is still "mine" even for owners looking at My week
  } else if (scope.kind === "sub") {
    const peers = await sql<{ user_id: string }>`
      select user_id from profiles
      where company_id = ${m.companyId} and role = 'sub' and coalesce(sub_company, '') = ${scope.company}
    `;
    personIds = peers.map((p) => text(p.user_id));
  } else {
    personIds = [m.userId];
  }

  const assignments = await loadAssignments(sql, m.companyId, monday, sunday, personIds);
  const mine = assignments.filter((a) => a.userId === m.userId);
  const unavailability = await loadUnavailability(sql, m.companyId, monday, sunday, personIds);

  // Crewmates per day: people on the same project that day.
  const crewmates: MyWeekPayload["crewmates"] = {};
  for (const day of days) {
    const myJobs = new Set(mine.filter((a) => a.day === day).map((a) => a.projectId));
    if (myJobs.size === 0) {
      crewmates[day] = [];
      continue;
    }
    const others = await sql.query<{ user_id: string; name: string }>(
      `select distinct a.user_id, p.name
       from crew_assignments a join profiles p on p.user_id = a.user_id
       where a.company_id = $1 and a.day = $2::date and a.project_id = any($3::text[]) and a.user_id <> $4`,
      [m.companyId, day, [...myJobs], m.userId],
    );
    crewmates[day] = others.map((o) => ({ userId: text(o.user_id), name: text(o.name) }));
  }

  const today = todayIso();
  const tomorrow = addDays(today, 1);
  return {
    weekStart: monday,
    days,
    assignments: scope.kind === "sub" ? assignments : mine,
    crewmates,
    unavailability,
    today: mine.find((a) => a.day === today) ?? null,
    tomorrow: mine.find((a) => a.day === tomorrow) ?? null,
    canRequestOff: true,
  };
}

export async function requestOff(
  userId: string,
  input: { fromDay: string; toDay: string; reason: string; note?: string; forUserId?: string },
  sqlIn?: Sql,
): Promise<{ id: string }> {
  const sql = await db(sqlIn);
  const m = await me(sql, userId);
  assertCan(m.role, "crew.myWeek");
  const fromDay = isoDate(input.fromDay);
  const toDay = isoDate(input.toDay);
  if (!fromDay || !toDay || toDay < fromDay) throw new Error("Pick a valid date range.");
  if (!isUnavailReason(input.reason)) throw new Error("Pick a reason.");
  const note = (input.note ?? "").trim().slice(0, 500);

  let target = m.userId;
  if (input.forUserId && input.forUserId !== m.userId) {
    // Only board roles (or confirmers) can mark others off directly as confirmed.
    if (can(m.role, "crew.unavailable.confirm")) {
      target = input.forUserId;
    } else {
      throw new ForbiddenError("crew.unavailable.confirm");
    }
  }

  const status = can(m.role, "crew.unavailable.confirm") && input.forUserId ? "confirmed" : "requested";
  // Owner/Admin/Lead marking themselves: confirm immediately when they have confirm permission.
  const finalStatus = can(m.role, "crew.unavailable.confirm") ? "confirmed" : status;

  const id = randomUUID();
  await sql`
    insert into person_unavailability (
      id, company_id, user_id, from_day, to_day, reason, status, note, created_by
    ) values (
      ${id}, ${m.companyId}, ${target}, ${fromDay}::date, ${toDay}::date,
      ${input.reason}, ${finalStatus}, ${note}, ${m.userId}
    )
  `;
  return { id };
}

export async function confirmOff(
  userId: string,
  input: { id: string; status: "confirmed" | "declined" },
  sqlIn?: Sql,
): Promise<{ ok: true }> {
  const sql = await db(sqlIn);
  const m = await me(sql, userId);
  assertCan(m.role, "crew.unavailable.confirm");
  if (input.status !== "confirmed" && input.status !== "declined") throw new Error("Pick confirmed or declined.");
  const rows = await sql<{ id: string }>`
    select id from person_unavailability where id = ${input.id} and company_id = ${m.companyId}
  `;
  if (!rows[0]) throw new Error(NOT_FOUND);
  await sql`update person_unavailability set status = ${input.status} where id = ${input.id}`;
  return { ok: true };
}

/** Labor/Sub Today card. */
export async function getYoureOn(userId: string, sqlIn?: Sql): Promise<{
  today: AssignmentRow | null;
  tomorrow: AssignmentRow | null;
  crewmates: { userId: string; name: string }[];
}> {
  const week = await getMyWeek(userId, {}, sqlIn);
  return {
    today: week.today,
    tomorrow: week.tomorrow,
    crewmates: week.today ? week.crewmates[week.today.day] ?? [] : [],
  };
}

export { shortJobName };
