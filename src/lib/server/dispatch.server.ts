/**
 * Dispatch board. Where each person goes, from 8:00 AM.
 *
 * Locations reuse a job (projects) when one is picked, and can also be a site that
 * is not a job (the shop, the yard). Full-time placements carry forward until changed.
 * Part-time placements exist only on the day they are written.
 *
 * Relative imports so PGLite server tests can load this under node:test.
 * Every exported function takes an optional `sql` for those tests; the app passes none.
 *
 * Who can edit: superadmin, owner, admin, and lead (the same people who schedule the crew).
 * Labor and subcontractors can open the board and cannot change it.
 * A lead edits the whole company sheet, not only jobs they lead — this is the morning
 * whiteboard, not the per-job crew assignment.
 */
import { randomUUID } from "node:crypto";
import type { Sql } from "../db.ts";
import { assertCan, can, ForbiddenError } from "../permissions.ts";
import {
  DISPATCH_START_LABEL,
  DISPATCH_START_MIN,
  NOTE_MAX,
  dispatchMessage,
  dispatchWeekDays,
  formatDispatchDay,
  isDispatchKind,
  resolveDay,
  toE164,
  type DispatchKind,
  type PlacementRow,
  type ResolvedPlacement,
} from "../dispatch.ts";
import { formatDay, weekStart as mondayOf } from "../crew.ts";

export { ForbiddenError };

export const NOT_FOUND = "Not found";

type Me = { userId: string; companyId: string; role: string; name: string };

const text = (value: unknown) => (value == null ? "" : String(value));
const on = (value: unknown) => value === true || value === "t" || value === "true" || value === 1;

function isoDate(value: unknown): string {
  if (value == null || value === "") return "";
  if (typeof value === "string") return value.slice(0, 10);
  if (value instanceof Date) return formatDay(value);
  return String(value).slice(0, 10);
}

function clip(value: string, max: number): string {
  return value.trim().slice(0, max);
}

async function db(sql?: Sql): Promise<Sql> {
  if (sql) return sql;
  const { getSql } = await import("../db.ts");
  return getSql();
}

async function me(sql: Sql, userId: string): Promise<Me> {
  const rows = await sql<{ company_id: string; role: string; name: string }>`
    select company_id, role, name from profiles where user_id = ${userId}
  `;
  if (!rows[0]) throw new Error("Finish company setup first.");
  return {
    userId,
    companyId: text(rows[0].company_id),
    role: text(rows[0].role),
    name: text(rows[0].name),
  };
}

type LocationRecord = {
  id: string;
  project_id: string | null;
  name: string;
  address: string;
  notes: string;
  sort: number;
  project_name: string | null;
  project_address: string | null;
};

async function loadLocations(sql: Sql, companyId: string): Promise<LocationRecord[]> {
  return sql.query<LocationRecord>(
    `select l.id, l.project_id, l.name, l.address, l.notes, l.sort,
            p.name as project_name, p.address as project_address
     from dispatch_locations l
     left join projects p on p.id = l.project_id
     where l.company_id = $1 and l.archived = false
     order by l.sort, l.name`,
    [companyId],
  );
}

type PlaceRecord = { user_id: string; location_id: string | null; day: string; kind: string };

async function loadPlacements(
  sql: Sql,
  companyId: string,
  monday: string,
  sunday: string,
): Promise<PlacementRow[]> {
  const prior = await sql.query<PlaceRecord>(
    `select distinct on (user_id) user_id, location_id, day::text as day, kind
     from dispatch_placements
     where company_id = $1 and kind = 'full' and day <= $2::date
     order by user_id, day desc`,
    [companyId, monday],
  );
  const during = await sql.query<PlaceRecord>(
    `select user_id, location_id, day::text as day, kind
     from dispatch_placements
     where company_id = $1 and kind = 'full' and day > $2::date and day <= $3::date`,
    [companyId, monday, sunday],
  );
  const part = await sql.query<PlaceRecord>(
    `select user_id, location_id, day::text as day, kind
     from dispatch_placements
     where company_id = $1 and kind = 'part' and day >= $2::date and day <= $3::date`,
    [companyId, monday, sunday],
  );
  return [...prior, ...during, ...part].map((row) => ({
    userId: text(row.user_id),
    locationId: row.location_id ? text(row.location_id) : null,
    day: isoDate(row.day),
    kind: text(row.kind) === "part" ? "part" : "full",
  }));
}

