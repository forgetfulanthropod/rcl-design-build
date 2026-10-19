import { randomUUID } from "node:crypto";
import { getSql, type Sql } from "@/lib/db";
import { assertCan, can } from "@/lib/permissions";
import { member } from "@/lib/server/reports.server";
import { activityMayBeCompanyWide, requireJob } from "@/lib/current-job";

export type ActivityCard = {
  id: string;
  day: string;
  title: string;
  detail: string;
  projectId: string | null;
  projectName: string;
  status: "open" | "approved";
  createdByName: string;
  approvedAt: string | null;
};

export type ActivityBoard = {
  day: string;
  activities: ActivityCard[];
  jobs: { id: string; name: string }[];
  canEdit: boolean;
  canApprove: boolean;
};

function text(value: unknown): string {
  return value == null ? "" : String(value);
}

function dayString(value: unknown): string {
  return text(value).slice(0, 10);
}

function iso(value: unknown): string | null {
  if (value == null) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

async function board(sql: Sql, companyId: string, role: string, day: string): Promise<ActivityBoard> {
  const rows = await sql<{
    id: string;
    day: string;
    title: string;
    detail: string;
    project_id: string | null;
    project_name: string;
    status: string;
    created_by_name: string;
    approved_at: unknown;
  }>`
    select a.id, a.day::text as day, a.title, a.detail, a.project_id,
           coalesce(p.name, '') as project_name, a.status,
           coalesce(pr.name, '') as created_by_name, a.approved_at
    from activities a
    left join projects p on p.id = a.project_id
    left join profiles pr on pr.user_id = a.created_by and pr.company_id = a.company_id
    where a.company_id = ${companyId} and a.day = ${day}
    order by a.created_at asc
  `;
  const jobs = await sql<{ id: string; name: string }>`
    select id, name from projects
    where company_id = ${companyId} and archived = false
    order by name asc
  `;
  return {
    day,
    activities: rows.map((row) => ({
      id: text(row.id),
      day: dayString(row.day),
      title: text(row.title),
      detail: text(row.detail),
      projectId: row.project_id ? text(row.project_id) : null,
      projectName: text(row.project_name),
      status: row.status === "approved" ? "approved" : "open",
      createdByName: text(row.created_by_name),
      approvedAt: iso(row.approved_at),
    })),
    jobs: jobs.map((job) => ({ id: text(job.id), name: text(job.name) })),
    canEdit: can(role, "activity.edit"),
    canApprove: can(role, "activity.approve"),
  };
}

async function jobInCompany(sql: Sql, companyId: string, projectId: string): Promise<string | null> {
  if (!projectId) return null;
  const rows = await sql<{ id: string }>`
    select id from projects where id = ${projectId} and company_id = ${companyId}
  `;
  if (!rows[0]) throw new Error("That job isn't on this desk.");
  return text(rows[0].id);
}

export async function listActivities(userId: string, day: string): Promise<ActivityBoard> {
  const sql = await getSql();
  const me = await member(sql, userId);
  if (!can(me.role, "activity.add") && !can(me.role, "activity.approve")) {
    assertCan(me.role, "activity.add");
  }
  return board(sql, me.companyId, me.role, day);
}

export type ActivityOverviewItem = ActivityCard & { approvedByName: string };

export type ActivityOverview = {
  from: string;
  to: string;
  open: number;
  approved: number;
  jobs: { id: string; name: string }[];
  groups: {
    projectId: string | null;
    projectName: string;
    open: number;
    approved: number;
    activities: ActivityOverviewItem[];
  }[];
  canAdd: boolean;
  canEdit: boolean;
  canApprove: boolean;
};

/** Range summary for owners and admins. Grouped by job. */
export async function overviewActivities(
  userId: string,
  input: { from: string; to: string; projectId: string },
): Promise<ActivityOverview> {
  const sql = await getSql();
  const me = await member(sql, userId);
  assertCan(me.role, "report.review");
  const from = input.from <= input.to ? input.from : input.to;
  const to = input.from <= input.to ? input.to : input.from;
  const rows = await sql<{
    id: string;
    day: string;
    title: string;
    detail: string;
    project_id: string | null;
    project_name: string;
    status: string;
    created_by_name: string;
    approved_by_name: string;
    approved_at: unknown;
  }>`
    select a.id, a.day::text as day, a.title, a.detail, a.project_id,
           coalesce(p.name, '') as project_name, a.status,
           coalesce(pr.name, '') as created_by_name,
           coalesce(ap.name, '') as approved_by_name, a.approved_at
    from activities a
    left join projects p on p.id = a.project_id
    left join profiles pr on pr.user_id = a.created_by and pr.company_id = a.company_id
    left join profiles ap on ap.user_id = a.approved_by and ap.company_id = a.company_id
    where a.company_id = ${me.companyId} and a.day between ${from} and ${to}
    order by a.day desc, a.created_at asc
  `;
  const jobs = await sql<{ id: string; name: string }>`
    select id, name from projects
    where company_id = ${me.companyId} and archived = false
    order by name asc
  `;
  const wanted = input.projectId;
  const items: ActivityOverviewItem[] = rows
    .filter((row) => !wanted || text(row.project_id) === wanted)
    .map((row) => ({
      id: text(row.id),
      day: dayString(row.day),
      title: text(row.title),
      detail: text(row.detail),
      projectId: row.project_id ? text(row.project_id) : null,
      projectName: text(row.project_name) || "No job",
      status: row.status === "approved" ? "approved" : "open",
      createdByName: text(row.created_by_name),
      approvedByName: text(row.approved_by_name),
      approvedAt: iso(row.approved_at),
    }));
  const groups = new Map<string, ActivityOverview["groups"][number]>();
  for (const item of items) {
    const key = item.projectId ?? "";
    const group = groups.get(key) ?? {
      projectId: item.projectId,
      projectName: item.projectName,
      open: 0,
      approved: 0,
      activities: [],
    };
    group.activities.push(item);
    if (item.status === "approved") group.approved += 1;
    else group.open += 1;
    groups.set(key, group);
  }
  return {
    from,
    to,
    open: items.filter((item) => item.status === "open").length,
    approved: items.filter((item) => item.status === "approved").length,
    jobs: jobs.map((job) => ({ id: text(job.id), name: text(job.name) })),
    groups: [...groups.values()].sort((a, b) => b.open - a.open || a.projectName.localeCompare(b.projectName)),
    canAdd: can(me.role, "activity.add"),
    canEdit: can(me.role, "activity.edit"),
    canApprove: can(me.role, "activity.approve"),
  };
}

export async function createActivity(
  userId: string,
  input: { day: string; title: string; detail: string; projectId: string },
): Promise<ActivityBoard> {
  const sql = await getSql();
  const me = await member(sql, userId);
  assertCan(me.role, "activity.add");
  const projectId = await jobInCompany(sql, me.companyId, input.projectId);
  requireJob(projectId, activityMayBeCompanyWide(me.role));
  await sql`
    insert into activities (id, company_id, project_id, day, title, detail, created_by, updated_by)
    values (
      ${randomUUID()}, ${me.companyId}, ${projectId}, ${input.day}, ${input.title}, ${input.detail},
      ${me.userId}, ${me.userId}
    )
  `;
  return board(sql, me.companyId, me.role, input.day);
}

export async function updateActivity(
  userId: string,
  input: { id: string; title: string; detail: string; projectId: string },
): Promise<ActivityBoard> {
  const sql = await getSql();
  const me = await member(sql, userId);
  assertCan(me.role, "activity.edit");
  const rows = await sql<{ day: string; status: string }>`
    select day::text as day, status from activities where id = ${input.id} and company_id = ${me.companyId}
  `;
  const row = rows[0];
  if (!row) throw new Error("That activity is gone.");
  if (row.status === "approved" && !can(me.role, "activity.approve")) {
    throw new Error("A lead already approved this. Ask them to change it.");
  }
  const projectId = await jobInCompany(sql, me.companyId, input.projectId);
  requireJob(projectId, activityMayBeCompanyWide(me.role));
  await sql`
    update activities
    set title = ${input.title}, detail = ${input.detail}, project_id = ${projectId},
        updated_by = ${me.userId}, updated_at = now()
    where id = ${input.id} and company_id = ${me.companyId}
  `;
  return board(sql, me.companyId, me.role, dayString(row.day));
}

export async function approveActivity(userId: string, id: string): Promise<ActivityBoard> {
  const sql = await getSql();
  const me = await member(sql, userId);
  assertCan(me.role, "activity.approve");
  const rows = await sql<{ day: string }>`
    select day::text as day from activities where id = ${id} and company_id = ${me.companyId}
  `;
  const row = rows[0];
  if (!row) throw new Error("That activity is gone.");
  await sql`
    update activities
    set status = 'approved', approved_by = ${me.userId}, approved_at = coalesce(approved_at, now()), updated_at = now()
    where id = ${id} and company_id = ${me.companyId}
  `;
  return board(sql, me.companyId, me.role, dayString(row.day));
}
