import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import type { Sql } from "../db.ts";
import { freshDb } from "./pglite-test-db.ts";
import * as dispatch from "./dispatch.server.ts";
import { insertProject } from "./sharing.server.ts";

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

async function company(jobs = 2): Promise<Co> {
  const companyId = randomUUID();
  await sql`insert into companies (id, name) values (${companyId}, ${"Co " + companyId.slice(0, 4)})`;
  const users = {} as Co["users"];
  for (const role of ROLES) {
    const id = randomUUID();
    users[role] = id;
    await sql`
      insert into profiles (user_id, company_id, name, role, email)
      values (${id}, ${companyId}, ${role + " person"}, ${role}, ${role + "@d.test"})
    `;
  }
  const ids: string[] = [];
  for (let i = 0; i < jobs; i += 1) {
    ids.push(
      await insertProject(
        sql,
        {
          companyId,
          name: `Job ${"AB"[i] ?? i}`,
          clientName: "Client",
          address: `${i + 1} Main`,
          phase: "Build",
          contractValue: 1000,
          summary: "",
        },
        users.owner,
      ),
    );
  }
  return { companyId, users, jobs: ids };
}

function at(board: dispatch.DispatchBoard, day: string, userId: string) {
  const placed = board.daysPlaced.find((d) => d.day === day);
  assert.ok(placed, day);
  const row = placed.placements.find((p) => p.userId === userId);
  assert.ok(row, userId);
  return row;
}

test("migration 0020 applied: dispatch tables exist", async () => {
  for (const name of [
    "dispatch_locations",
    "dispatch_day_notes",
    "dispatch_roster",
    "dispatch_placements",
    "dispatch_person_notes",
    "dispatch_changes",
    "dispatch_day_sends",
    "dispatch_send_jobs",
  ]) {
    const rows = await sql<{ t: string }>`select to_regclass(${name})::text as t`;
    assert.equal(rows[0].t, name);
  }
});

for (const role of ["labor", "sub"] as const) {
  test(`${role}: can view the board and cannot edit it`, async () => {
    const co = await company(1);
    const shop = await dispatch.addLocation(
      co.users.owner,
      { name: "Shop", address: "1 Yard", notes: "Gate 1492" },
      sql,
    );
    await dispatch.addPerson(
      co.users.owner,
      { userId: co.users.labor, kind: "full", day: "2026-11-02", locationId: shop.id },
      sql,
    );

    const board = await dispatch.getBoard(co.users[role], { day: "2026-11-02" }, sql);
    assert.equal(board.canEdit, false);
    assert.equal(board.startLabel, "8:00 AM");
    assert.equal(board.locations.length, 1);
    assert.equal(board.projects.length, 0);
    assert.equal(board.candidates.length, 0);
    assert.equal(at(board, "2026-11-02", co.users.labor).locationId, shop.id);

    const place = { userId: co.users.labor, day: "2026-11-02", locationId: shop.id };
    await assert.rejects(dispatch.addLocation(co.users[role], { name: "Yard" }, sql), {
      name: "ForbiddenError",
    });
    await assert.rejects(
      dispatch.updateLocation(co.users[role], { id: shop.id, notes: "no" }, sql),
      { name: "ForbiddenError" },
    );
    await assert.rejects(
      dispatch.setDayNote(
        co.users[role],
        { locationId: shop.id, day: "2026-11-02", notes: "no" },
        sql,
      ),
      { name: "ForbiddenError" },
    );
    await assert.rejects(
      dispatch.addPerson(
        co.users[role],
        { userId: co.users.lead, kind: "part", day: "2026-11-02" },
        sql,
      ),
      { name: "ForbiddenError" },
    );
    await assert.rejects(dispatch.placePerson(co.users[role], place, sql), {
      name: "ForbiddenError",
    });
    await assert.rejects(
      dispatch.setPersonKind(
        co.users[role],
        { userId: co.users.labor, kind: "part", day: "2026-11-02" },
        sql,
      ),
      { name: "ForbiddenError" },
    );
    await assert.rejects(dispatch.removePerson(co.users[role], { userId: co.users.labor }, sql), {
      name: "ForbiddenError",
    });
    await assert.rejects(
      dispatch.setPersonNote(co.users[role], { userId: co.users.labor, day: "2026-11-02", notes: "no" }, sql),
      { name: "ForbiddenError" },
    );
    await assert.rejects(dispatch.setPersonPhone(co.users[role], { userId: co.users.labor, phone: "8595550100" }, sql), {
      name: "ForbiddenError",
    });
    const texts = await sql<{ n: number }>`
      select count(*)::int as n from outbound_messages where company_id = ${co.companyId} and kind = 'dispatch'
    `;
    assert.equal(Number(texts[0].n), 0);
  });
}