export type DispatchLocation = {
  id: string;
  projectId: string | null;
  name: string;
  address: string;
  standingNotes: string;
  dayNotes: string;
  linked: boolean;
};

export type DispatchPerson = {
  userId: string;
  name: string;
  role: string;
  kind: DispatchKind;
  phone: string | null;
};

export type DispatchBoard = {
  day: string;
  weekStart: string;
  days: string[];
  startMin: number;
  startLabel: string;
  canEdit: boolean;
  locations: DispatchLocation[];
  people: DispatchPerson[];
  /** Location instructions for each day of the week. */
  locationInstructions: { locationId: string; day: string; body: string }[];
  /** Per-person instructions for each day of the week. */
  personInstructions: { userId: string; day: string; body: string }[];
  daysPlaced: { day: string; placements: ResolvedPlacement[] }[];
  projects: { id: string; name: string; address: string }[];
  candidates: { userId: string; name: string; role: string }[];
};

export type DispatchNotice = { userId: string; to: string; body: string };
export type DispatchHooks = {
  /** Test double for the Twilio send. Production uses deliverOutbound. */
  notify?: (notice: DispatchNotice) => Promise<void>;
};

export async function getBoard(
  userId: string,
  input: { day?: string } = {},
  sqlIn?: Sql,
): Promise<DispatchBoard> {
  const sql = await db(sqlIn);
  const m = await me(sql, userId);
  assertCan(m.role, "dispatch.view");
  const day = input.day && /^\d{4}-\d{2}-\d{2}$/.test(input.day) ? input.day : isoDate(new Date());
  const monday = mondayOf(day);
  const days = dispatchWeekDays(day);
  const sunday = days[6];

  const locationRows = await loadLocations(sql, m.companyId);
  const locations: DispatchLocation[] = locationRows.map((row) => {
    const linked = Boolean(row.project_id);
    return {
      id: text(row.id),
      projectId: row.project_id ? text(row.project_id) : null,
      name: linked && row.project_name ? text(row.project_name) : text(row.name),
      address: linked ? text(row.project_address) : text(row.address),
      standingNotes: text(row.notes),
      dayNotes: "",
      linked,
    };
  });

  const roster = await sql<{ user_id: string; name: string; role: string; kind: string; phone: string | null }>`
    select r.user_id, p.name, p.role, r.kind, p.phone
    from dispatch_roster r
    join profiles p on p.user_id = r.user_id and p.company_id = r.company_id
    where r.company_id = ${m.companyId}
    order by p.name
  `;
  const people: DispatchPerson[] = roster.map((row) => ({
    userId: text(row.user_id),
    name: text(row.name),
    role: text(row.role),
    kind: text(row.kind) === "part" ? "part" : "full",
    phone: text(row.phone) || null,
  }));

  const locationInstructions = locations.length
    ? (
        await sql.query<{ location_id: string; day: string; notes: string }>(
          `select location_id, day::text as day, notes from dispatch_day_notes
           where location_id = any($1::text[]) and day >= $2::date and day <= $3::date`,
          [locations.map((l) => l.id), monday, sunday],
        )
      ).map((row) => ({ locationId: text(row.location_id), day: isoDate(row.day), body: text(row.notes) }))
    : [];
  for (const location of locations) {
    location.dayNotes = locationInstructions.find((note) => note.locationId === location.id && note.day === day)?.body ?? "";
  }

  const personInstructions = (
    await sql.query<{ user_id: string; day: string; notes: string }>(
      `select user_id, day::text as day, notes from dispatch_person_notes
       where company_id = $1 and day >= $2::date and day <= $3::date`,
      [m.companyId, monday, sunday],
    )
  ).map((row) => ({ userId: text(row.user_id), day: isoDate(row.day), body: text(row.notes) }));

  const placements = await loadPlacements(sql, m.companyId, monday, sunday);
  const activeIds = locations.map((l) => l.id);
  const daysPlaced = days.map((d) => ({
    day: d,
    placements: resolveDay(people, placements, activeIds, d),
  }));

  const editable = can(m.role, "dispatch.edit");
  let projects: DispatchBoard["projects"] = [];
  let candidates: DispatchBoard["candidates"] = [];
  if (editable) {
    const taken = locations.map((l) => l.projectId).filter((id): id is string => Boolean(id));
    const projectRows = await sql.query<{ id: string; name: string; address: string }>(
      taken.length
        ? `select id, name, address from projects
           where company_id = $1 and archived = false and not (id = any($2::text[]))
           order by name`
        : `select id, name, address from projects
           where company_id = $1 and archived = false
           order by name`,
      taken.length ? [m.companyId, taken] : [m.companyId],
    );
    projects = projectRows.map((row) => ({
      id: text(row.id),
      name: text(row.name),
      address: text(row.address),
    }));
    const candidateRows = await sql<{ user_id: string; name: string; role: string }>`
      select user_id, name, role from profiles
      where company_id = ${m.companyId} and active = true
        and user_id not in (select user_id from dispatch_roster where company_id = ${m.companyId})
      order by name
    `;
    candidates = candidateRows.map((row) => ({
      userId: text(row.user_id),
      name: text(row.name),
      role: text(row.role),
    }));
  }

  return {
    day,
    weekStart: monday,
    days,
    startMin: DISPATCH_START_MIN,
    startLabel: DISPATCH_START_LABEL,
    canEdit: editable,
    locations,
    people,
    locationInstructions,
    personInstructions,
    daysPlaced,
    projects,
    candidates,
  };
}

