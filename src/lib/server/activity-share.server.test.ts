import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Sql } from "../db.ts";
import { freshDb } from "./pglite-test-db.ts";
import * as shares from "./activity-share.server.ts";
import * as sharing from "./sharing.server.ts";

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

const svg = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"/>')}`;

function snapshot(note: string) {
  return {
    day: "2026-11-04",
    entries: [
      {
        id: "p1",
        kind: "photo",
        body: note,
        image: svg,
        takenAt: "2026-11-02T08:41:00.000Z",
        takenSource: "exif",
        project: "Project A",
        ts: "2026-11-02T08:40:00.000Z",
        lat: 38.04,
        lng: -84.5,
      },
    ],
    sessions: [{ id: "ss-a", startMin: 8 * 60, endMin: 11 * 60, project: "Project A", notes: "demolish fence" }],
  };
}

async function company() {
  const companyId = randomUUID();
  await sql`insert into companies (id, name) values (${companyId}, ${"Co"})`;
  const users: Record<string, string> = {};
  for (const role of ["owner", "admin", "superadmin", "lead", "labor", "sub", "guest"]) {
    users[role] = randomUUID();
    await sql`insert into profiles (user_id, company_id, name, role) values (${users[role]}, ${companyId}, ${role}, ${role})`;
  }
  return { companyId, users };
}

test("each role: who can create, read and revoke a private activity link", async () => {
  const co = await company();
  const otherId = randomUUID();
  const outsider = randomUUID();
  await sql`insert into companies (id, name) values (${otherId}, ${"Other"})`;
  await sql`insert into profiles (user_id, company_id, name, role) values (${outsider}, ${otherId}, ${"outsider"}, ${"owner"})`;

  for (const role of ["owner", "admin", "superadmin", "lead"] as const) {
    const created = await shares.createActivityShare(co.users[role], snapshot(`${role} caption`), sql);
    assert.match(created.token, /^[A-Za-z0-9_-]{40,}$/, role);
    const seen = await shares.readActivityShare(created.token, sql);
    assert.ok(seen, role);
    assert.equal(seen?.entries[0].body, `${role} caption`);
    assert.equal(JSON.stringify(seen).includes("38.04"), false);
    assert.equal(JSON.stringify(seen).includes("lat"), false);
    const mine = await shares.myActivityShare(co.users[role], "2026-11-04", sql);
    assert.equal(mine?.token, created.token);
  }

  await assert.rejects(shares.createActivityShare(co.users.labor, snapshot("labor"), sql), { name: "ForbiddenError" });
  await assert.rejects(shares.createActivityShare(co.users.sub, snapshot("sub"), sql), { name: "ForbiddenError" });
  await assert.rejects(shares.createActivityShare(co.users.guest, snapshot("guest"), sql), { name: "ForbiddenError" });

  await sharing.setCompanySetting(co.users.owner, { key: "labor_doc_send", value: true }, sql);
  const labor = await shares.createActivityShare(co.users.labor, snapshot("labor caption"), sql);
  assert.equal((await shares.readActivityShare(labor.token, sql))?.entries[0].body, "labor caption");
  await assert.rejects(shares.createActivityShare(co.users.sub, snapshot("sub still"), sql), { name: "ForbiddenError" });
  await sharing.setCompanySetting(co.users.owner, { key: "labor_doc_send", value: false }, sql);
  await assert.rejects(shares.createActivityShare(co.users.labor, snapshot("labor again"), sql), { name: "ForbiddenError" });
  // The link they already made is still theirs to take down.
  assert.equal((await shares.myActivityShare(co.users.labor, "2026-11-04", sql))?.token, labor.token);

  const leadToken = (await shares.myActivityShare(co.users.lead, "2026-11-04", sql))!.token;
  await assert.rejects(shares.revokeActivityShare(co.users.lead, labor.token, sql), { name: "ForbiddenError" });
  await assert.rejects(shares.revokeActivityShare(co.users.labor, leadToken, sql), { name: "ForbiddenError" });
  await assert.rejects(shares.revokeActivityShare(outsider, leadToken, sql), /not available/);

  assert.equal(await shares.readActivityShare("no-such-token-no-such-token-no-such", sql), null);
  await shares.revokeActivityShare(co.users.labor, labor.token, sql);
  assert.equal(await shares.readActivityShare(labor.token, sql), null);
  assert.equal(await shares.myActivityShare(co.users.labor, "2026-11-04", sql), null);

  const first = (await shares.myActivityShare(co.users.owner, "2026-11-04", sql))!.token;
  const second = await shares.createActivityShare(co.users.owner, snapshot("owner again"), sql);
  assert.notEqual(second.token, first);
  assert.equal(await shares.readActivityShare(first, sql), null);
  assert.equal((await shares.readActivityShare(second.token, sql))?.entries[0].body, "owner again");
  await shares.revokeActivityShare(co.users.admin, second.token, sql);
  assert.equal(await shares.readActivityShare(second.token, sql), null);
  const missing = shares.readActivityShare(randomUUID().replace(/-/g, "") + randomUUID().replace(/-/g, ""), sql);
  assert.equal(await missing, null);
});
