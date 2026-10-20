import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import type { Sql } from "../db.ts";
import { assertCanWith } from "../permissions.ts";
import { snapshotAfterReview } from "../sharing.ts";
import { applyMigrations, freshDb, sqlFor } from "./pglite-test-db.ts";
import * as sharing from "./sharing.server.ts";

// Spec 06 rev 3 · server tests against a real (in-memory) Postgres with every migration applied.
let pg: PGlite;
let sql: Sql;

before(async () => {
  ({ pg, sql } = await freshDb());
});
after(async () => {
  await pg.close();
});

const ROLES = ["owner", "admin", "superadmin", "lead", "labor", "sub"] as const;
type Co = { companyId: string; users: Record<(typeof ROLES)[number], string>; jobs: string[] };

/** A company with one person per role and three jobs created the normal way (insertProject). */
async function company(jobs = 3): Promise<Co> {
  const companyId = randomUUID();
  await sql`insert into companies (id, name) values (${companyId}, ${"Co " + companyId.slice(0, 4)})`;
  const users = {} as Co["users"];
  for (const role of ROLES) {
    const id = randomUUID();
    users[role] = id;
    await sql`insert into profiles (user_id, company_id, name, role) values (${id}, ${companyId}, ${role + " person"}, ${role})`;
  }
  const ids: string[] = [];
  for (let i = 0; i < jobs; i += 1) {
    ids.push(
      await sharing.insertProject(
        sql,
        { companyId, name: `Job ${"ABC"[i] ?? i}`, clientName: "Client", address: "1 Main", phase: "Build", contractValue: 1000, summary: "" },
        users.lead,
      ),
    );
  }
  return { companyId, users, jobs: ids };
}

const auditRows = async (companyId: string) =>
  sql<{ setting_key: string; project_id: string | null; old_value: string; new_value: string; changed_by: string; changed_role: string; snapshot: unknown; created_at: unknown }>`
    select * from sharing_audit where company_id = ${companyId} order by created_at
  `;
const status = async (projectId: string) =>
  (await sql<{ s: string }>`select sharing_review_status as s from project_settings where project_id = ${projectId}`)[0]?.s;
const needed = async (companyId: string) =>
  Number((await sql<{ n: number }>`select count(*)::int as n from project_settings where company_id = ${companyId} and sharing_review_status = 'needed'`)[0].n);

/** The server's doc.send rule for a job, exactly as sendDocument applies it. */
async function laborMaySend(co: Co, projectId: string | null) {
  try {
    assertCanWith("labor", "doc.send", await sharing.sharingFor(sql, co.companyId, projectId));
    return true;
  } catch (error) {
    assert.equal((error as Error).name, "ForbiddenError");
    return false;
  }
}

test("createProject path: every new job gets a 'needed' row, requested by its creator", async () => {
  const co = await company(2);
  const rows = await sql<{ s: string; by: string }>`
    select sharing_review_status as s, review_requested_by as by from project_settings where company_id = ${co.companyId}
  `;
  assert.equal(rows.length, 2);
  for (const row of rows) assert.deepEqual(row, { s: "needed", by: co.users.lead });
});

test("markProjectReviewed: Lead, Labor and Sub are refused; the flag stays and no audit row is written", async () => {
  const co = await company(1);
  for (const role of ["lead", "labor", "sub"] as const) {
    await assert.rejects(sharing.markProjectReviewed(co.users[role], { projectId: co.jobs[0] }, sql), { name: "ForbiddenError" });
    await assert.rejects(sharing.getReviewPreview(co.users[role], { projectId: co.jobs[0] }, sql), { name: "ForbiddenError" });
  }
  assert.equal(await status(co.jobs[0]), "needed");
  assert.equal((await auditRows(co.companyId)).length, 0);
});