async function assertLocation(
  sql: Sql,
  companyId: string,
  locationId: string,
): Promise<{ project_id: string | null }> {
  const rows = await sql<{ project_id: string | null }>`
    select project_id from dispatch_locations
    where id = ${locationId} and company_id = ${companyId} and archived = false
  `;
  if (!rows[0]) throw new Error(NOT_FOUND);
  return rows[0];
}

export async function addLocation(
  userId: string,
  input: { projectId?: string | null; name?: string; address?: string; notes?: string },
  sqlIn?: Sql,
): Promise<{ id: string }> {
  const sql = await db(sqlIn);
  const m = await me(sql, userId);
  assertCan(m.role, "dispatch.edit");
  const notes = clip(input.notes ?? "", NOTE_MAX);
  let name = clip(input.name ?? "", 120);
  let address = clip(input.address ?? "", 160);
  const projectId = input.projectId?.trim() || null;

  if (projectId) {
    const jobs = await sql<{ name: string; address: string; archived: boolean }>`
      select name, address, archived from projects where id = ${projectId} and company_id = ${m.companyId}
    `;
    if (!jobs[0] || on(jobs[0].archived)) throw new Error(NOT_FOUND);
    name = clip(text(jobs[0].name), 120);
    address = clip(text(jobs[0].address), 160);
    const existing = await sql<{ id: string; archived: boolean }>`
      select id, archived from dispatch_locations where company_id = ${m.companyId} and project_id = ${projectId}
    `;
    if (existing[0] && !on(existing[0].archived))
      throw new Error("That job is already on the board.");
    if (existing[0]) {
      await sql`
        update dispatch_locations
        set archived = false, name = ${name}, address = ${address}, notes = ${notes}, updated_at = now()
        where id = ${text(existing[0].id)}
      `;
      return { id: text(existing[0].id) };
    }
  } else if (!name) {
    throw new Error("Name the location.");
  }

  const dup = await sql<{ id: string }>`
    select id from dispatch_locations
    where company_id = ${m.companyId} and archived = false and lower(name) = lower(${name})
  `;
  if (dup[0]) throw new Error("That location is already on the board.");

  const sortRow = await sql<{ n: number }>`
    select coalesce(max(sort), 0) + 1 as n from dispatch_locations where company_id = ${m.companyId}
  `;
  const id = randomUUID();
  await sql`
    insert into dispatch_locations (id, company_id, project_id, name, address, notes, sort, created_by)
    values (${id}, ${m.companyId}, ${projectId}, ${name}, ${address}, ${notes}, ${Number(sortRow[0]?.n ?? 1)}, ${m.userId})
  `;
  return { id };
}