for (const role of ["owner", "admin", "lead", "superadmin"] as const) {
  test(`${role}: can add a location and place someone`, async () => {
    const co = await company(1);
    const loc = await dispatch.addLocation(co.users[role], { name: `${role} shop` }, sql);
    await dispatch.addPerson(
      co.users[role],
      { userId: co.users.labor, kind: "full", day: "2026-11-02", locationId: loc.id },
      sql,
    );
    const board = await dispatch.getBoard(co.users[role], { day: "2026-11-02" }, sql);
    assert.equal(board.canEdit, true);
    assert.equal(at(board, "2026-11-02", co.users.labor).locationId, loc.id);
  });
}

test("a job becomes a location; a second add is refused; a free-form site does not create a project", async () => {
  const co = await company(2);
  const linked = await dispatch.addLocation(
    co.users.owner,
    { projectId: co.jobs[0], notes: "Park on the south side" },
    sql,
  );
  await assert.rejects(
    dispatch.addLocation(co.users.owner, { projectId: co.jobs[0] }, sql),
    /already on the board/,
  );
  const board = await dispatch.getBoard(co.users.owner, { day: "2026-11-02" }, sql);
  const loc = board.locations.find((l) => l.id === linked.id);
  assert.ok(loc);
  assert.equal(loc.linked, true);
  assert.equal(loc.name, "Job A");
  assert.equal(loc.address, "1 Main");
  assert.equal(loc.standingNotes, "Park on the south side");
  assert.equal(
    board.projects.some((p) => p.id === co.jobs[0]),
    false,
  );
  assert.equal(
    board.projects.some((p) => p.id === co.jobs[1]),
    true,
  );

  await dispatch.addLocation(co.users.lead, { name: "Yard", address: "9 Alley" }, sql);
  const projects = await sql<{
    n: number;
  }>`select count(*)::int as n from projects where company_id = ${co.companyId}`;
  assert.equal(Number(projects[0].n), 2);

  await assert.rejects(
    dispatch.addLocation(co.users.owner, { projectId: randomUUID() }, sql),
    /Not found/,
  );
  await assert.rejects(
    dispatch.addLocation(co.users.owner, { name: "  " }, sql),
    /Name the location/,
  );
});

