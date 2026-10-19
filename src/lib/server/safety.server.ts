import { randomUUID } from "node:crypto";
import { getSql, type Sql } from "@/lib/db";
import { assertCan, can } from "@/lib/permissions";
import { member } from "@/lib/server/reports.server";

export type SafetyPerson = {
  userId: string;
  name: string;
  attended: boolean | null;
  attendedOn: string | null;
};

export type SafetyJsa = {
  id: string;
  projectId: string | null;
  projectName: string;
  hazards: string;
  controls: string;
  status: "open" | "approved";
  createdByName: string;
};

export type SafetyInspection = {
  projectId: string;
  projectName: string;
  inspectedOn: string | null;
  daysAgo: number | null;
  overdue: boolean;
  notes: string;
};

export type SafetyCourse = {
  id: string;
  title: string;
  personName: string;
  dueOn: string | null;
  completedOn: string | null;
  overdue: boolean;
};

export type SafetyDesk = {
  day: string;
  orientation: { attended: number; answered: number; total: number };
  dailyJsa: { recorded: boolean; approved: boolean };
  inspection: { current: number; overdue: number };
  training: { inPlace: boolean; overdue: number };
  people: SafetyPerson[];
  jsas: SafetyJsa[];
  inspections: SafetyInspection[];
  courses: SafetyCourse[];
  jobs: { id: string; name: string }[];
  canWrite: boolean;
  canManage: boolean;
  selfId: string;
};

function text(value: unknown): string {
  return value == null ? "" : String(value);
}

function bool(value: unknown): boolean {
  return value === true || value === "t" || value === "true" || value === 1;
}

function dayString(value: unknown): string {
  return text(value).slice(0, 10);
}

function daysAgo(day: string): number {
  const then = Date.parse(`${day.slice(0, 10)}T12:00:00Z`);
  return Number.isNaN(then) ? 999 : Math.floor((Date.now() - then) / 86_400_000);
}