test("markProjectReviewed: Owner, Admin and superadmin succeed", async () => {
  const co = await company(3);
  for (const [i, role] of (["owner", "admin", "superadmin"] as const).entries()) {
    const result = await sharing.markProjectReviewed(co.users[role], { projectId: co.jobs[i] }, sql);
    assert.equal(result.status, "reviewed");
    assert.equal(result.alreadyReviewed, false);
    assert.equal(result.reviewedBy, co.users[role]);
    assert.equal(await status(co.jobs[i]), "reviewed");
  }
});

test("markProjectReviewed: one audit row with the snapshot, and only that job is cleared", async () => {
  const co = await company(3);
  await sharing.setProjectSetting(co.users.owner, { projectId: co.jobs[0], key: "labor_doc_send", value: true }, sql);
  const before = (await auditRows(co.companyId)).length;
  const result = await sharing.markProjectReviewed(co.users.admin, { projectId: co.jobs[0] }, sql);
  const rows = (await auditRows(co.companyId)).slice(before);
  assert.equal(rows.length, 1);
  const row = rows[0];
  assert.equal(row.setting_key, "review");
  assert.equal(row.project_id, co.jobs[0]);
  assert.equal(row.old_value, "needed");
  assert.equal(row.new_value, "reviewed");
  assert.equal(row.changed_by, co.users.admin);
  assert.equal(row.changed_role, "admin");
  assert.ok(row.created_at);
  const expected = snapshotAfterReview(null, { labor_doc_send: true, lead_budget_dollars: null });
  assert.deepEqual(row.snapshot, expected);
  assert.deepEqual(result.snapshot, expected);
  assert.deepEqual(expected.labor_doc_send, { value: true, source: "project" });
  // scope: B and C are still flagged
  assert.equal(await status(co.jobs[1]), "needed");
  assert.equal(await status(co.jobs[2]), "needed");
  assert.equal(await needed(co.companyId), 2);
});

test("markProjectReviewed: another company's job is Not found and nothing changes", async () => {
  const mine = await company(1);
  const theirs = await company(1);
  await assert.rejects(sharing.markProjectReviewed(mine.users.owner, { projectId: theirs.jobs[0] }, sql), /Not found/);
  await assert.rejects(sharing.getReviewPreview(mine.users.owner, { projectId: theirs.jobs[0] }, sql), /Not found/);
  await assert.rejects(sharing.markProjectReviewed(mine.users.owner, { projectId: "no-such-job" }, sql), /Not found/);
  assert.equal(await status(theirs.jobs[0]), "needed");
  assert.equal((await auditRows(theirs.companyId)).length, 0);
  assert.equal((await auditRows(mine.companyId)).length, 0);
});

test("markProjectReviewed: idempotent; a second call returns alreadyReviewed and writes nothing", async () => {
  const co = await company(1);
  const first = await sharing.markProjectReviewed(co.users.owner, { projectId: co.jobs[0] }, sql);
  const rows = (await auditRows(co.companyId)).length;
  const updatedAt = (await sql<{ u: unknown }>`select updated_at as u from project_settings where project_id = ${co.jobs[0]}`)[0].u;
  const second = await sharing.markProjectReviewed(co.users.admin, { projectId: co.jobs[0] }, sql);
  assert.equal(second.alreadyReviewed, true);
  assert.equal(second.reviewedBy, first.reviewedBy);
  assert.equal(second.reviewedAt, first.reviewedAt);
  assert.equal((await auditRows(co.companyId)).length, rows);
  const updatedAfter = (await sql<{ u: unknown }>`select updated_at as u from project_settings where project_id = ${co.jobs[0]}`)[0].u;
  assert.deepEqual(updatedAfter, updatedAt);
});

