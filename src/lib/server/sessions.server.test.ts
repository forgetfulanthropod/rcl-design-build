import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Sql } from "../db.ts";
import { freshDb } from "./pglite-test-db.ts";
import * as sessions from "./sessions.server.ts";

// Work sessions against a real in-memory Postgres (migration 0018).
let sql: Sql;
let close: () => Promise<void>;

before(async () => {
  const db = await freshDb();
  sql = db.sql;
  close = () => db.pg.close();
});
after(async () => {
  await close();
});

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

async function company() {
  const companyId = randomUUID();
  await sql`insert into companies (id, name) values (${companyId}, ${"Co"})`;
  const users: Record<string, string> = {};
  for (const role of ["owner", "admin", "superadmin", "lead", "labor", "sub", "guest"]) {
    users[role] = randomUUID();
    await sql`insert into profiles (user_id, company_id, name, role) values (${users[role]}, ${companyId}, ${role}, ${role})`;
  }
  const project = randomUUID();
  const other = randomUUID();
  await sql`
    insert into projects (id, company_id, name, client_name, address, phase)
    values (${project}, ${companyId}, ${"Project A"}, ${"Client"}, ${"1 Oak"}, ${"Build"})
  `;
  await sql`
    insert into projects (id, company_id, name, client_name, address, phase)
    values (${other}, ${companyId}, ${"Project B"}, ${"Client"}, ${"2 Oak"}, ${"Build"})
  `;
  return { companyId, users, project, other };
}

const hours = { startMin: 8 * 60, endMin: 11 * 60 + 30, notes: "demolish fence" };

test("each role: who can create, view and edit a work session", async () => {
  const co = await company();
  const day = today();

  for (const role of ["owner", "admin", "superadmin", "lead", "labor", "sub"] as const) {
    const created = await sessions.createSession(co.users[role], { day, projectId: co.project, ...hours, notes: `${role} notes` }, sql);
    assert.equal(created.projectName, "Project A");
    assert.equal(created.notes, `${role} notes`);
    assert.equal(created.userId, co.users[role]);
    const mine = await sessions.listSessions(co.users[role], { day, scope: "mine" }, sql);
    assert.ok(mine.some((row) => row.id === created.id), role);
  }

  // Labor and subs see only their own. A company-wide list is refused.
  const laborMine = await sessions.listSessions(co.users.labor, { day, scope: "mine" }, sql);
  assert.equal(laborMine.length, 1);
  assert.equal(laborMine[0].userId, co.users.labor);
  await assert.rejects(sessions.listSessions(co.users.labor, { day, scope: "company" }, sql), { name: "ForbiddenError" });
  await assert.rejects(sessions.listSessions(co.users.sub, { day, scope: "company" }, sql), { name: "ForbiddenError" });
  await assert.rejects(sessions.listSessions(co.users.labor, { day, scope: "mine", personId: co.users.lead }, sql), { name: "ForbiddenError" });

  // Lead and principals see the crew, including someone else's session.
  for (const role of ["lead", "owner", "admin", "superadmin"] as const) {
    const all = await sessions.listSessions(co.users[role], { day, scope: "company" }, sql);
    assert.equal(all.length, 6, role);
    const justLabor = await sessions.listSessions(co.users[role], { day, scope: "mine", personId: co.users.labor }, sql);
    assert.equal(justLabor.length, 1);
    assert.equal(justLabor[0].userId, co.users.labor);
  }

  const labor = (await sessions.listSessions(co.users.labor, { day, scope: "mine" }, sql))[0];
  const lead = (await sessions.listSessions(co.users.lead, { day, scope: "mine" }, sql))[0];

  // Editing your own hours is allowed. Editing someone else's is principals only — a lead cannot.
  const edited = await sessions.updateSession(co.users.labor, { id: labor.id, projectId: co.other, startMin: 13 * 60, endMin: 16 * 60, notes: "drywall takeoffs" }, sql);
  assert.equal(edited.projectName, "Project B");
  assert.equal(edited.notes, "drywall takeoffs");
  await assert.rejects(
    sessions.updateSession(co.users.lead, { id: labor.id, projectId: co.project, startMin: 8 * 60, endMin: 9 * 60, notes: "nope" }, sql),
    { name: "ForbiddenError" },
  );
  await assert.rejects(sessions.deleteSession(co.users.sub, labor.id, sql), { name: "ForbiddenError" });
  await assert.rejects(sessions.deleteSession(co.users.labor, lead.id, sql), { name: "ForbiddenError" });
  const corrected = await sessions.updateSession(co.users.owner, { id: labor.id, projectId: co.project, startMin: 8 * 60, endMin: 12 * 60, notes: "demolish fence" }, sql);
  assert.equal(corrected.notes, "demolish fence");
  assert.equal(corrected.endMin, 12 * 60);
  assert.deepEqual(await sessions.deleteSession(co.users.admin, lead.id, sql), { ok: true });
  assert.equal((await sessions.listSessions(co.users.lead, { day, scope: "mine" }, sql)).length, 0);

  // A role outside the matrix cannot create or view.
  await assert.rejects(sessions.createSession(co.users.guest, { day, projectId: co.project, ...hours }, sql), { name: "ForbiddenError" });
  await assert.rejects(sessions.listSessions(co.users.guest, { day, scope: "mine" }, sql), { name: "ForbiddenError" });
});

test("sessions stay inside the company and the day, and a bad range is refused", async () => {
  const a = await company();
  const b = await company();
  const day = today();
  const created = await sessions.createSession(a.users.labor, { day, projectId: a.project, ...hours }, sql);

  assert.deepEqual(await sessions.listSessions(b.users.owner, { day, scope: "company" }, sql), []);
  await assert.rejects(sessions.updateSession(b.users.owner, { id: created.id, projectId: b.project, ...hours }, sql), /not found/i);
  await assert.rejects(sessions.createSession(a.users.labor, { day, projectId: b.project, ...hours }, sql), /project/i);
  await assert.rejects(sessions.createSession(a.users.labor, { day, projectId: a.project, startMin: 600, endMin: 600, notes: "" }, sql), /after the start/i);
  await assert.rejects(sessions.createSession(a.users.labor, { day: "2001-01-01", projectId: a.project, ...hours }, sql), /today/i);
  await assert.rejects(sessions.listSessions(a.users.labor, { day: "nope", scope: "mine" }, sql), /day/i);

  // Reading an old day is allowed; changing it is not.
  await sql`
    insert into work_sessions (id, company_id, user_id, project_id, day, start_min, end_min, notes)
    values (${randomUUID()}, ${a.companyId}, ${a.users.labor}, ${a.project}, ${"2020-01-02"}, ${8 * 60}, ${9 * 60}, ${"old"})
  `;
  const old = await sessions.listSessions(a.users.labor, { day: "2020-01-02", scope: "mine" }, sql);
  assert.equal(old.length, 1);
  assert.equal(old[0].notes, "old");
  await assert.rejects(sessions.deleteSession(a.users.labor, old[0].id, sql), /today/i);
});