test("full-time carries forward until moved; part-time stays in the pool except on placed days", async () => {
  const co = await company(1);
  const a = await dispatch.addLocation(co.users.owner, { name: "Whitaker" }, sql);
  const b = await dispatch.addLocation(co.users.owner, { name: "Shop" }, sql);
  await dispatch.addPerson(
    co.users.owner,
    { userId: co.users.labor, kind: "full", day: "2026-11-02", locationId: a.id },
    sql,
  );
  await dispatch.addPerson(
    co.users.admin,
    { userId: co.users.sub, kind: "part", day: "2026-11-02" },
    sql,
  );

  const monday = await dispatch.getBoard(co.users.lead, { day: "2026-11-02" }, sql);
  assert.equal(at(monday, "2026-11-02", co.users.labor).locationId, a.id);
  assert.equal(at(monday, "2026-11-02", co.users.labor).carried, false);
  assert.equal(at(monday, "2026-11-03", co.users.labor).locationId, a.id);
  assert.equal(at(monday, "2026-11-03", co.users.labor).carried, true);
  assert.equal(at(monday, "2026-11-02", co.users.sub).locationId, null);

  await dispatch.placePerson(
    co.users.lead,
    { userId: co.users.labor, day: "2026-11-04", locationId: b.id },
    sql,
  );
  await dispatch.placePerson(
    co.users.lead,
    { userId: co.users.sub, day: "2026-11-03", locationId: a.id },
    sql,
  );
  const wed = await dispatch.getBoard(co.users.owner, { day: "2026-11-04" }, sql);
  assert.equal(at(wed, "2026-11-02", co.users.labor).locationId, a.id);
  assert.equal(at(wed, "2026-11-03", co.users.labor).locationId, a.id);
  assert.equal(at(wed, "2026-11-04", co.users.labor).locationId, b.id);
  assert.equal(at(wed, "2026-11-05", co.users.labor).locationId, b.id);
  assert.equal(at(wed, "2026-11-03", co.users.sub).locationId, a.id);
  assert.equal(at(wed, "2026-11-04", co.users.sub).locationId, null);

  await dispatch.placePerson(
    co.users.owner,
    { userId: co.users.sub, day: "2026-11-03", locationId: null },
    sql,
  );
  const cleared = await dispatch.getBoard(co.users.owner, { day: "2026-11-03" }, sql);
  assert.equal(at(cleared, "2026-11-03", co.users.sub).locationId, null);
  await assert.rejects(
    dispatch.placePerson(
      co.users.owner,
      { userId: co.users.labor, day: "2026-11-06", locationId: null },
      sql,
    ),
    /Pick a location/,
  );
  await assert.rejects(
    dispatch.placePerson(
      co.users.owner,
      { userId: co.users.owner, day: "2026-11-02", locationId: a.id },
      sql,
    ),
    /Not found/,
  );
});

test("day instructions stick to that day, and archiving a location unassigns whoever was on it", async () => {
  const co = await company(1);
  const shop = await dispatch.addLocation(co.users.owner, { name: "Shop", notes: "Standing" }, sql);
  await dispatch.addPerson(
    co.users.owner,
    { userId: co.users.labor, kind: "full", day: "2026-11-02", locationId: shop.id },
    sql,
  );
  await dispatch.setDayNote(
    co.users.admin,
    { locationId: shop.id, day: "2026-11-03", notes: "Bring the trailer." },
    sql,
  );

  const tue = await dispatch.getBoard(co.users.owner, { day: "2026-11-03" }, sql);
  assert.equal(tue.locations[0].dayNotes, "Bring the trailer.");
  assert.equal(tue.locations[0].standingNotes, "Standing");
  const mon = await dispatch.getBoard(co.users.owner, { day: "2026-11-02" }, sql);
  assert.equal(mon.locations[0].dayNotes, "");

  await dispatch.updateLocation(co.users.owner, { id: shop.id, archived: true }, sql);
  const after = await dispatch.getBoard(co.users.owner, { day: "2026-11-03" }, sql);
  assert.equal(after.locations.length, 0);
  assert.equal(at(after, "2026-11-03", co.users.labor).locationId, null);
});

test("switching to part-time stops the carry-forward; switching back can place them again", async () => {
  const co = await company(1);
  const shop = await dispatch.addLocation(co.users.owner, { name: "Shop" }, sql);
  await dispatch.addPerson(
    co.users.owner,
    { userId: co.users.labor, kind: "full", day: "2026-11-02", locationId: shop.id },
    sql,
  );
  await dispatch.setPersonKind(
    co.users.lead,
    { userId: co.users.labor, kind: "part", day: "2026-11-04" },
    sql,
  );
  const asPart = await dispatch.getBoard(co.users.owner, { day: "2026-11-04" }, sql);
  assert.equal(asPart.people.find((p) => p.userId === co.users.labor)?.kind, "part");
  assert.equal(at(asPart, "2026-11-02", co.users.labor).locationId, null);
  assert.equal(at(asPart, "2026-11-04", co.users.labor).locationId, null);

  await dispatch.setPersonKind(
    co.users.owner,
    { userId: co.users.labor, kind: "full", day: "2026-11-04", locationId: shop.id },
    sql,
  );
  const back = await dispatch.getBoard(co.users.owner, { day: "2026-11-04" }, sql);
  assert.equal(at(back, "2026-11-04", co.users.labor).locationId, shop.id);
  assert.equal(at(back, "2026-11-05", co.users.labor).locationId, shop.id);
});