export async function updateLocation(
  userId: string,
  input: { id: string; name?: string; address?: string; notes?: string; archived?: boolean },
  sqlIn?: Sql,
): Promise<{ ok: true }> {
  const sql = await db(sqlIn);
  const m = await me(sql, userId);
  assertCan(m.role, "dispatch.edit");
  const current = await sql<{
    project_id: string | null;
    name: string;
    address: string;
    notes: string;
  }>`
    select project_id, name, address, notes from dispatch_locations
    where id = ${input.id} and company_id = ${m.companyId}
  `;
  if (!current[0]) throw new Error(NOT_FOUND);
  const linked = Boolean(current[0].project_id);
  const name = linked ? text(current[0].name) : clip(input.name ?? text(current[0].name), 120);
  const address = linked
    ? text(current[0].address)
    : clip(input.address ?? text(current[0].address), 160);
  if (!name) throw new Error("Name the location.");
  const notes = input.notes === undefined ? text(current[0].notes) : clip(input.notes, NOTE_MAX);
  const archived = input.archived === true;
  await sql`
    update dispatch_locations
    set name = ${name}, address = ${address}, notes = ${notes}, archived = ${archived}, updated_at = now()
    where id = ${input.id} and company_id = ${m.companyId}
  `;
  return { ok: true };
}

export async function setDayNote(
  userId: string,
  input: { locationId: string; day: string; notes: string },
  sqlIn?: Sql,
  hooks?: DispatchHooks,
): Promise<{ ok: true }> {
  const sql = await db(sqlIn);
  const m = await me(sql, userId);
  assertCan(m.role, "dispatch.edit");
  await assertLocation(sql, m.companyId, input.locationId);
  const notes = clip(input.notes ?? "", NOTE_MAX);
  const existing = await sql<{ notes: string }>`
    select notes from dispatch_day_notes where location_id = ${input.locationId} and day = ${input.day}::date
  `;
  if (!notes) {
    if (!existing[0]) return { ok: true };
    await sql`delete from dispatch_day_notes where location_id = ${input.locationId} and day = ${input.day}::date`;
    await notifyAssignees(sql, m, input.day, input.locationId, "location", sqlIn, hooks);
    return { ok: true };
  }
  await sql`
    insert into dispatch_day_notes (location_id, day, notes, updated_by)
    values (${input.locationId}, ${input.day}::date, ${notes}, ${m.userId})
    on conflict (location_id, day) do update
    set notes = ${notes}, updated_by = ${m.userId}, updated_at = now()
  `;
  await notifyAssignees(sql, m, input.day, input.locationId, null, sqlIn, hooks);
  return { ok: true };
}

async function profileInCompany(
  sql: Sql,
  companyId: string,
  targetUser: string,
): Promise<{ name: string } | null> {
  const rows = await sql<{ name: string; active: boolean }>`
    select name, active from profiles where user_id = ${targetUser} and company_id = ${companyId}
  `;
  if (!rows[0] || !on(rows[0].active)) return null;
  return { name: text(rows[0].name) };
}