async function desk(sql: Sql, companyId: string, role: string, selfId: string, day: string): Promise<SafetyDesk> {
  const manage = can(role, "safety.manage");
  const peopleRows = await sql<{ user_id: string; name: string; attended: boolean | null; attended_on: string | null }>`
    select p.user_id, p.name, o.attended, o.attended_on::text as attended_on
    from profiles p
    left join safety_orientations o on o.user_id = p.user_id and o.company_id = p.company_id
    where p.company_id = ${companyId}
    order by p.name asc
  `;
  const peopleAll: SafetyPerson[] = peopleRows.map((row) => ({
    userId: text(row.user_id),
    name: text(row.name),
    attended: row.attended == null ? null : bool(row.attended),
    attendedOn: row.attended_on ? dayString(row.attended_on) : null,
  }));
  const jsaRows = await sql<{
    id: string;
    project_id: string | null;
    project_name: string;
    hazards: string;
    controls: string;
    status: string;
    created_by_name: string;
  }>`
    select j.id, j.project_id, coalesce(p.name, '') as project_name, j.hazards, j.controls, j.status,
           coalesce(pr.name, '') as created_by_name
    from job_safety_analyses j
    left join projects p on p.id = j.project_id
    left join profiles pr on pr.user_id = j.created_by and pr.company_id = j.company_id
    where j.company_id = ${companyId} and j.day = ${day}
    order by j.created_at asc
  `;
  const jobs = await sql<{ id: string; name: string }>`
    select id, name from projects where company_id = ${companyId} and archived = false order by name asc
  `;
  const inspectionRows = await sql<{ project_id: string | null; inspected_on: string; notes: string }>`
    select project_id, inspected_on::text as inspected_on, notes
    from safety_inspections
    where company_id = ${companyId}
    order by inspected_on desc
  `;
  const courseRows = await sql<{
    id: string;
    title: string;
    person_name: string;
    due_on: string | null;
    completed_on: string | null;
  }>`
    select t.id, t.title, coalesce(p.name, '') as person_name, t.due_on::text as due_on, t.completed_on::text as completed_on
    from safety_training t
    left join profiles p on p.user_id = t.user_id and p.company_id = t.company_id
    where t.company_id = ${companyId}
    order by t.due_on asc nulls last, t.created_at asc
  `;
  const latest = new Map<string, { on: string; notes: string }>();
  for (const row of inspectionRows) {
    const key = row.project_id ? text(row.project_id) : "";
    if (!latest.has(key)) latest.set(key, { on: dayString(row.inspected_on), notes: text(row.notes) });
  }
  const inspections: SafetyInspection[] = jobs.map((job) => {
    const hit = latest.get(text(job.id));
    const ago = hit ? daysAgo(hit.on) : null;
    return {
      projectId: text(job.id),
      projectName: text(job.name),
      inspectedOn: hit?.on ?? null,
      daysAgo: ago,
      overdue: ago == null || ago > 30,
      notes: hit?.notes ?? "",
    };
  });
  const courses: SafetyCourse[] = courseRows.map((row) => {
    const dueOn = row.due_on ? dayString(row.due_on) : null;
    const completedOn = row.completed_on ? dayString(row.completed_on) : null;
    return {
      id: text(row.id),
      title: text(row.title),
      personName: text(row.person_name),
      dueOn,
      completedOn,
      overdue: Boolean(dueOn && !completedOn && daysAgo(dueOn) > 0),
    };
  });
  const jsas: SafetyJsa[] = jsaRows.map((row) => ({
    id: text(row.id),
    projectId: row.project_id ? text(row.project_id) : null,
    projectName: text(row.project_name) || "No job",
    hazards: text(row.hazards),
    controls: text(row.controls),
    status: row.status === "approved" ? "approved" : "open",
    createdByName: text(row.created_by_name),
  }));
  return {
    day,
    orientation: {
      attended: peopleAll.filter((person) => person.attended === true).length,
      answered: peopleAll.filter((person) => person.attended != null).length,
      total: peopleAll.length,
    },
    dailyJsa: {
      recorded: jsas.length > 0,
      approved: jsas.length > 0 && jsas.every((item) => item.status === "approved"),
    },
    inspection: {
      current: inspections.filter((item) => !item.overdue).length,
      overdue: inspections.filter((item) => item.overdue).length,
    },
    training: {
      inPlace: courses.length > 0,
      overdue: courses.filter((item) => item.overdue).length,
    },
    people: manage ? peopleAll : peopleAll.filter((person) => person.userId === selfId),
    jsas,
    inspections,
    courses,
    jobs: jobs.map((job) => ({ id: text(job.id), name: text(job.name) })),
    canWrite: can(role, "safety.write"),
    canManage: manage,
    selfId,
  };
}

async function openDesk(userId: string, day: string): Promise<{ sql: Sql; companyId: string; role: string; selfId: string; day: string }> {
  const sql = await getSql();
  const me = await member(sql, userId);
  if (!can(me.role, "safety.write") && !can(me.role, "safety.manage")) assertCan(me.role, "safety.write");
  return { sql, companyId: me.companyId, role: me.role, selfId: me.userId, day };
}

export async function getSafety(userId: string, day: string): Promise<SafetyDesk> {
  const opened = await openDesk(userId, day);
  return desk(opened.sql, opened.companyId, opened.role, opened.selfId, day);
}

export async function saveOrientation(
  userId: string,
  input: { day: string; personId: string; attended: boolean; attendedOn: string },
): Promise<SafetyDesk> {
  const opened = await openDesk(userId, input.day);
  if (input.personId !== opened.selfId) assertCan(opened.role, "safety.manage");
  else assertCan(opened.role, "safety.write");
  const person = await opened.sql<{ user_id: string }>`
    select user_id from profiles where user_id = ${input.personId} and company_id = ${opened.companyId}
  `;
  if (!person[0]) throw new Error("That person isn't on this crew.");
  const attendedOn = input.attended && input.attendedOn ? input.attendedOn : null;
  await opened.sql`
    insert into safety_orientations (company_id, user_id, attended, attended_on, updated_by)
    values (${opened.companyId}, ${input.personId}, ${input.attended}, ${attendedOn}, ${opened.selfId})
    on conflict (company_id, user_id) do update
      set attended = excluded.attended, attended_on = excluded.attended_on,
          updated_by = excluded.updated_by, updated_at = now()
  `;
  return desk(opened.sql, opened.companyId, opened.role, opened.selfId, input.day);
}