test("a person cannot be added twice, and another company cannot see or edit this board", async () => {
  const co = await company(1);
  const other = await company(1);
  const shop = await dispatch.addLocation(co.users.owner, { name: "Shop" }, sql);
  await dispatch.addPerson(
    co.users.owner,
    { userId: co.users.labor, kind: "part", day: "2026-11-02" },
    sql,
  );
  await assert.rejects(
    dispatch.addPerson(
      co.users.owner,
      { userId: co.users.labor, kind: "full", day: "2026-11-02", locationId: shop.id },
      sql,
    ),
    /Already on the schedule/,
  );
  await assert.rejects(
    dispatch.addPerson(
      co.users.owner,
      { userId: other.users.labor, kind: "part", day: "2026-11-02" },
      sql,
    ),
    /Not found/,
  );
  await assert.rejects(
    dispatch.placePerson(
      other.users.owner,
      { userId: co.users.labor, day: "2026-11-02", locationId: shop.id },
      sql,
    ),
    /Not found/,
  );
  await assert.rejects(
    dispatch.setDayNote(
      other.users.owner,
      { locationId: shop.id, day: "2026-11-02", notes: "nope" },
      sql,
    ),
    /Not found/,
  );

  const theirs = await dispatch.getBoard(other.users.owner, { day: "2026-11-02" }, sql);
  assert.equal(theirs.locations.length, 0);
  assert.equal(theirs.people.length, 0);
  const ours = await dispatch.getBoard(co.users.owner, { day: "2026-11-02" }, sql);
  assert.equal(ours.people.length, 1);

  await dispatch.removePerson(co.users.admin, { userId: co.users.labor }, sql);
  const gone = await dispatch.getBoard(co.users.owner, { day: "2026-11-02" }, sql);
  assert.equal(gone.people.length, 0);
  assert.ok(gone.candidates.some((c) => c.userId === co.users.labor));
});

test("instructions: create, edit, and clear for a person and a location, visible on the week", async () => {
  const co = await company(1);
  const shop = await dispatch.addLocation(co.users.owner, { name: "Shop" }, sql);
  const yard = await dispatch.addLocation(co.users.owner, { name: "Yard" }, sql);
  await dispatch.addPerson(co.users.owner, { userId: co.users.labor, kind: "full", day: "2026-11-02", locationId: shop.id }, sql);
  await dispatch.addPerson(co.users.owner, { userId: co.users.sub, kind: "part", day: "2026-11-02" }, sql);
  await dispatch.placePerson(co.users.lead, { userId: co.users.sub, day: "2026-11-03", locationId: yard.id }, sql);

  await dispatch.setDayNote(co.users.admin, { locationId: shop.id, day: "2026-11-03", notes: "Bring the trailer." }, sql);
  await dispatch.setPersonNote(co.users.owner, { userId: co.users.labor, day: "2026-11-03", notes: "Call the homeowner." }, sql);
  let board = await dispatch.getBoard(co.users.labor, { day: "2026-11-03" }, sql);
  assert.equal(board.locationInstructions.find((n) => n.locationId === shop.id && n.day === "2026-11-03")?.body, "Bring the trailer.");
  assert.equal(board.personInstructions.find((n) => n.userId === co.users.labor && n.day === "2026-11-03")?.body, "Call the homeowner.");
  assert.equal(board.locations.find((l) => l.id === shop.id)?.dayNotes, "Bring the trailer.");
  assert.equal(board.personInstructions.some((n) => n.day === "2026-11-02"), false);

  await dispatch.setPersonNote(co.users.lead, { userId: co.users.labor, day: "2026-11-03", notes: "Call before 8." }, sql);
  board = await dispatch.getBoard(co.users.owner, { day: "2026-11-03" }, sql);
  assert.equal(board.personInstructions.find((n) => n.userId === co.users.labor)?.body, "Call before 8.");

  await dispatch.setPersonNote(co.users.owner, { userId: co.users.labor, day: "2026-11-03", notes: "  " }, sql);
  await dispatch.setDayNote(co.users.admin, { locationId: shop.id, day: "2026-11-03", notes: "" }, sql);
  board = await dispatch.getBoard(co.users.labor, { day: "2026-11-03" }, sql);
  assert.equal(board.personInstructions.length, 0);
  assert.equal(board.locationInstructions.length, 0);
  assert.equal(board.locations.find((l) => l.id === shop.id)?.dayNotes, "");
});

