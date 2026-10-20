/**
 * Sharing settings and the per-job sharing review (spec 06 rev 3).
 *
 * - Company defaults plus per-project overrides (null = inherit). Owner, Admin and superadmin only.
 * - Every job starts flagged "Sharing review needed" and runs on company defaults until an
 *   Owner/Admin/superadmin marks THAT job reviewed. There is deliberately no bulk review here.
 * - Every write and its sharing_audit row go in ONE statement (data-modifying CTE), so they
 *   commit together or not at all.
 *
 * Relative imports (not "@/") so the PGLite server tests can load this file under node:test.
 * Every exported function takes an optional `sql` for those tests; the app passes none.
 */
import { randomUUID } from "node:crypto";
import type { Sql } from "../db.ts";
import { assertCan, can, ForbiddenError } from "../permissions.ts";
import {
  SHARING_KEYS,
  companySharing,
  effectiveSnapshot,
  isSharingKey,
  overrideText,
  resolveSharing,
  snapshotAfterReview,
  snapshotHash,
  type EffectiveSnapshot,
  type ProjectSharing,
  type ReviewStatus,
  type Sharing,
  type SharingKey,
} from "../sharing.ts";

export { ForbiddenError };

export const NOT_FOUND = "Not found";
export const STALE_REVIEW = "Settings changed since you opened this. Check them again.";

type Me = { userId: string; companyId: string; role: string; name: string };

const text = (value: unknown) => (value == null ? "" : String(value));
const iso = (value: unknown) => (value instanceof Date ? value.toISOString() : value ? new Date(String(value)).toISOString() : "");
const bool = (value: unknown): boolean | null => (value === null || value === undefined ? null : value === true || value === "t" || value === "true");

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
  return { userId, companyId: text(rows[0].company_id), role: text(rows[0].role), name: text(rows[0].name) };
}

// ---------------------------------------------------------------- reads (no permission: used by enforcement)

/** The company's settings; a missing row is the coded default (all Off). */
export async function companySettings(sql: Sql, companyId: string): Promise<Sharing> {
  const rows = await sql<Record<SharingKey, boolean>>`
    select lead_budget_dollars, labor_doc_send from company_settings where company_id = ${companyId}
  `;
  return companySharing(rows[0] ?? null);
}

type ProjectRow = {
  project_id: string;
  sharing_review_status: string | null;
} & Record<SharingKey, boolean | null>;

function projectSharing(row: ProjectRow | undefined): ProjectSharing {
  // A project with no settings row is treated as never reviewed (company defaults).
  if (!row || row.sharing_review_status !== "reviewed") {
    return { review: "needed", values: Object.fromEntries(SHARING_KEYS.map((k) => [k, row ? bool(row[k]) : null])) };
  }
  return { review: "reviewed", values: Object.fromEntries(SHARING_KEYS.map((k) => [k, bool(row[k])])) };
}

/** Effective settings for one project (or the company, for documents with no job). */
export async function sharingFor(sql: Sql, companyId: string, projectId: string | null): Promise<Sharing> {
  const company = await companySettings(sql, companyId);
  if (!projectId) return company;
  const rows = await sql<ProjectRow>`
    select project_id, sharing_review_status, lead_budget_dollars, labor_doc_send
    from project_settings where project_id = ${projectId} and company_id = ${companyId}
  `;
  return resolveSharing(company, projectSharing(rows[0]));
}

/** Effective settings for many projects in one query (no N+1). Key "" is the company value. */
export async function sharingForProjects(sql: Sql, companyId: string, projectIds: string[]): Promise<Map<string, Sharing>> {
  const company = await companySettings(sql, companyId);
  const out = new Map<string, Sharing>([["", company]]);
  const ids = [...new Set(projectIds.filter(Boolean))];
  if (ids.length === 0) return out;
  const rows = await sql.query<ProjectRow>(
    `select project_id, sharing_review_status, lead_budget_dollars, labor_doc_send
     from project_settings where company_id = $1 and project_id = any($2::text[])`,
    [companyId, ids],
  );
  const byId = new Map(rows.map((row) => [text(row.project_id), row]));
  for (const id of ids) out.set(id, resolveSharing(company, projectSharing(byId.get(id))));
  return out;
}

/** Number of jobs waiting for a sharing review (header badge). Owner/Admin/superadmin only; 0 otherwise. */
export async function reviewCount(userId: string, sqlIn?: Sql): Promise<number> {
  const sql = await db(sqlIn);
  const m = await me(sql, userId);
  if (!can(m.role, "settings.sharing.view")) return 0;
  const rows = await sql<{ n: number }>`
    select count(*)::int as n from project_settings ps join projects p on p.id = ps.project_id
    where ps.company_id = ${m.companyId} and ps.sharing_review_status = 'needed'
  `;
  return Number(rows[0]?.n ?? 0);
}