export async function saveJsa(
  userId: string,
  input: { day: string; projectId: string; hazards: string; controls: string },
): Promise<SafetyDesk> {
  const opened = await openDesk(userId, input.day);
  assertCan(opened.role, "safety.write");
  let projectId: string | null = null;
  if (input.projectId) {
    const job = await opened.sql<{ id: string }>`
      select id from projects where id = ${input.projectId} and company_id = ${opened.companyId}
    `;
    if (!job[0]) throw new Error("That job isn't on this desk.");
    projectId = text(job[0].id);
  }
  const existing = await opened.sql<{ id: string; status: string }>`
    select id, status from job_safety_analyses
    where company_id = ${opened.companyId} and day = ${input.day} and coalesce(project_id, '') = ${projectId ?? ""}
  `;
  const row = existing[0];
  if (row?.status === "approved" && !can(opened.role, "safety.manage")) {
    throw new Error("A lead already approved today's analysis. Ask them to change it.");
  }
  if (row) {
    await opened.sql`
      update job_safety_analyses
      set hazards = ${input.hazards}, controls = ${input.controls}, updated_at = now()
      where id = ${text(row.id)} and company_id = ${opened.companyId}
    `;
  } else {
    await opened.sql`
      insert into job_safety_analyses (id, company_id, project_id, day, hazards, controls, created_by)
      values (${randomUUID()}, ${opened.companyId}, ${projectId}, ${input.day}, ${input.hazards}, ${input.controls}, ${opened.selfId})
    `;
  }
  return desk(opened.sql, opened.companyId, opened.role, opened.selfId, input.day);
}

export async function approveJsa(userId: string, input: { day: string; id: string }): Promise<SafetyDesk> {
  const opened = await openDesk(userId, input.day);
  assertCan(opened.role, "safety.manage");
  const rows = await opened.sql<{ id: string }>`
    select id from job_safety_analyses where id = ${input.id} and company_id = ${opened.companyId}
  `;
  if (!rows[0]) throw new Error("That analysis is gone.");
  await opened.sql`
    update job_safety_analyses
    set status = 'approved', approved_by = ${opened.selfId}, approved_at = coalesce(approved_at, now()), updated_at = now()
    where id = ${input.id} and company_id = ${opened.companyId}
  `;
  return desk(opened.sql, opened.companyId, opened.role, opened.selfId, input.day);
}

export async function recordInspection(
  userId: string,
  input: { day: string; projectId: string; inspectedOn: string; notes: string },
): Promise<SafetyDesk> {
  const opened = await openDesk(userId, input.day);
  assertCan(opened.role, "safety.manage");
  const job = await opened.sql<{ id: string }>`
    select id from projects where id = ${input.projectId} and company_id = ${opened.companyId}
  `;
  if (!job[0]) throw new Error("That job isn't on this desk.");
  await opened.sql`
    insert into safety_inspections (id, company_id, project_id, inspected_on, notes, recorded_by)
    values (${randomUUID()}, ${opened.companyId}, ${text(job[0].id)}, ${input.inspectedOn}, ${input.notes}, ${opened.selfId})
  `;
  return desk(opened.sql, opened.companyId, opened.role, opened.selfId, input.day);
}

export async function addTraining(
  userId: string,
  input: { day: string; title: string; personId: string; dueOn: string },
): Promise<SafetyDesk> {
  const opened = await openDesk(userId, input.day);
  assertCan(opened.role, "safety.manage");
  let personId: string | null = null;
  if (input.personId) {
    const person = await opened.sql<{ user_id: string }>`
      select user_id from profiles where user_id = ${input.personId} and company_id = ${opened.companyId}
    `;
    if (!person[0]) throw new Error("That person isn't on this crew.");
    personId = text(person[0].user_id);
  }
  await opened.sql`
    insert into safety_training (id, company_id, user_id, title, due_on, created_by)
    values (${randomUUID()}, ${opened.companyId}, ${personId}, ${input.title}, ${input.dueOn || null}, ${opened.selfId})
  `;
  return desk(opened.sql, opened.companyId, opened.role, opened.selfId, input.day);
}
