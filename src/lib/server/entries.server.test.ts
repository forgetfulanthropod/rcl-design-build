import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import type { Sql } from "../db.ts";
import { SHARING_DEFAULTS } from "../sharing.ts";
import { legacyEntries, narrativeOf } from "../report-entries.ts";
import { applyMigrations, freshDb, sqlFor } from "./pglite-test-db.ts";
import * as entries from "./entries.server.ts";
import * as sharing from "./sharing.server.ts";

// Daily report entries (migration 0017) against a real in-memory Postgres.
const MIGRATION = "0017_report_entries.sql";
const PG_OPTS = { parsers: { 20: Number, 1082: (v: string) => v } };
let pg: PGlite;
let sql: Sql;

before(async () => {
  ({ pg, sql } = await freshDb());
});
after(async () => {
  await pg.close();
});

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);

async function seedCompany(db: Sql) {
  const companyId = randomUUID();
  await db`insert into companies (id, name) values (${companyId}, ${"Co"})`;
  const users: Record<string, string> = {};
  for (const role of ["owner", "admin", "superadmin", "lead", "labor", "sub"]) {
    users[role] = randomUUID();
    await db`insert into profiles (user_id, company_id, name, role) values (${users[role]}, ${companyId}, ${role}, ${role})`;
  }
  return { companyId, users };
}

/** A report the old way: narrative + photos straight into the tables (as before 0017, and the demo seed). */
async function legacyReport(db: Sql, co: { companyId: string; users: Record<string, string> }, opts: { narrative: string; photos: string[]; day?: string; who?: string }) {
  const id = randomUUID();
  const user = co.users[opts.who ?? "labor"];
  await db`
    insert into daily_reports (id, company_id, user_id, day, narrative, first_edit_at, last_edit_at, created_at)
    values (${id}, ${co.companyId}, ${user}, ${opts.day ?? "2026-10-19"}, ${opts.narrative},
            ${"2026-10-19T13:00:00Z"}, ${"2026-10-19T21:00:00Z"}, ${"2026-10-19T12:55:00Z"})
  `;
  const photoIds: string[] = [];
  for (const at of opts.photos) {
    const pid = randomUUID();
    photoIds.push(pid);
    await db`
      insert into daily_report_photos (id, report_id, company_id, user_id, mime, bytes, thumb, size_bytes, created_at)
      values (${pid}, ${id}, ${co.companyId}, ${user}, ${"image/jpeg"}, ${JPEG}, ${JPEG}, ${4}, ${at})
    `;
  }
  return { id, user, photoIds };
}

async function rows(db: Sql, reportId: string) {
  return (await entries.entriesFor(db, [reportId])).get(reportId) ?? [];
}

test("migration 0017 turns every existing report's narrative and photos into entries, with no data loss", async () => {
  const old = new PGlite(PG_OPTS);
  await old.waitReady;
  await applyMigrations(old, (name) => name !== MIGRATION);
  const db = sqlFor(old);
  const co = await seedCompany(db);
  const a = await legacyReport(db, co, { narrative: "Hung drywall.\n\nRan out of screws.", photos: ["2026-10-19T12:30:00Z", "2026-10-19T15:00:00Z"] });
  const b = await legacyReport(db, co, { narrative: "", photos: ["2026-10-19T14:00:00Z"], who: "lead" });
  const c = await legacyReport(db, co, { narrative: "Words only, no photos.", photos: [], who: "sub" });
  const before = await db`select id, narrative, first_edit_at, last_edit_at from daily_reports order by id`;
  const photosBefore = await db`select id, report_id, bytes from daily_report_photos order by id`;

  assert.deepEqual(await applyMigrations(old), [MIGRATION]);

  // Same entries as the pure rule (legacyEntries), report by report.
  for (const r of [a, b, c]) {
    const [report] = await db<{ id: string; narrative: string; first_edit_at: Date; last_edit_at: Date; created_at: Date }>`
      select id, narrative, first_edit_at, last_edit_at, created_at from daily_reports where id = ${r.id}
    `;
    const photos = await db<{ id: string; created_at: Date }>`select id, created_at from daily_report_photos where report_id = ${r.id}`;
    const expected = legacyEntries(
      { id: report.id, narrative: report.narrative, firstEditAt: report.first_edit_at.toISOString(), lastEditAt: report.last_edit_at.toISOString(), createdAt: report.created_at.toISOString() },
      photos.map((p) => ({ id: p.id, createdAt: p.created_at.toISOString() })),
    );
    assert.deepEqual(await rows(db, r.id), expected);
    assert.equal(narrativeOf(expected), report.narrative.trim());
  }
  assert.deepEqual((await rows(db, a.id)).map((e) => e.kind), ["photo", "text", "photo"]);
  assert.deepEqual((await rows(db, b.id)).map((e) => e.kind), ["photo"]);
  assert.deepEqual((await rows(db, c.id)).map((e) => e.kind), ["text"]);
  // The old columns and photo bytes are untouched.
  assert.deepEqual(await db`select id, narrative, first_edit_at, last_edit_at from daily_reports order by id`, before);
  assert.deepEqual(await db`select id, report_id, bytes from daily_report_photos order by id`, photosBefore);
  // Re-running the file (e.g. a retried deploy) adds nothing.
  const count = async () => Number((await db<{ n: number }>`select count(*)::int as n from daily_report_entries`)[0].n);
  const n = await count();
  assert.equal(n, 5); // a: note + 2 photos, b: 1 photo, c: 1 note
  await old.exec(readFileSync(new URL(`../../../migrations/${MIGRATION}`, import.meta.url), "utf8"));
  assert.equal(await count(), n);
  await old.close();
});