export async function addPerson(
  userId: string,
  input: { userId: string; kind: string; day: string; locationId?: string | null },
  sqlIn?: Sql,
): Promise<{ ok: true }> {
  const sql = await db(sqlIn);
  const m = await me(sql, userId);
  assertCan(m.role, "dispatch.edit");
  if (!isDispatchKind(input.kind)) throw new Error("Pick full-time or part-time.");
  const target = input.userId;
  if (!(await profileInCompany(sql, m.companyId, target))) throw new Error(NOT_FOUND);
  const existing = await sql<{ user_id: string }>`
    select user_id from dispatch_roster where company_id = ${m.companyId} and user_id = ${target}
  `;
  if (existing[0]) throw new Error("Already on the schedule.");
  await sql`
    insert into dispatch_roster (company_id, user_id, kind, created_by)
    values (${m.companyId}, ${target}, ${input.kind}, ${m.userId})
  `;
  if (input.kind === "full" && input.locationId) {
    await placePerson(
      userId,
      { userId: target, day: input.day, locationId: input.locationId },
      sql,
    );
  }
  return { ok: true };
}

export async function setPersonKind(
  userId: string,
  input: { userId: string; kind: string; day: string; locationId?: string | null },
  sqlIn?: Sql,
): Promise<{ ok: true }> {
  const sql = await db(sqlIn);
  const m = await me(sql, userId);
  assertCan(m.role, "dispatch.edit");
  if (!isDispatchKind(input.kind)) throw new Error("Pick full-time or part-time.");
  const target = input.userId;
  const roster = await sql<{ user_id: string }>`
    select user_id from dispatch_roster where company_id = ${m.companyId} and user_id = ${target}
  `;
  if (!roster[0]) throw new Error(NOT_FOUND);
  await sql`
    update dispatch_roster set kind = ${input.kind}
    where company_id = ${m.companyId} and user_id = ${target}
  `;
  if (input.kind === "full" && input.locationId) {
    await placePerson(
      userId,
      { userId: target, day: input.day, locationId: input.locationId },
      sql,
    );
  }
  return { ok: true };
}

export async function removePerson(
  userId: string,
  input: { userId: string },
  sqlIn?: Sql,
): Promise<{ ok: true }> {
  const sql = await db(sqlIn);
  const m = await me(sql, userId);
  assertCan(m.role, "dispatch.edit");
  const roster = await sql<{ user_id: string }>`
    select user_id from dispatch_roster where company_id = ${m.companyId} and user_id = ${input.userId}
  `;
  if (!roster[0]) throw new Error(NOT_FOUND);
  await sql`delete from dispatch_placements where company_id = ${m.companyId} and user_id = ${input.userId}`;
  await sql`delete from dispatch_roster where company_id = ${m.companyId} and user_id = ${input.userId}`;
  return { ok: true };
}

async function writePlacement(
  sql: Sql,
  m: Me,
  target: string,
  day: string,
  locationId: string | null,
  kind: DispatchKind,
): Promise<void> {
  const id = randomUUID();
  await sql`
    insert into dispatch_placements (id, company_id, user_id, location_id, day, kind, placed_by)
    values (${id}, ${m.companyId}, ${target}, ${locationId}, ${day}::date, ${kind}, ${m.userId})
    on conflict (company_id, user_id, day) do update
    set location_id = ${locationId}, kind = ${kind}, placed_by = ${m.userId}, updated_at = now()
  `;
}

export async function placePerson(
  userId: string,
  input: { userId: string; day: string; locationId?: string | null },
  sqlIn?: Sql,
  hooks?: DispatchHooks,
): Promise<{ ok: true }> {
  const sql = await db(sqlIn);
  const m = await me(sql, userId);
  assertCan(m.role, "dispatch.edit");
  const target = input.userId;
  const roster = await sql<{ kind: string }>`
    select kind from dispatch_roster where company_id = ${m.companyId} and user_id = ${target}
  `;
  if (!roster[0]) throw new Error(NOT_FOUND);
  const kind: DispatchKind = text(roster[0].kind) === "part" ? "part" : "full";
  const locationId = input.locationId?.trim() || null;
  if (locationId) await assertLocation(sql, m.companyId, locationId);
  if (kind === "full" && !locationId) throw new Error("Pick a location.");
  if (kind === "part" && !locationId) {
    await sql`
      delete from dispatch_placements
      where company_id = ${m.companyId} and user_id = ${target} and day = ${input.day}::date
    `;
  } else {
    await writePlacement(sql, m, target, input.day, locationId, kind);
  }
  await notifyPeople(sql, m, input.day, [target], null, "assignment", sqlIn, hooks);
  return { ok: true };
}

