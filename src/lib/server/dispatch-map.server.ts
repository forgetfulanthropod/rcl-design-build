/**
 * Dispatch map data and the "put a crew on this job" action.
 *
 * Facts come from the tables the desk already writes:
 *   projects            — the job, its address, its phase
 *   crew_assignments    — who is scheduled on which day (the assign action writes here)
 *   work_sessions       — hours someone logged on a job
 *   activities          — the activity log
 *   daily_reports       — the field report for a job-day
 *
 * Who can assign: the same roles as the morning dispatch sheet (dispatch.edit:
 * superadmin, owner, admin, lead). A lead can staff any company job from this
 * map; it is the dispatch board, not the per-job crew grid. Labor and
 * subcontractors can open the map and cannot change it.
 *
 * Relative imports so the PGLite tests can load this under node:test.
 */
import { randomUUID } from "node:crypto";
import type { Sql } from "../db.ts";
import { addDays, todayIso, unavailLabel, type UnavailReason } from "../crew.ts";
import { geocodeAddress } from "../geo.ts";
import { assertCan, can, ForbiddenError } from "../permissions.ts";
import {
  MAP_FUTURE_DAYS,
  mapRange,
  type DispatchMapFacts,
  type MapPersonInput,
  type MapPresence,
  type PresenceKind,
} from "../dispatch-map.ts";

export { ForbiddenError };

const NOT_FOUND = "Not found";
const text = (value: unknown) => (value == null ? "" : String(value));
const on = (value: unknown) => value === true || value === "t" || value === "true" || value === 1;

function isoDate(value: unknown): string {
  if (value == null || value === "") return "";
  if (typeof value === "string") return value.slice(0, 10);
  return String(value).slice(0, 10);
}

async function db(sql?: Sql): Promise<Sql> {
  if (sql) return sql;
  const { getSql } = await import("../db.ts");
  return getSql();
}

type Me = { userId: string; companyId: string; role: string };

async function me(sql: Sql, userId: string): Promise<Me> {
  const rows = await sql<{ company_id: string; role: string }>`
    select company_id, role from profiles where user_id = ${userId}
  `;
  if (!rows[0]) throw new Error("Finish company setup first.");
  return { userId, companyId: text(rows[0].company_id), role: text(rows[0].role) };
}

const KIND: Record<string, PresenceKind> = {
  assignment: "assignment",
  session: "session",
  activity: "activity",
  report: "report",
};

export async function getMap(userId: string, sqlIn?: Sql): Promise<DispatchMapFacts> {
  const sql = await db(sqlIn);
  const m = await me(sql, userId);
  assertCan(m.role, "dispatch.view");
  const today = todayIso();
  const range = mapRange(today);

  const jobs = await sql<{ id: string; name: string; address: string; phase: string }>`
    select id, name, address, phase from projects
    where company_id = ${m.companyId} and archived = false
    order by name
  `;
  const people = await sql<{ user_id: string; name: string; active: boolean }>`
    select user_id, name, active from profiles
    where company_id = ${m.companyId}
    order by name
  `;
  const presences = await loadPresences(sql, m.companyId, range.start, range.end);

  return {
    today,
    rangeStart: range.start,
    rangeEnd: range.end,
    canEdit: can(m.role, "dispatch.edit"),
    jobs: jobs.map((job) => {
      const address = text(job.address);
      const point = geocodeAddress(address || text(job.name));
      return {
        id: text(job.id),
        name: text(job.name),
        address,
        phase: text(job.phase),
        lat: point.lat,
        lng: point.lng,
      };
    }),
    people: people.map(
      (person): MapPersonInput => ({
        userId: text(person.user_id),
        name: text(person.name) || "Crew",
        active: person.active == null ? true : on(person.active),
      }),
    ),
    presences,
  };
}