test("backfillEntries (demo seed / a report that missed the migration) writes exactly what the migration would, once", async () => {
  const co = await seedCompany(sql);
  const r = await legacyReport(sql, co, { narrative: "Seeded day.", photos: ["2026-10-19T12:00:00Z"] });
  assert.equal((await rows(sql, r.id)).length, 0);
  await entries.backfillEntries(sql, r.id);
  await entries.backfillEntries(sql, r.id);
  const got = await rows(sql, r.id);
  assert.deepEqual(got.map((e) => [e.id, e.kind]), [
    [`legacy-photo-${r.photoIds[0]}`, "photo"],
    [`legacy-text-${r.id}`, "text"],
  ]);
  assert.equal(got[1].editedAt, "2026-10-19T21:00:00.000Z");
});

test("saveTextEntries adds, edits (stamping edited_at), clears and keeps the narrative in sync", async () => {
  const co = await seedCompany(sql);
  const me = { userId: co.users.labor, companyId: co.companyId, role: "labor" };
  const r = await legacyReport(sql, co, { narrative: "", photos: [] });
  const keys = await entries.saveTextEntries(sql, me, r.id, [
    { id: null, key: "k1", body: "First note." },
    { id: null, key: "k2", body: "   " },
  ]);
  assert.deepEqual(Object.keys(keys), ["k1"]);
  await entries.addPhotoEntry(sql, me, r.id, (await legacyPhoto(sql, co, r.id)).id);
  const keys2 = await entries.saveTextEntries(sql, me, r.id, [{ id: null, key: "k3", body: "Second note." }]);
  let list = await rows(sql, r.id);
  assert.deepEqual(list.map((e) => e.kind), ["text", "photo", "text"]);
  assert.deepEqual(list.map((e) => e.editedAt), [null, null, null]);
  assert.equal(await narrative(r.id), "First note.\n\nSecond note.");

  await entries.saveTextEntries(sql, me, r.id, [{ id: keys.k1, key: keys.k1, body: "First note, fixed." }]);
  list = await rows(sql, r.id);
  assert.equal(list[0].body, "First note, fixed.");
  assert.ok(list[0].editedAt, "edited is stamped");
  assert.equal(list[0].createdAt, (await rows(sql, r.id))[0].createdAt, "keeps its place and time");
  assert.equal(await narrative(r.id), "First note, fixed.\n\nSecond note.");

  // Unchanged text doesn't touch edited_at; cleared text is removed.
  await entries.saveTextEntries(sql, me, r.id, [{ id: keys2.k3, key: keys2.k3, body: "Second note." }]);
  assert.equal((await rows(sql, r.id))[2].editedAt, null);
  await entries.saveTextEntries(sql, me, r.id, [{ id: keys.k1, key: keys.k1, body: "" }]);
  assert.deepEqual((await rows(sql, r.id)).map((e) => e.kind), ["photo", "text"]);
  assert.equal(await narrative(r.id), "Second note.");

  // Another report's entry id can't be edited through this report.
  const other = await legacyReport(sql, co, { narrative: "", photos: [], day: "2026-10-18" });
  const otherKeys = await entries.saveTextEntries(sql, me, other.id, [{ id: null, key: "o", body: "Other day." }]);
  await entries.saveTextEntries(sql, me, r.id, [{ id: otherKeys.o, key: otherKeys.o, body: "hijack" }]);
  assert.equal((await rows(sql, other.id))[0].body, "Other day.");
});