test("phone: editors save E.164; a bad number is refused; viewers can read it", async () => {
  const co = await company(1);
  const shop = await dispatch.addLocation(co.users.owner, { name: "Shop" }, sql);
  await dispatch.addPerson(co.users.owner, { userId: co.users.labor, kind: "full", day: "2026-11-02", locationId: shop.id }, sql);
  const saved = await dispatch.setPersonPhone(co.users.admin, { userId: co.users.labor, phone: "(859) 555-0100" }, sql);
  assert.equal(saved.phone, "+18595550100");
  let board = await dispatch.getBoard(co.users.labor, { day: "2026-11-02" }, sql);
  assert.equal(board.people.find((p) => p.userId === co.users.labor)?.phone, "+18595550100");

  await dispatch.setPersonPhone(co.users.lead, { userId: co.users.labor, phone: "+44 20 7946 0958" }, sql);
  board = await dispatch.getBoard(co.users.sub, { day: "2026-11-02" }, sql);
  assert.equal(board.people.find((p) => p.userId === co.users.labor)?.phone, "+442079460958");

  await assert.rejects(dispatch.setPersonPhone(co.users.owner, { userId: co.users.labor, phone: "555" }, sql), /area code/);
  const cleared = await dispatch.setPersonPhone(co.users.superadmin, { userId: co.users.labor, phone: "  " }, sql);
  assert.equal(cleared.phone, null);
  await assert.rejects(dispatch.setPersonPhone(co.users.owner, { userId: co.users.owner, phone: "8595550199" }, sql), /Not found/);
});

