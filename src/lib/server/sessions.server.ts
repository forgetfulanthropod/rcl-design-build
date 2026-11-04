/**
 * Work sessions (hours on a job). Own rows for anyone who logs a day; a lead can read the
 * crew's sessions; only an owner or admin can change someone else's. Nothing here is shared
 * outside the company, and a session never carries money.
 * The activity log no longer has an add button. These rows stay, and they are still what
 * paints the green hours on a signed-in daily report.
 *
 * Relative imports so the PGLite tests can load this under node:test.
 * Every exported function takes an optional `sql`; the app passes none.
 */
import { randomUUID } from "node:crypto";
import type { Sql } from "../db.ts";
import { assertCan, can, ForbiddenError } from "../permissions.ts";
import { normalizeSession, type WorkSession } from "../work-sessions.ts";

export { ForbiddenError };

async function db(sql?: Sql): Promise<Sql> {
  if (sql) return sql;
  const { getSql } = await import("../db.ts");
  return getSql();
}

type Me = { userId: string; companyId: string; role: string; name: string };

async function member(sql: Sql, userId: string): Promise<Me> {
  const rows = await sql<{ company_id: string; role: string; name: string }>`
    select company_id, role, name from profiles where user_id = ${userId}
  `;
  if (!rows[0]) throw new Error("Finish company setup first.");
  return { userId, companyId: String(rows[0].company_id), role: String(rows[0].role), name: String(rows[0].name) };
}

function isDay(day: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(day) && !Number.isNaN(Date.parse(`${day}T12:00:00Z`));
}

/** Writes stay on (about) today, same window as a daily report. Reads can be any real day. */
function writableDay(day: string): string {
  if (!isDay(day)) throw new Error("Pick a day.");
  if (Math.abs(Date.parse(`${day}T12:00:00Z`) - Date.now()) > 36 * 3_600_000) {
    throw new Error("You can only log hours for today.");
  }
  return day;
}

type Row = {
  id: string;
  user_id: string;
  user_name: string;
  project_id: string | null;
  project_name: string | null;
  day: string | Date;
  start_min: number;
  end_min: number;
  notes: string;
};

const SELECT = `
  select s.id, s.user_id, pr.name as user_name, s.project_id, p.name as project_name,
         s.day, s.start_min, s.end_min, s.notes
  from work_sessions s
  join profiles pr on pr.user_id = s.user_id
  left join projects p on p.id = s.project_id
`;

function mapRow(row: Row): WorkSession {
  return {
    id: row.id,
    day: String(row.day).slice(0, 10),
    userId: row.user_id,
    userName: row.user_name,
    projectId: row.project_id,
    projectName: row.project_name?.trim() || "Untitled",
    startMin: Number(row.start_min),
    endMin: Number(row.end_min),
    notes: row.notes ?? "",
  };
}

export type SessionScope = "mine" | "company";

/**
 * `mine` is the caller's own sessions (or `personId` when the caller may review).
 * `company` is everyone in the company that day — leads and up only.
 */
export async function listSessions(
  userId: string,
  input: { day: string; scope: SessionScope; personId?: string },
  sql?: Sql,
): Promise<WorkSession[]> {
  if (!isDay(input.day)) throw new Error("Pick a day.");
  const database = await db(sql);
  const me = await member(database, userId);
  const personId = input.personId?.trim() ?? "";
  const other = Boolean(personId) && personId !== me.userId;
  if (input.scope === "company" || other) assertCan(me.role, "session.review");
  else if (!can(me.role, "session.write") && !can(me.role, "session.review")) assertCan(me.role, "session.write");
  const target = input.scope === "company" && !personId ? null : personId || me.userId;
  const params: unknown[] = [me.companyId, input.day];
  let where = "s.company_id = $1 and s.day = $2";
  if (target) {
    params.push(target);
    where += ` and s.user_id = $${params.length}`;
  }
  const rows = await database.query<Row>(`${SELECT} where ${where} order by s.start_min asc, s.id asc`, params);
  return rows.map(mapRow);
}

async function projectInCompany(sql: Sql, companyId: string, projectId: string): Promise<{ id: string; name: string } | null> {
  const rows = await sql<{ id: string; name: string }>`
    select id, name from projects where id = ${projectId} and company_id = ${companyId} and archived = false
  `;
  return rows[0] ?? null;
}

export async function createSession(
  userId: string,
  input: { day: string; projectId: string; startMin: number; endMin: number; notes: string },
  sql?: Sql,
): Promise<WorkSession> {
  const day = writableDay(input.day);
  const database = await db(sql);
  const me = await member(database, userId);
  assertCan(me.role, "session.write");
  const project = await projectInCompany(database, me.companyId, input.projectId.trim());
  if (!project) throw new Error("Choose a project on this company.");
  const draft = normalizeSession({ startMin: input.startMin, endMin: input.endMin, notes: input.notes, projectName: project.name });
  if (!draft.ok) throw new Error(draft.error);
  const id = randomUUID();
  await database`
    insert into work_sessions (id, company_id, user_id, project_id, day, start_min, end_min, notes)
    values (${id}, ${me.companyId}, ${me.userId}, ${project.id}, ${day}, ${draft.value.startMin}, ${draft.value.endMin}, ${draft.value.notes})
  `;
  const [row] = await database.query<Row>(`${SELECT} where s.id = $1`, [id]);
  return mapRow(row);
}

async function editableRow(sql: Sql, me: Me, id: string): Promise<Row> {
  const rows = await sql.query<Row>(`${SELECT} where s.id = $1 and s.company_id = $2`, [id, me.companyId]);
  const row = rows[0];
  if (!row) throw new Error("Session not found.");
  if (row.user_id === me.userId) assertCan(me.role, "session.write");
  else assertCan(me.role, "session.manage");
  writableDay(String(row.day).slice(0, 10));
  return row;
}

export async function updateSession(
  userId: string,
  input: { id: string; projectId: string; startMin: number; endMin: number; notes: string },
  sql?: Sql,
): Promise<WorkSession> {
  const database = await db(sql);
  const me = await member(database, userId);
  const current = await editableRow(database, me, input.id.trim());
  const project = await projectInCompany(database, me.companyId, input.projectId.trim());
  if (!project) throw new Error("Choose a project on this company.");
  const draft = normalizeSession({ startMin: input.startMin, endMin: input.endMin, notes: input.notes, projectName: project.name });
  if (!draft.ok) throw new Error(draft.error);
  await database`
    update work_sessions
    set project_id = ${project.id}, start_min = ${draft.value.startMin}, end_min = ${draft.value.endMin},
        notes = ${draft.value.notes}, updated_at = now()
    where id = ${current.id} and company_id = ${me.companyId}
  `;
  const [row] = await database.query<Row>(`${SELECT} where s.id = $1`, [current.id]);
  return mapRow(row);
}

export async function deleteSession(userId: string, id: string, sql?: Sql): Promise<{ ok: true }> {
  const database = await db(sql);
  const me = await member(database, userId);
  const current = await editableRow(database, me, id.trim());
  await database`delete from work_sessions where id = ${current.id} and company_id = ${me.companyId}`;
  return { ok: true };
}