// ---------------------------------------------------------------- project creation

/**
 * The one way to create a project: the project row and its 'needed' sharing row go in one
 * statement, so no job ever exists without the review flag (spec 06).
 */
export async function insertProject(
  sql: Sql,
  input: { id?: string; companyId: string; name: string; clientName: string; address: string; phase: string; contractValue: number; summary: string },
  createdBy: string,
): Promise<string> {
  const id = input.id ?? randomUUID();
  await sql`
    with p as (
      insert into projects (id, company_id, name, client_name, address, phase, contract_value, summary)
      values (${id}, ${input.companyId}, ${input.name}, ${input.clientName}, ${input.address}, ${input.phase},
              ${Math.round(input.contractValue)}, ${input.summary})
      returning id, company_id
    )
    insert into project_settings (project_id, company_id, sharing_review_status, review_requested_by)
    select id, company_id, 'needed', ${createdBy} from p
  `;
  return id;
}

// ---------------------------------------------------------------- settings screens

export type SharingProject = {
  id: string;
  name: string;
  phase: string;
  archived: boolean;
  review: ReviewStatus;
  values: Record<SharingKey, boolean | null>;
  effective: EffectiveSnapshot;
  afterReview: EffectiveSnapshot;
  requestedBy: string;
  requestedAt: string;
  reviewedBy: string;
  reviewedAt: string;
};

export type SharingOverview = {
  company: Sharing;
  projects: SharingProject[];
  queue: SharingProject[];
  canEdit: boolean;
};

function personName(id: string, names: Map<string, string>): string {
  if (id.startsWith("migration:")) return `Migration ${id.slice("migration:".length)}`;
  return names.get(id) || (id ? "Someone" : "");
}

async function namesFor(sql: Sql, companyId: string): Promise<Map<string, string>> {
  const rows = await sql<{ user_id: string; name: string }>`select user_id, name from profiles where company_id = ${companyId}`;
  return new Map(rows.map((row) => [text(row.user_id), text(row.name)]));
}

async function loadProjects(sql: Sql, companyId: string, company: Sharing, projectId?: string): Promise<SharingProject[]> {
  const rows = await sql.query<
    ProjectRow & {
      id: string;
      name: string;
      phase: string;
      archived: boolean;
      review_requested_by: string | null;
      review_requested_at: unknown;
      reviewed_by: string | null;
      reviewed_at: unknown;
    }
  >(
    `select p.id, p.name, p.phase, p.archived, ps.project_id, ps.sharing_review_status,
            ps.lead_budget_dollars, ps.labor_doc_send, ps.review_requested_by, ps.review_requested_at,
            ps.reviewed_by, ps.reviewed_at
     from projects p left join project_settings ps on ps.project_id = p.id
     where p.company_id = $1 ${projectId ? "and p.id = $2" : ""}
     order by p.archived, p.created_at, p.name`,
    projectId ? [companyId, projectId] : [companyId],
  );
  const names = await namesFor(sql, companyId);
  return rows.map((row) => {
    const sharing = projectSharing(row.project_id ? row : undefined);
    return {
      id: text(row.id),
      name: text(row.name),
      phase: text(row.phase),
      archived: row.archived === true,
      review: sharing.review,
      values: Object.fromEntries(SHARING_KEYS.map((k) => [k, bool(row[k])])) as Record<SharingKey, boolean | null>,
      effective: effectiveSnapshot(company, sharing),
      afterReview: snapshotAfterReview(company, sharing.values),
      requestedBy: personName(text(row.review_requested_by), names),
      requestedAt: iso(row.review_requested_at),
      reviewedBy: personName(text(row.reviewed_by), names),
      reviewedAt: iso(row.reviewed_at),
    };
  });
}

export async function getSharingOverview(userId: string, sqlIn?: Sql): Promise<SharingOverview> {
  const sql = await db(sqlIn);
  const m = await me(sql, userId);
  assertCan(m.role, "settings.sharing.view");
  const company = await companySettings(sql, m.companyId);
  const projects = await loadProjects(sql, m.companyId, company);
  return { company, projects, queue: projects.filter((p) => p.review === "needed"), canEdit: can(m.role, "settings.sharing.edit") };
}