test("texts: create, update, and clear notify only that employee, and rapid moves collapse", async () => {
  const co = await company(1);
  const shop = await dispatch.addLocation(co.users.owner, { name: "Shop", address: "100 Yard St" }, sql);
  const yard = await dispatch.addLocation(co.users.owner, { name: "Yard", address: "9 Alley" }, sql);
  await sql`update profiles set phone = ${"+18595550100"} where user_id = ${co.users.labor}`;
  await sql`update profiles set phone = ${"+18595550199"} where user_id = ${co.users.sub}`;
  await dispatch.addPerson(co.users.owner, { userId: co.users.labor, kind: "full", day: "2026-11-02", locationId: shop.id }, sql);
  await dispatch.addPerson(co.users.owner, { userId: co.users.sub, kind: "part", day: "2026-11-02" }, sql);
  await dispatch.placePerson(co.users.owner, { userId: co.users.sub, day: "2026-11-03", locationId: yard.id }, sql);

  const sent: { userId: string; to: string; body: string }[] = [];
  const hooks = { notify: async (notice: { userId: string; to: string; body: string }) => void sent.push(notice) };

  sent.length = 0;
  await dispatch.setPersonNote(co.users.owner, { userId: co.users.labor, day: "2026-11-03", notes: "ONLY-LUIS-BOOTS" }, sql, hooks);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, "+18595550100");
  assert.match(sent[0].body, /ONLY-LUIS-BOOTS/);
  assert.match(sent[0].body, /Number on file: \+18595550100/);
  assert.doesNotMatch(sent[0].body, /ONLY-SAM/);
  assert.doesNotMatch(sent[0].body, /\+18595550199/);

  await dispatch.setPersonNote(co.users.lead, { userId: co.users.labor, day: "2026-11-03", notes: "ONLY-LUIS-GLOVES" }, sql, hooks);
  assert.equal(sent.length, 2);
  assert.match(sent[1].body, /ONLY-LUIS-GLOVES/);
  assert.doesNotMatch(sent[1].body, /ONLY-LUIS-BOOTS/);

  await dispatch.setPersonNote(co.users.admin, { userId: co.users.sub, day: "2026-11-03", notes: "ONLY-SAM-WIRE" }, sql, hooks);
  await dispatch.setPersonNote(co.users.owner, { userId: co.users.labor, day: "2026-11-03", notes: "" }, sql, hooks);
  const cleared = sent.at(-1)!;
  assert.equal(cleared.userId, co.users.labor);
  assert.match(cleared.body, /For you: cleared/);
  assert.doesNotMatch(cleared.body, /ONLY-SAM-WIRE/);
  assert.doesNotMatch(cleared.body, /ONLY-LUIS-GLOVES/);

  const beforeLocation = sent.length;
  await dispatch.setDayNote(co.users.owner, { locationId: shop.id, day: "2026-11-03", notes: "Bring the trailer." }, sql, hooks);
  const locationTexts = sent.slice(beforeLocation);
  assert.equal(locationTexts.length, 1);
  assert.equal(locationTexts[0].userId, co.users.labor);
  assert.match(locationTexts[0].body, /Bring the trailer/);
  assert.doesNotMatch(locationTexts[0].body, /ONLY-SAM-WIRE/);

  await dispatch.setDayNote(co.users.owner, { locationId: shop.id, day: "2026-11-03", notes: "" }, sql, hooks);
  assert.match(sent.at(-1)!.body, /Location instruction: cleared/);
  assert.equal(sent.at(-1)!.userId, co.users.labor);

  sent.length = 0;
  await dispatch.placePerson(co.users.owner, { userId: co.users.labor, day: "2026-11-04", locationId: yard.id }, sql, hooks);
  assert.equal(sent.length, 1);
  assert.match(sent[0].body, /Yard, 9 Alley/);
  await dispatch.placePerson(co.users.owner, { userId: co.users.labor, day: "2026-11-04", locationId: shop.id }, sql, hooks);
  assert.equal(sent.length, 1, "a second move inside the window does not send another text");
  const logged = await sql<{ body: string; n: number }>`
    select body, count(*)::int as n from outbound_messages
    where company_id = ${co.companyId} and recipient_user_id = ${co.users.labor} and subject = ${"Dispatch assignment 2026-11-04"}
    group by body
  `;
  assert.equal(logged.length, 1);
  assert.match(logged[0].body, /Shop, 100 Yard St/);

  await sql`
    update outbound_messages set created_at = now() - interval '1 minute'
    where company_id = ${co.companyId} and subject = ${"Dispatch assignment 2026-11-04"}
  `;
  await dispatch.placePerson(co.users.owner, { userId: co.users.labor, day: "2026-11-04", locationId: yard.id }, sql, hooks);
  assert.equal(sent.length, 2);

  await dispatch.addPerson(co.users.owner, { userId: co.users.admin, kind: "part", day: "2026-11-02" }, sql);
  const quiet = sent.length;
  await dispatch.placePerson(co.users.owner, { userId: co.users.admin, day: "2026-11-04", locationId: shop.id }, sql, hooks);
  assert.equal(sent.length, quiet, "no phone, no text");
  const quietRows = await sql<{ n: number }>`
    select count(*)::int as n from outbound_messages
    where company_id = ${co.companyId} and recipient_user_id = ${co.users.admin}
  `;
  assert.equal(Number(quietRows[0].n), 0);
});

