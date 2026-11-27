import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import type { Sql } from "../db.ts";
import { addDays, todayIso } from "../crew.ts";
import { freshDb } from "./pglite-test-db.ts";
import { insertProject } from "./sharing.server.ts";
import * as map from "./dispatch-map.server.ts";
import { selectDispatchMap } from "../dispatch-map.ts";

let pg: PGlite;
let sql: Sql;

before(async () => {
  ({ pg, sql } = await freshDb());
});
after(async () => {
  await pg.close();
});

const ROLES = ["owner", "admin", "superadmin", "lead", "labor", "sub"] as const;
type RoleName = (typeof ROLES)[number];
type Co = { companyId: string; users: Record<RoleName, string>; jobs: string[] };

async function company(phases: string[] = ["Build", "Design"]): Promise<Co> {
  const companyId = randomUUID();
  await sql`insert into companies (id, name) values (${companyId}, ${"Co " + companyId.slice(0, 4)})`;
  const users = {} as Co["users"];
  for (const role of ROLES) {
    const id = randomUUID();
    users[role] = id;
    await sql`
      insert into profiles (user_id, company_id, name, role, email)
      values (${id}, ${companyId}, ${role + " person"}, ${role}, ${role + "@map.test"})
    `;
  }
  const jobs: string[] = [];
  for (let i = 0; i < phases.length; i += 1) {
    jobs.push(
      await insertProject(
        sql,
        {
          companyId,
          name: `Job ${i}`,
          clientName: "Client",
          address: i === 0 ? "418 Whitaker Ln, Lexington, KY" : `${i} Main St, Lexington, KY`,
          phase: phases[i] ?? "Build",
          contractValue: 1000,
          summary: "",
        },
        users.owner,
      ),
    );
  }
  return { companyId, users, jobs };
}

test("getMap: every role can read the company jobs, and only editors are marked editable", async () => {
  const co = await company();
  const today = todayIso();
  await sql`
    insert into crew_assignments (id, company_id, user_id, project_id, day, part, note, status, assigned_by)
    values (${randomUUID()}, ${co.companyId}, ${co.users.labor}, ${co.jobs[0]}, ${today}::date, ${"full"}, ${""}, ${"published"}, ${co.users.owner})
  `;
  await sql`
    insert into work_sessions (id, company_id, user_id, project_id, day, start_min, end_min)
    values (${randomUUID()}, ${co.companyId}, ${co.users.lead}, ${co.jobs[0]}, ${today}::date, ${480}, ${600})
  `;
  await sql`
    insert into activities (id, company_id, project_id, day, title, created_by)
    values (${randomUUID()}, ${co.companyId}, ${co.jobs[1]}, ${today}, ${"Layout"}, ${co.users.lead})
  `;
  await sql`
    insert into daily_reports (id, company_id, user_id, day, project_id, narrative, lunch_minutes)
    values (${randomUUID()}, ${co.companyId}, ${co.users.sub}, ${today}, ${co.jobs[1]}, ${"Rough-in"}, ${30})
  `;

  for (const role of ROLES) {
    const facts = await map.getMap(co.users[role], sql);
    assert.equal(facts.canEdit, role === "owner" || role === "admin" || role === "superadmin" || role === "lead", role);
    assert.equal(facts.jobs.length, 2, role);
    assert.equal(facts.today, today);
    const kinds = facts.presences.map((row) => row.kind).sort();
    assert.deepEqual(kinds, ["activity", "assignment", "report", "session"]);
  }

  const owner = await map.getMap(co.users.owner, sql);
  const known = owner.jobs.find((job) => job.address.includes("Whitaker"));
  assert.equal(known?.lat, 38.0172);
  assert.equal(known?.lng, -84.4588);
  const view = selectDispatchMap(owner, today);
  assert.equal(view.jobs.find((job) => job.id === co.jobs[0])?.lastActive.length, 2);
});

test("getMap hides archived jobs and other companies", async () => {
  const co = await company(["Build"]);
  const other = await company(["Build"]);
  await sql`update projects set archived = true where id = ${co.jobs[0]}`;
  const facts = await map.getMap(co.users.owner, sql);
  assert.equal(facts.jobs.length, 0);
  const theirs = await map.getMap(other.users.labor, sql);
  assert.equal(theirs.jobs.length, 1);
  assert.equal(theirs.presences.length, 0);
});