export async function setPersonNote(
  userId: string,
  input: { userId: string; day: string; notes: string },
  sqlIn?: Sql,
  hooks?: DispatchHooks,
): Promise<{ ok: true }> {
  const sql = await db(sqlIn);
  const m = await me(sql, userId);
  assertCan(m.role, "dispatch.edit");
  const target = input.userId;
  const roster = await sql<{ user_id: string }>`
    select user_id from dispatch_roster where company_id = ${m.companyId} and user_id = ${target}
  `;
  if (!roster[0]) throw new Error(NOT_FOUND);
  const notes = clip(input.notes ?? "", NOTE_MAX);
  const existing = await sql<{ notes: string }>`
    select notes from dispatch_person_notes
    where company_id = ${m.companyId} and user_id = ${target} and day = ${input.day}::date
  `;
  if (!notes) {
    if (!existing[0]) return { ok: true };
    await sql`
      delete from dispatch_person_notes
      where company_id = ${m.companyId} and user_id = ${target} and day = ${input.day}::date
    `;
    await notifyPeople(sql, m, input.day, [target], "person", "instruction", sqlIn, hooks);
    return { ok: true };
  }
  await sql`
    insert into dispatch_person_notes (company_id, user_id, day, notes, updated_by)
    values (${m.companyId}, ${target}, ${input.day}::date, ${notes}, ${m.userId})
    on conflict (company_id, user_id, day) do update
    set notes = ${notes}, updated_by = ${m.userId}, updated_at = now()
  `;
  await notifyPeople(sql, m, input.day, [target], null, "instruction", sqlIn, hooks);
  return { ok: true };
}

export async function setPersonPhone(
  userId: string,
  input: { userId: string; phone: string },
  sqlIn?: Sql,
): Promise<{ phone: string | null }> {
  const sql = await db(sqlIn);
  const m = await me(sql, userId);
  assertCan(m.role, "dispatch.edit");
  const target = input.userId;
  const roster = await sql<{ user_id: string }>`
    select user_id from dispatch_roster where company_id = ${m.companyId} and user_id = ${target}
  `;
  if (!roster[0]) throw new Error(NOT_FOUND);
  const trimmed = (input.phone ?? "").trim();
  const phone = trimmed ? toE164(trimmed) : null;
  if (trimmed && !phone) throw new Error("Enter a mobile number with area code.");
  await sql`
    update profiles set phone = ${phone}
    where user_id = ${target} and company_id = ${m.companyId}
  `;
  return { phone };
}

async function userIdsAtLocation(sql: Sql, companyId: string, day: string, locationId: string): Promise<string[]> {
  const locations = await loadLocations(sql, companyId);
  const monday = mondayOf(day);
  const sunday = dispatchWeekDays(day)[6];
  const placements = await loadPlacements(sql, companyId, monday, sunday);
  const roster = await sql<{ user_id: string; kind: string }>`
    select user_id, kind from dispatch_roster where company_id = ${companyId}
  `;
  const people = roster.map((row) => ({
    userId: text(row.user_id),
    kind: text(row.kind) === "part" ? ("part" as const) : ("full" as const),
  }));
  return resolveDay(people, placements, locations.map((row) => text(row.id)), day)
    .filter((row) => row.locationId === locationId)
    .map((row) => row.userId);
}

async function notifyAssignees(
  sql: Sql,
  m: Me,
  day: string,
  locationId: string,
  cleared: "location" | null,
  sqlIn: Sql | undefined,
  hooks?: DispatchHooks,
) {
  const ids = await userIdsAtLocation(sql, m.companyId, day, locationId);
  await notifyPeople(sql, m, day, ids, cleared, "instruction", sqlIn, hooks);
}