test("day send: pending, undo, one text per phone, skip, unconfigured, and last sent", async () => {
  const co = await company(1);
  const day = "2026-11-24";
  await dispatch.addLocation(co.users.owner, { name: "Shop", address: "1 Yard", day }, sql);
  let board = await dispatch.getBoard(co.users.labor, { day }, sql);
  assert.equal(board.send.pending, true);
  assert.equal(board.send.lastSentLabel, "Never sent");
  assert.equal(board.canEdit, false);

  await assert.rejects(dispatch.scheduleDaySend(co.users.labor, { day }, sql), { name: "ForbiddenError" });
  await assert.rejects(dispatch.scheduleDaySend(co.users.sub, { day }, sql), { name: "ForbiddenError" });
  await assert.rejects(dispatch.undoDaySend(co.users.labor, { id: "missing" }, sql), { name: "ForbiddenError" });
  await assert.rejects(dispatch.scheduleDaySend(co.users.owner, { day: "2026-01-01" }, sql), /Nothing new to send/);

  const shop = (await dispatch.getBoard(co.users.owner, { day }, sql)).locations[0].id;
  await sql`update profiles set phone = ${"+18595550100"} where user_id = ${co.users.labor}`;
  await dispatch.addPerson(co.users.owner, { userId: co.users.labor, kind: "full", day, locationId: shop }, sql);
  await dispatch.addPerson(co.users.owner, { userId: co.users.sub, kind: "part", day }, sql);
  await dispatch.placePerson(co.users.lead, { userId: co.users.sub, day, locationId: shop }, sql);
  await dispatch.setDayNote(co.users.admin, { locationId: shop, day, notes: "Bring the trailer." }, sql);
  await dispatch.setPersonNote(co.users.owner, { userId: co.users.labor, day, notes: "Call first." }, sql);

  const sent: { to: string; body: string }[] = [];
  const hooks = { notify: async (notice: { to: string; body: string }) => void sent.push(notice) };
  const job = await dispatch.scheduleDaySend(co.users.owner, { day }, sql, hooks);
  const same = await dispatch.scheduleDaySend(co.users.admin, { day }, sql, hooks);
  assert.equal(same.id, job.id);
  await dispatch.undoDaySend(co.users.lead, { id: job.id }, sql);
  assert.equal(sent.length, 0);
  board = await dispatch.getBoard(co.users.owner, { day }, sql);
  assert.equal(board.send.pending, true);
  assert.equal(board.send.lastSentAt, null);
  assert.equal(board.send.scheduled, null);

  const again = await dispatch.scheduleDaySend(co.users.owner, { day }, sql, hooks);
  await sql`update dispatch_send_jobs set send_at = now() - interval '1 second' where id = ${again.id}`;
  await assert.rejects(dispatch.undoDaySend(co.users.owner, { id: again.id }, sql), /already went out/);
  const claimed = await dispatch.claimDueSends(co.users.owner, { id: again.id }, sql, hooks, new Date());
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, "+18595550100");
  assert.match(sent[0].body, /8:00 AM/);
  assert.match(sent[0].body, /Shop/);
  assert.match(sent[0].body, /Bring the trailer/);
  assert.match(sent[0].body, /Call first/);
  assert.doesNotMatch(sent[0].body, /sub person/);
  assert.equal(claimed.jobs[0].sent, 1);
  assert.equal(claimed.jobs[0].skippedNoPhone, 1);
  const repeat = await dispatch.claimDueSends(co.users.owner, { id: again.id }, sql, hooks, new Date());
  assert.equal(sent.length, 1);
  assert.equal(repeat.jobs[0].sent, 1);

  board = await dispatch.getBoard(co.users.owner, { day }, sql);
  assert.equal(board.send.pending, false);
  assert.match(board.send.lastSentLabel, /^Last sent /);
  await dispatch.setPersonPhone(co.users.owner, { userId: co.users.labor, phone: "8595550188", day }, sql);
  board = await dispatch.getBoard(co.users.sub, { day }, sql);
  assert.equal(board.send.pending, true, "an edit after send marks the day dirty");

  const quietBefore = sent.length;
  const plain = await dispatch.scheduleDaySend(co.users.owner, { day }, sql);
  await sql`update dispatch_send_jobs set send_at = now() - interval '1 second' where id = ${plain.id}`;
  const unconfigured = await dispatch.claimDueSends(co.users.owner, { id: plain.id }, sql, undefined, new Date());
  assert.equal(sent.length, quietBefore);
  assert.equal(unconfigured.jobs[0].configured, false);
  assert.equal(unconfigured.jobs[0].sent, 0);
  const skipped = await sql<{ error: string }>`
    select error from outbound_messages
    where company_id = ${co.companyId} and subject = ${"Dispatch " + day} and error = ${"SMS not configured"}
  `;
  assert.ok(skipped.length >= 1);
});