async function loadPresences(sql: Sql, companyId: string, start: string, end: string): Promise<MapPresence[]> {
  const rows = await sql.query<{ user_id: string; project_id: string; day: string; kind: string }>(
    `select user_id, project_id, day::text as day, kind from (
       select user_id, project_id, day, 'assignment' as kind
         from crew_assignments
        where company_id = $1 and day >= $2::date and day <= $3::date
       union all
       select user_id, project_id, day, 'session'
         from work_sessions
        where company_id = $1 and project_id is not null and day >= $2::date and day <= $3::date
       union all
       select created_by as user_id, project_id, day, 'activity'
         from activities
        where company_id = $1 and project_id is not null and day >= $2::date and day <= $3::date
       union all
       select user_id, project_id, day, 'report'
         from daily_reports
        where company_id = $1 and project_id is not null and day >= $2::date and day <= $3::date
     ) days
     where project_id is not null`,
    [companyId, start, end],
  );
  return rows
    .map((row) => {
      const kind = KIND[text(row.kind)];
      if (!kind) return null;
      return {
        userId: text(row.user_id),
        projectId: text(row.project_id),
        day: isoDate(row.day),
        kind,
      };
    })
    .filter((row): row is MapPresence => Boolean(row));
}

/**
 * Staff one job for one day. Writes crew_assignments, the same rows the crew
 * board reads. The day has to be today or later, inside the map's six-month window.
 */
export async function assignCrew(
  userId: string,
  input: { projectId: string; day: string; userIds: string[] },
  sqlIn?: Sql,
): Promise<{ ids: string[]; day: string }> {
  const sql = await db(sqlIn);
  const m = await me(sql, userId);
  assertCan(m.role, "dispatch.edit");

  const day = isoDate(input.day);
  const today = todayIso();
  const latest = addDays(today, MAP_FUTURE_DAYS);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || day < today || day > latest) {
    throw new Error("Pick a day from today through the next 6 months.");
  }
  const userIds = [...new Set(input.userIds.map((id) => text(id).trim()).filter(Boolean))];
  if (userIds.length === 0) throw new Error("Pick at least one person.");
  if (userIds.length > 24) throw new Error("Pick at most 24 people.");

  const project = await sql<{ id: string; name: string; archived: boolean }>`
    select id, name, archived from projects where id = ${input.projectId} and company_id = ${m.companyId}
  `;
  if (!project[0] || on(project[0].archived)) throw new Error(NOT_FOUND);

  const ids: string[] = [];
  for (const targetId of userIds) {
    ids.push(await placeOne(sql, m, input.projectId, text(project[0].name), targetId, day));
  }
  return { ids, day };
}

async function placeOne(
  sql: Sql,
  m: Me,
  projectId: string,
  projectName: string,
  targetId: string,
  day: string,
): Promise<string> {
  const target = await sql<{ name: string; active: boolean }>`
    select name, active from profiles where user_id = ${targetId} and company_id = ${m.companyId}
  `;
  if (!target[0] || (target[0].active != null && !on(target[0].active))) throw new Error(NOT_FOUND);
  const personName = text(target[0].name) || "That person";

  const off = await sql<{ reason: string }>`
    select reason from person_unavailability
    where company_id = ${m.companyId} and user_id = ${targetId}
      and status = 'confirmed' and from_day <= ${day}::date and to_day >= ${day}::date
  `;
  if (off[0]) {
    throw new Error(`${personName} is unavailable that day (${unavailLabel(text(off[0].reason) as UnavailReason)}).`);
  }

  const existing = await sql<{ id: string; project_id: string; project_name: string }>`
    select a.id, a.project_id, p.name as project_name
    from crew_assignments a
    join projects p on p.id = a.project_id
    where a.company_id = ${m.companyId} and a.user_id = ${targetId} and a.day = ${day}::date
  `;
  for (const row of existing) {
    if (text(row.project_id) === projectId) return text(row.id);
    throw new Error(`${personName} is already on ${text(row.project_name) || "another job"} that day.`);
  }

  const id = randomUUID();
  try {
    await sql`
      insert into crew_assignments (
        id, company_id, user_id, project_id, day, part, note, status, assigned_by
      ) values (
        ${id}, ${m.companyId}, ${targetId}, ${projectId}, ${day}::date, ${"full"}, ${""}, ${"draft"}, ${m.userId}
      )
    `;
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "";
    if (/unique|duplicate/i.test(message)) {
      throw new Error(`${personName} is already on ${projectName} that day.`);
    }
    throw cause;
  }
  return id;
}