async function legacyPhoto(db: Sql, co: { companyId: string; users: Record<string, string> }, reportId: string) {
  const id = randomUUID();
  await db`
    insert into daily_report_photos (id, report_id, company_id, user_id, mime, bytes, thumb, size_bytes)
    values (${id}, ${reportId}, ${co.companyId}, ${co.users.labor}, ${"image/jpeg"}, ${JPEG}, ${JPEG}, ${4})
  `;
  return { id };
}
const narrative = async (id: string) => (await sql<{ narrative: string }>`select narrative from daily_reports where id = ${id}`)[0].narrative;

test("a photo entry is removed with its photo (no dangling entries); kind and photo must agree", async () => {
  const co = await seedCompany(sql);
  const me = { userId: co.users.labor, companyId: co.companyId, role: "labor" };
  const r = await legacyReport(sql, co, { narrative: "", photos: [] });
  const photo = await legacyPhoto(sql, co, r.id);
  await entries.addPhotoEntry(sql, me, r.id, photo.id);
  await sql`delete from daily_report_photos where id = ${photo.id}`;
  assert.equal((await rows(sql, r.id)).length, 0);
  await assert.rejects(sql`
    insert into daily_report_entries (id, report_id, company_id, user_id, kind) values (${randomUUID()}, ${r.id}, ${co.companyId}, ${me.userId}, 'photo')
  `);
});

test("who may download a report PDF: Owner/Admin/superadmin any; Lead own; Labor own only with labor_doc_send; Sub never", () => {
  const off = { ...SHARING_DEFAULTS };
  const on = { ...SHARING_DEFAULTS, labor_doc_send: true };
  for (const role of ["owner", "admin", "superadmin"]) {
    assert.equal(entries.mayDownloadPdf(role, false, off), true, role);
    assert.equal(entries.mayDownloadPdf(role, true, off), true, role);
  }
  assert.equal(entries.mayDownloadPdf("lead", true, off), true);
  assert.equal(entries.mayDownloadPdf("lead", false, on), false, "not someone else's");
  assert.equal(entries.mayDownloadPdf("labor", true, off), false);
  assert.equal(entries.mayDownloadPdf("labor", true, on), true);
  assert.equal(entries.mayDownloadPdf("labor", false, on), false);
  for (const sub of ["sub", "subcontractor"]) assert.equal(entries.mayDownloadPdf(sub, true, { lead_budget_dollars: true, labor_doc_send: true }), false, sub);
  assert.equal(entries.mayDownloadPdf("nobody", true, on), false);
});

test("pdfFlags follows each job's effective setting (company default; a job's override only once reviewed)", async () => {
  const co = await seedCompany(sql);
  const owner = { userId: co.users.owner, companyId: co.companyId, role: "owner" };
  const labor = { userId: co.users.labor, companyId: co.companyId, role: "labor" };
  const job = await sharing.insertProject(sql, { companyId: co.companyId, name: "Job", clientName: "C", address: "1 Main", phase: "Build", contractValue: 1, summary: "" }, co.users.owner);
  const reports = [
    { id: "a", userId: labor.userId, projectId: null },
    { id: "b", userId: labor.userId, projectId: job },
    { id: "c", userId: co.users.lead, projectId: job },
  ];
  assert.deepEqual(await entries.pdfFlags(sql, labor, reports), [false, false, false]);
  assert.deepEqual(await entries.pdfFlags(sql, owner, reports), [true, true, true]);
  // A per-job override doesn't count until the job is marked reviewed.
  await sharing.setProjectSetting(co.users.owner, { projectId: job, key: "labor_doc_send", value: true, note: "" }, sql);
  assert.deepEqual(await entries.pdfFlags(sql, labor, reports), [false, false, false]);
  await sharing.markProjectReviewed(co.users.owner, { projectId: job }, sql);
  assert.deepEqual(await entries.pdfFlags(sql, labor, reports), [false, true, false]);
  await sharing.setCompanySetting(co.users.owner, { key: "labor_doc_send", value: true, note: "" }, sql);
  assert.deepEqual(await entries.pdfFlags(sql, labor, reports), [true, true, false]);
});