export async function getSharingProject(userId: string, input: { projectId: string }, sqlIn?: Sql) {
  const sql = await db(sqlIn);
  const m = await me(sql, userId);
  assertCan(m.role, "settings.sharing.view");
  const company = await companySettings(sql, m.companyId);
  const [project] = await loadProjects(sql, m.companyId, company, input.projectId);
  if (!project) throw new Error(NOT_FOUND);
  const audit = await listAudit(userId, { projectId: project.id }, sql);
  return { company, project, audit, canEdit: can(m.role, "settings.sharing.edit"), canReview: can(m.role, "project.sharingReview") };
}

/** The live review queue: Attention's pinned section and Settings → Projects. Never sent to the model. */
export async function listReviewQueue(userId: string, sqlIn?: Sql) {
  const sql = await db(sqlIn);
  const m = await me(sql, userId);
  assertCan(m.role, "settings.sharing.view");
  const company = await companySettings(sql, m.companyId);
  return (await loadProjects(sql, m.companyId, company))
    .filter((p) => p.review === "needed")
    .map((p) => ({ id: p.id, name: p.name, archived: p.archived, requestedBy: p.requestedBy, requestedAt: p.requestedAt }));
}

// ---------------------------------------------------------------- writes (each with its audit row, atomically)

function noteArg(note: unknown): string {
  return text(note).trim().slice(0, 500);
}

export async function setCompanySetting(
  userId: string,
  input: { key: string; value: boolean; note?: string },
  sqlIn?: Sql,
): Promise<Sharing> {
  const sql = await db(sqlIn);
  const m = await me(sql, userId);
  assertCan(m.role, "settings.sharing.edit");
  if (!isSharingKey(input.key)) throw new Error("Unknown setting.");
  if (typeof input.value !== "boolean") throw new Error("Pick On or Off.");
  const key = input.key; // whitelisted column name
  const before = await companySettings(sql, m.companyId);
  if (before[key] === input.value) return before; // no change, no audit row
  await sql.query(
    `with up as (
       insert into company_settings (company_id, ${key}, updated_by, updated_at) values ($1, $2, $3, now())
       on conflict (company_id) do update set ${key} = excluded.${key}, updated_by = excluded.updated_by, updated_at = now()
       returning company_id
     )
     insert into sharing_audit (id, company_id, project_id, setting_key, old_value, new_value, changed_by, changed_role, note)
     select $4, company_id, null, $5, $6, $7, $3, $8, $9 from up`,
    [m.companyId, input.value, m.userId, randomUUID(), key, String(before[key]), String(input.value), m.role, noteArg(input.note)],
  );
  return companySettings(sql, m.companyId);
}

async function ownProject(sql: Sql, companyId: string, projectId: string): Promise<void> {
  const rows = await sql<{ id: string }>`select id from projects where id = ${projectId} and company_id = ${companyId}`;
  if (!rows[0]) throw new Error(NOT_FOUND);
  // Older rows (before 0014 ran, or created outside insertProject) get their 'needed' flag now.
  await sql`
    insert into project_settings (project_id, company_id, sharing_review_status, review_requested_by)
    values (${projectId}, ${companyId}, 'needed', 'system') on conflict (project_id) do nothing
  `;
}

/** Per-job override (null = use the company default). While the job is in review it applies only after "Mark reviewed". */
export async function setProjectSetting(
  userId: string,
  input: { projectId: string; key: string; value: boolean | null; note?: string },
  sqlIn?: Sql,
) {
  const sql = await db(sqlIn);
  const m = await me(sql, userId);
  assertCan(m.role, "settings.sharing.edit");
  if (!isSharingKey(input.key)) throw new Error("Unknown setting.");
  if (input.value !== null && typeof input.value !== "boolean") throw new Error("Pick On, Off or the company default.");
  const key = input.key;
  await ownProject(sql, m.companyId, input.projectId);
  const rows = await sql.query<Record<string, boolean | null>>(
    `select ${key} as v from project_settings where project_id = $1 and company_id = $2`,
    [input.projectId, m.companyId],
  );
  const before = bool(rows[0]?.v);
  if (before !== input.value) {
    await sql.query(
      `with up as (
         update project_settings set ${key} = $3, updated_by = $4, updated_at = now()
         where project_id = $1 and company_id = $2 returning project_id, company_id
       )
       insert into sharing_audit (id, company_id, project_id, setting_key, old_value, new_value, changed_by, changed_role, note)
       select $5, company_id, project_id, $6, $7, $8, $4, $9, $10 from up`,
      [input.projectId, m.companyId, input.value, m.userId, randomUUID(), key, overrideText(before), overrideText(input.value), m.role, noteArg(input.note)],
    );
  }
  return getSharingProject(userId, { projectId: input.projectId }, sql);
}