test("markProjectReviewed: a stale confirm is rejected and the flag stays 'needed'", async () => {
  const co = await company(1);
  const preview = await sharing.getReviewPreview(co.users.owner, { projectId: co.jobs[0] }, sql);
  assert.equal(preview.status, "needed");
  await sharing.setProjectSetting(co.users.admin, { projectId: co.jobs[0], key: "labor_doc_send", value: true }, sql);
  await assert.rejects(
    sharing.markProjectReviewed(co.users.owner, { projectId: co.jobs[0], expectedSnapshotHash: preview.hash }, sql),
    /Settings changed since you opened this/,
  );
  assert.equal(await status(co.jobs[0]), "needed");
  // a company change also makes the confirm stale
  const fresh = await sharing.getReviewPreview(co.users.owner, { projectId: co.jobs[0] }, sql);
  await sharing.setCompanySetting(co.users.owner, { key: "lead_budget_dollars", value: true }, sql);
  await assert.rejects(
    sharing.markProjectReviewed(co.users.owner, { projectId: co.jobs[0], expectedSnapshotHash: fresh.hash }, sql),
    /Settings changed/,
  );
  const current = await sharing.getReviewPreview(co.users.owner, { projectId: co.jobs[0] }, sql);
  const ok = await sharing.markProjectReviewed(co.users.owner, { projectId: co.jobs[0], expectedSnapshotHash: current.hash }, sql);
  assert.equal(ok.alreadyReviewed, false);
});

test("effect: a job's override does nothing until that job is reviewed (Labor doc.send)", async () => {
  const co = await company(2);
  const [a, b] = co.jobs;
  assert.equal(await laborMaySend(co, a), false); // fresh company: Off
  await sharing.setProjectSetting(co.users.owner, { projectId: a, key: "labor_doc_send", value: true }, sql);
  assert.equal(await laborMaySend(co, a), false); // still in review → company default
  await sharing.markProjectReviewed(co.users.owner, { projectId: a }, sql);
  assert.equal(await laborMaySend(co, a), true);
  assert.equal(await laborMaySend(co, b), false); // only that job
  assert.equal(await laborMaySend(co, null), false); // no-job documents use the company value
  const many = await sharing.sharingForProjects(sql, co.companyId, [a, b]);
  assert.equal(many.get(a)?.labor_doc_send, true);
  assert.equal(many.get(b)?.labor_doc_send, false);
});

test("company setting: Labor sending is refused, then allowed after the company switches it on", async () => {
  const co = await company(1);
  assert.equal(await laborMaySend(co, null), false);
  await sharing.setCompanySetting(co.users.admin, { key: "labor_doc_send", value: true, note: "Crew emails the inspector" }, sql);
  assert.equal(await laborMaySend(co, null), true);
  assert.equal(await laborMaySend(co, co.jobs[0]), true); // a job in review runs on company defaults
});

test("every settings change writes exactly one audit row; no-op saves write none; Lead/Labor/Sub are refused", async () => {
  const co = await company(1);
  await sharing.setCompanySetting(co.users.owner, { key: "lead_budget_dollars", value: true }, sql);
  await sharing.setCompanySetting(co.users.owner, { key: "lead_budget_dollars", value: true }, sql); // no change
  await sharing.setProjectSetting(co.users.admin, { projectId: co.jobs[0], key: "lead_budget_dollars", value: false }, sql);
  await sharing.setProjectSetting(co.users.admin, { projectId: co.jobs[0], key: "lead_budget_dollars", value: null }, sql);
  const rows = await auditRows(co.companyId);
  assert.deepEqual(
    rows.map((r) => [r.setting_key, r.project_id, r.old_value, r.new_value, r.changed_role]),
    [
      ["lead_budget_dollars", null, "false", "true", "owner"],
      ["lead_budget_dollars", co.jobs[0], "inherit", "false", "admin"],
      ["lead_budget_dollars", co.jobs[0], "false", "inherit", "admin"],
    ],
  );
  for (const role of ["lead", "labor", "sub"] as const) {
    const id = co.users[role];
    await assert.rejects(sharing.setCompanySetting(id, { key: "labor_doc_send", value: true }, sql), { name: "ForbiddenError" });
    await assert.rejects(sharing.setProjectSetting(id, { projectId: co.jobs[0], key: "labor_doc_send", value: true }, sql), { name: "ForbiddenError" });
    await assert.rejects(sharing.getSharingOverview(id, sql), { name: "ForbiddenError" });
    await assert.rejects(sharing.listAudit(id, {}, sql), { name: "ForbiddenError" });
    await assert.rejects(sharing.listReviewQueue(id, sql), { name: "ForbiddenError" });
    await assert.rejects(sharing.requestReviewAgain(id, { projectId: co.jobs[0] }, sql), { name: "ForbiddenError" });
    assert.equal(await sharing.reviewCount(id, sql), 0);
  }
  assert.equal((await auditRows(co.companyId)).length, 3);
  await assert.rejects(sharing.setCompanySetting(co.users.owner, { key: "rate_view", value: true }, sql), /Unknown setting/);
});