for (const role of ["owner", "admin", "superadmin", "lead"] as const) {
  test(`${role}: can assign one or more people for a future day`, async () => {
    const co = await company(["Build", "Permit"]);
    const day = addDays(todayIso(), 1);
    // Lead is not a job lead. Dispatch still lets them staff the job.
    const saved = await map.assignCrew(
      co.users[role],
      { projectId: co.jobs[0], day, userIds: [co.users.labor, co.users.sub] },
      sql,
    );
    assert.equal(saved.day, day);
    assert.equal(saved.ids.length, 2);
    const rows = await sql<{ user_id: string; status: string; part: string }>`
      select user_id, status, part from crew_assignments
      where company_id = ${co.companyId} and project_id = ${co.jobs[0]} and day = ${day}::date
      order by user_id
    `;
    assert.equal(rows.length, 2);
    assert.equal(rows.every((row) => row.status === "draft" && row.part === "full"), true);

    const again = await map.assignCrew(co.users[role], { projectId: co.jobs[0], day, userIds: [co.users.labor] }, sql);
    assert.equal(again.ids[0], saved.ids[0]);
    const count = await sql<{ n: number }>`
      select count(*)::int as n from crew_assignments
      where company_id = ${co.companyId} and user_id = ${co.users.labor} and day = ${day}::date
    `;
    assert.equal(Number(count[0]?.n), 1);

    const facts = await map.getMap(co.users.labor, sql);
    const view = selectDispatchMap(facts, todayIso());
    const job = view.jobs.find((item) => item.id === co.jobs[0]);
    assert.equal(job?.needsCrew, false);
    assert.equal(job?.nextCrew.length, 2);
    assert.equal(view.jobs.find((item) => item.id === co.jobs[1])?.needsCrew, true);
  });
}

for (const role of ["labor", "sub"] as const) {
  test(`${role}: cannot dispatch, even onto a job they lead`, async () => {
    const co = await company(["Build"]);
    await sql`insert into job_leads (project_id, user_id) values (${co.jobs[0]}, ${co.users[role]})`;
    await assert.rejects(
      map.assignCrew(
        co.users[role],
        { projectId: co.jobs[0], day: addDays(todayIso(), 1), userIds: [co.users.owner] },
        sql,
      ),
      { name: "ForbiddenError" },
    );
    const facts = await map.getMap(co.users[role], sql);
    assert.equal(facts.canEdit, false);
    const left = await sql<{ n: number }>`
      select count(*)::int as n from crew_assignments where company_id = ${co.companyId}
    `;
    assert.equal(Number(left[0]?.n), 0);
  });
}

test("assign refuses a past day, an empty crew, another company, and a double book", async () => {
  const co = await company(["Build", "Design"]);
  const other = await company(["Build"]);
  const tomorrow = addDays(todayIso(), 1);

  await assert.rejects(
    map.assignCrew(co.users.owner, { projectId: co.jobs[0], day: addDays(todayIso(), -1), userIds: [co.users.labor] }, sql),
    /today through the next 6 months/,
  );
  await assert.rejects(
    map.assignCrew(co.users.owner, { projectId: co.jobs[0], day: tomorrow, userIds: [] }, sql),
    /at least one person/,
  );
  await assert.rejects(
    map.assignCrew(co.users.owner, { projectId: other.jobs[0], day: tomorrow, userIds: [co.users.labor] }, sql),
    /Not found/,
  );
  await assert.rejects(
    map.assignCrew(co.users.owner, { projectId: co.jobs[0], day: tomorrow, userIds: [other.users.labor] }, sql),
    /Not found/,
  );

  await map.assignCrew(co.users.admin, { projectId: co.jobs[1], day: tomorrow, userIds: [co.users.labor] }, sql);
  await assert.rejects(
    map.assignCrew(co.users.owner, { projectId: co.jobs[0], day: tomorrow, userIds: [co.users.labor] }, sql),
    /already on Job 1/,
  );
});

test("assign refuses confirmed time off and an archived job", async () => {
  const co = await company(["Build"]);
  const day = addDays(todayIso(), 2);
  await sql`
    insert into person_unavailability (id, company_id, user_id, from_day, to_day, reason, status, created_by)
    values (${randomUUID()}, ${co.companyId}, ${co.users.labor}, ${day}::date, ${day}::date, ${"pto"}, ${"confirmed"}, ${co.users.owner})
  `;
  await assert.rejects(
    map.assignCrew(co.users.owner, { projectId: co.jobs[0], day, userIds: [co.users.labor] }, sql),
    /unavailable that day \(PTO\)/,
  );
  await sql`update projects set archived = true where id = ${co.jobs[0]}`;
  await assert.rejects(
    map.assignCrew(co.users.owner, { projectId: co.jobs[0], day, userIds: [co.users.lead] }, sql),
    /Not found/,
  );
});