export type ReviewPreview = { projectId: string; name: string; status: ReviewStatus; snapshot: EffectiveSnapshot; hash: string };

async function previewOf(sql: Sql, m: Me, projectId: string): Promise<ReviewPreview & { values: Record<SharingKey, boolean | null>; company: Sharing; reviewedBy: string; reviewedAt: string }> {
  await ownProject(sql, m.companyId, projectId);
  const company = await companySettings(sql, m.companyId);
  const rows = await sql<ProjectRow & { name: string; reviewed_by: string | null; reviewed_at: unknown }>`
    select p.name, ps.project_id, ps.sharing_review_status, ps.lead_budget_dollars, ps.labor_doc_send, ps.reviewed_by, ps.reviewed_at
    from projects p join project_settings ps on ps.project_id = p.id
    where p.id = ${projectId} and p.company_id = ${m.companyId}
  `;
  const row = rows[0];
  if (!row) throw new Error(NOT_FOUND);
  const values = Object.fromEntries(SHARING_KEYS.map((k) => [k, bool(row[k])])) as Record<SharingKey, boolean | null>;
  const snapshot = snapshotAfterReview(company, values);
  return {
    projectId,
    name: text(row.name),
    status: row.sharing_review_status === "reviewed" ? "reviewed" : "needed",
    snapshot,
    hash: snapshotHash(snapshot),
    values,
    company,
    reviewedBy: text(row.reviewed_by),
    reviewedAt: iso(row.reviewed_at),
  };
}

/** What "Mark reviewed" will approve: the job's effective settings after review, plus their hash. */
export async function getReviewPreview(userId: string, input: { projectId: string }, sqlIn?: Sql): Promise<ReviewPreview> {
  const sql = await db(sqlIn);
  const m = await me(sql, userId);
  assertCan(m.role, "project.sharingReview");
  const { projectId, name, status, snapshot, hash } = await previewOf(sql, m, input.projectId);
  return { projectId, name, status, snapshot, hash };
}

export type MarkReviewedResult = {
  projectId: string;
  status: "reviewed";
  reviewedBy: string;
  reviewedAt: string;
  snapshot: EffectiveSnapshot;
  alreadyReviewed: boolean;
};

/**
 * Clears the sharing-review flag on ONE job. Idempotent (a repeat writes nothing), rejects a
 * stale confirm, and writes one 'review' audit row carrying the effective-settings snapshot.
 */
export async function markProjectReviewed(
  userId: string,
  input: { projectId: string; expectedSnapshotHash?: string },
  sqlIn?: Sql,
): Promise<MarkReviewedResult> {
  const sql = await db(sqlIn);
  const m = await me(sql, userId);
  assertCan(m.role, "project.sharingReview");
  const preview = await previewOf(sql, m, text(input.projectId));
  if (input.expectedSnapshotHash && input.expectedSnapshotHash !== preview.hash) throw new Error(STALE_REVIEW);
  if (preview.status === "reviewed") {
    return { projectId: preview.projectId, status: "reviewed", reviewedBy: preview.reviewedBy, reviewedAt: preview.reviewedAt, snapshot: preview.snapshot, alreadyReviewed: true };
  }
  // Update only this row, and only if nothing changed since the snapshot was taken (the
  // conditional update is the lock). The audit insert reads the update's result, so both
  // land together or neither does.
  const overrideChecks = SHARING_KEYS.map((k, i) => `and ps.${k} is not distinct from $${4 + i}`).join(" ");
  const base = 4 + SHARING_KEYS.length;
  const companyChecks = SHARING_KEYS.map((k, i) => `and coalesce((select cs.${k} from company_settings cs where cs.company_id = $2), false) = $${base + i}`).join(" ");
  const next = base + SHARING_KEYS.length;
  const done = await sql.query<{ reviewed_at: unknown }>(
    `with upd as (
       update project_settings ps
       set sharing_review_status = 'reviewed', reviewed_by = $3, reviewed_at = now(), updated_at = now()
       where ps.project_id = $1 and ps.company_id = $2 and ps.sharing_review_status = 'needed'
       ${overrideChecks} ${companyChecks}
       returning ps.project_id, ps.company_id, ps.reviewed_at
     ), audit as (
       insert into sharing_audit (id, company_id, project_id, setting_key, old_value, new_value, snapshot, changed_by, changed_role, note)
       select $${next}, company_id, project_id, 'review', 'needed', 'reviewed', $${next + 1}::jsonb, $3, $${next + 2}, '' from upd
       returning id
     )
     select reviewed_at from upd`,
    [
      preview.projectId,
      m.companyId,
      m.userId,
      ...SHARING_KEYS.map((k) => preview.values[k]),
      ...SHARING_KEYS.map((k) => preview.company[k]),
      randomUUID(),
      JSON.stringify(preview.snapshot),
      m.role,
    ],
  );
  if (!done[0]) {
    const now = await previewOf(sql, m, preview.projectId);
    if (now.status === "reviewed") {
      return { projectId: now.projectId, status: "reviewed", reviewedBy: now.reviewedBy, reviewedAt: now.reviewedAt, snapshot: now.snapshot, alreadyReviewed: true };
    }
    throw new Error(STALE_REVIEW);
  }
  return { projectId: preview.projectId, status: "reviewed", reviewedBy: m.userId, reviewedAt: iso(done[0].reviewed_at), snapshot: preview.snapshot, alreadyReviewed: false };
}