test("request review again: reviewed → needed with an audit row; the override stops applying", async () => {
  const co = await company(1);
  await sharing.setProjectSetting(co.users.owner, { projectId: co.jobs[0], key: "labor_doc_send", value: true }, sql);
  await sharing.markProjectReviewed(co.users.owner, { projectId: co.jobs[0] }, sql);
  assert.equal(await laborMaySend(co, co.jobs[0]), true);
  await sharing.requestReviewAgain(co.users.admin, { projectId: co.jobs[0] }, sql);
  assert.equal(await status(co.jobs[0]), "needed");
  assert.equal(await laborMaySend(co, co.jobs[0]), false);
  const last = (await auditRows(co.companyId)).at(-1)!;
  assert.deepEqual([last.setting_key, last.old_value, last.new_value], ["review", "reviewed", "needed"]);
  assert.equal(await sharing.reviewCount(co.users.owner, sql), 1);
});

test("migration 0014 flags every existing job, archived included, and re-running changes nothing", async () => {
  const old = new PGlite({ parsers: { 20: Number } });
  await old.waitReady;
  await applyMigrations(old, (name) => name < "0014");
  const db = sqlFor(old);
  await db`insert into companies (id, name) values ('c1', 'Old Co')`;
  await db`insert into projects (id, company_id, name, client_name, address, phase) values ('p1', 'c1', 'Active', 'C', 'A', 'Build')`;
  await db`insert into projects (id, company_id, name, client_name, address, phase, archived) values ('p2', 'c1', 'Archived', 'C', 'A', 'Done', true)`;
  // 0014 then 0015 apply, then any later migrations (0016 timesheets, …).
  const applied = await applyMigrations(old);
  assert.deepEqual(applied.slice(0, 2), ["0014_sharing_settings.sql", "0015_crew.sql"]);
  assert.ok(applied.every((name) => name >= "0014"), applied.join(", "));
  const rows = await db<{ project_id: string; s: string; by: string }>`
    select project_id, sharing_review_status as s, review_requested_by as by from project_settings order by project_id
  `;
  assert.deepEqual(rows, [
    { project_id: "p1", s: "needed", by: "migration:0014" },
    { project_id: "p2", s: "needed", by: "migration:0014" },
  ]);
  await db`update project_settings set sharing_review_status = 'reviewed' where project_id = 'p1'`;
  assert.deepEqual(await applyMigrations(old), []); // tracked in _migrations: nothing re-runs
  assert.equal((await db<{ s: string }>`select sharing_review_status as s from project_settings where project_id = 'p1'`)[0].s, "reviewed");
  await old.close();
});

test("no bulk path: sharing.server exports no multi-project review function", () => {
  const exported = Object.keys(sharing);
  assert.ok(exported.includes("markProjectReviewed"));
  for (const name of exported) assert.doesNotMatch(name, /bulk|all|many|selected|projectsReviewed/i, name);
  const source = readFileSync(new URL("./sharing.server.ts", import.meta.url), "utf8");
  // The only statement that sets 'reviewed' is the single-job update, scoped by project_id = $1.
  const sets = source.match(/set sharing_review_status = 'reviewed'/g) ?? [];
  assert.equal(sets.length, 1);
  assert.match(source, /where ps\.project_id = \$1 and ps\.company_id = \$2 and ps\.sharing_review_status = 'needed'/);
});