async function notifyPeople(
  sql: Sql,
  m: Me,
  day: string,
  userIds: string[],
  cleared: "person" | "location" | null,
  event: "assignment" | "instruction",
  sqlIn: Sql | undefined,
  hooks?: DispatchHooks,
) {
  if (userIds.length === 0) return;
  const locations = await loadLocations(sql, m.companyId);
  const monday = mondayOf(day);
  const sunday = dispatchWeekDays(day)[6];
  const placements = await loadPlacements(sql, m.companyId, monday, sunday);
  const dayLabel = formatDispatchDay(day);
  const subject = event === "assignment" ? `Dispatch assignment ${day}` : `Dispatch instruction ${day}`;

  for (const target of userIds) {
    const profile = await sql<{ name: string; phone: string | null }>`
      select name, phone from profiles where user_id = ${target} and company_id = ${m.companyId}
    `;
    if (!profile[0]) continue;
    const phone = toE164(text(profile[0].phone));
    if (!phone) continue;

    const roster = await sql<{ kind: string }>`
      select kind from dispatch_roster where company_id = ${m.companyId} and user_id = ${target}
    `;
    const kind: DispatchKind = text(roster[0]?.kind) === "part" ? "part" : "full";
    const resolved = resolveDay(
      [{ userId: target, kind }],
      placements,
      locations.map((row) => text(row.id)),
      day,
    )[0];
    const location = locations.find((row) => text(row.id) === resolved?.locationId);
    const locationNote = location
      ? await sql<{ notes: string }>`
          select notes from dispatch_day_notes where location_id = ${text(location.id)} and day = ${day}::date
        `
      : [];
    const personNote = await sql<{ notes: string }>`
      select notes from dispatch_person_notes
      where company_id = ${m.companyId} and user_id = ${target} and day = ${day}::date
    `;
    const linked = Boolean(location?.project_id);
    const body = dispatchMessage({
      personName: text(profile[0].name) || "Crew",
      phone,
      dayLabel,
      startLabel: DISPATCH_START_LABEL,
      locationName: location ? (linked && location.project_name ? text(location.project_name) : text(location.name)) : null,
      locationAddress: location ? (linked ? text(location.project_address) : text(location.address)) : "",
      locationInstruction: cleared === "location" ? "" : text(locationNote[0]?.notes),
      personInstruction: cleared === "person" ? "" : text(personNote[0]?.notes),
      cleared,
    });

    if (event === "assignment") {
      const recent = await sql<{ id: string }>`
        select id from outbound_messages
        where company_id = ${m.companyId} and recipient_user_id = ${target}
          and kind = 'dispatch' and subject = ${subject}
          and created_at > now() - interval '15 seconds'
        order by created_at desc
        limit 1
      `;
      if (recent[0]) {
        await sql`update outbound_messages set body = ${body} where id = ${text(recent[0].id)}`;
        continue;
      }
    }

    const id = randomUUID();
    await sql`
      insert into outbound_messages (
        id, company_id, sender_user_id, recipient_user_id, channel, to_address, subject, body, link_path, kind
      ) values (
        ${id}, ${m.companyId}, ${m.userId}, ${target}, ${"sms"}, ${phone},
        ${subject}, ${body}, ${"/dispatch"}, ${"dispatch"}
      )
    `;
    if (hooks?.notify) {
      await hooks.notify({ userId: target, to: phone, body });
      await sql`update outbound_messages set status = ${"skipped"}, error = ${"test"} where id = ${id}`;
    } else if (!sqlIn) {
      try {
        const mailer = await import("./mailer.server.ts");
        await mailer.deliverOutbound(sql, { id, channel: "sms", to: phone, subject, body });
      } catch (cause) {
        console.warn("[dispatch] text failed", cause instanceof Error ? cause.message : "");
      }
    } else {
      await sql`update outbound_messages set status = ${"skipped"}, error = ${"test"} where id = ${id}`;
    }
  }
}