/** "Request review again" on one job: reviewed → needed, with an audit row. */
export async function requestReviewAgain(userId: string, input: { projectId: string; note?: string }, sqlIn?: Sql) {
  const sql = await db(sqlIn);
  const m = await me(sql, userId);
  assertCan(m.role, "project.sharingReview");
  await ownProject(sql, m.companyId, input.projectId);
  await sql.query(
    `with upd as (
       update project_settings set sharing_review_status = 'needed', review_requested_at = now(), review_requested_by = $3,
              reviewed_by = null, reviewed_at = null, updated_at = now()
       where project_id = $1 and company_id = $2 and sharing_review_status = 'reviewed'
       returning project_id, company_id
     )
     insert into sharing_audit (id, company_id, project_id, setting_key, old_value, new_value, changed_by, changed_role, note)
     select $4, company_id, project_id, 'review', 'reviewed', 'needed', $3, $5, $6 from upd`,
    [input.projectId, m.companyId, m.userId, randomUUID(), m.role, noteArg(input.note)],
  );
  return getSharingProject(userId, { projectId: input.projectId }, sql);
}

// ---------------------------------------------------------------- change log (read-only)

export type AuditRow = {
  id: string;
  at: string;
  who: string;
  whoId: string;
  role: string;
  scope: string;
  projectId: string | null;
  key: string;
  oldValue: string;
  newValue: string;
  note: string;
  snapshot: EffectiveSnapshot | null;
};

export async function listAudit(
  userId: string,
  filters: { projectId?: string; scope?: string; key?: string; person?: string } = {},
  sqlIn?: Sql,
): Promise<AuditRow[]> {
  const sql = await db(sqlIn);
  const m = await me(sql, userId);
  assertCan(m.role, "settings.sharing.view");
  const where = ["a.company_id = $1"];
  const params: unknown[] = [m.companyId];
  const projectId = filters.projectId || (filters.scope && filters.scope !== "company" ? filters.scope : "");
  if (projectId) {
    params.push(projectId);
    where.push(`a.project_id = $${params.length}`);
  } else if (filters.scope === "company") {
    where.push("a.project_id is null");
  }
  if (filters.key) {
    params.push(filters.key);
    where.push(`a.setting_key = $${params.length}`);
  }
  if (filters.person) {
    params.push(filters.person);
    where.push(`a.changed_by = $${params.length}`);
  }
  const rows = await sql.query<{
    id: string;
    created_at: unknown;
    changed_by: string;
    changed_role: string;
    who: string | null;
    project_id: string | null;
    project_name: string | null;
    setting_key: string;
    old_value: string | null;
    new_value: string | null;
    note: string;
    snapshot: unknown;
  }>(
    `select a.id, a.created_at, a.changed_by, a.changed_role, pr.name as who, a.project_id, p.name as project_name,
            a.setting_key, a.old_value, a.new_value, a.note, a.snapshot
     from sharing_audit a
     left join profiles pr on pr.user_id = a.changed_by
     left join projects p on p.id = a.project_id
     where ${where.join(" and ")}
     order by a.created_at desc, a.id desc limit 500`,
    params,
  );
  return rows.map((row) => ({
    id: text(row.id),
    at: iso(row.created_at),
    who: text(row.who) || "Someone",
    whoId: text(row.changed_by),
    role: text(row.changed_role),
    scope: row.project_id ? text(row.project_name) || "Deleted job" : "Company",
    projectId: row.project_id ? text(row.project_id) : null,
    key: text(row.setting_key),
    oldValue: text(row.old_value),
    newValue: text(row.new_value),
    note: text(row.note),
    snapshot: row.snapshot ? ((typeof row.snapshot === "string" ? JSON.parse(row.snapshot) : row.snapshot) as EffectiveSnapshot) : null,
  }));
}
