import { test } from "node:test";
import assert from "node:assert/strict";
import { ACTIONS, assertCan, can, invitableRoles, navFor, redactForRole } from "./permissions.ts";
import { normalizeRole, roleLabel, ROLES } from "./roles.ts";

test("legacy roles map to personas", () => {
  assert.equal(normalizeRole("field"), "labor");
  assert.equal(normalizeRole("superintendent"), "lead");
  assert.equal(normalizeRole("pm"), "admin");
  assert.equal(normalizeRole("office"), "admin");
  assert.equal(normalizeRole("Subcontractor"), "sub");
  assert.equal(normalizeRole("nope"), null);
  assert.equal(roleLabel("field"), "Labor");
  assert.equal(roleLabel("sub"), "Subcontractor");
});

test("owner and admin have full access except code approval", () => {
  for (const a of ACTIONS) {
    assert.equal(can("superadmin", a), true, a);
    if (a !== "code.approve") assert.equal(can("owner", a), true, a);
  }
  assert.equal(can("admin", "code.approve"), false);
  assert.equal(can("owner", "code.approve"), false);
  assert.equal(can("admin", "money.view"), true);
});

test("field roles never see money or create jobs, COs, dispatches", () => {
  for (const r of ["labor", "sub", "field"]) {
    for (const a of ["money.view", "project.create", "co.create", "co.status", "workorder.create", "workorder.update", "crew.invite", "project.archive", "foreman.use"] as const) {
      assert.equal(can(r, a), false, `${r} ${a}`);
    }
    assert.equal(can(r, "workorder.updateOwn"), true);
    assert.throws(() => assertCan(r, "project.create"), /can't do that/);
  }
});

test("lead runs the site but not money or invites", () => {
  assert.equal(can("lead", "workorder.create"), true);
  assert.equal(can("lead", "workorder.update"), true);
  assert.equal(can("lead", "money.view"), false);
  assert.equal(can("lead", "crew.invite"), false);
  assert.equal(can("lead", "project.create"), false);
});

test("unknown role can do nothing", () => {
  for (const a of ACTIONS) assert.equal(can("hacker", a), false);
});

test("nav never exceeds 5 tabs and field roles get 3", () => {
  for (const r of ROLES) assert.ok(navFor(r).length <= 5, r);
  assert.deepEqual(navFor("labor"), ["desk", "field", "comms"]);
  assert.ok(!navFor("lead").includes("foreman"));
  assert.ok(navFor("superadmin").includes("foreman"));
});

test("invitable roles", () => {
  assert.deepEqual(invitableRoles("labor"), []);
  assert.ok(!invitableRoles("admin").includes("admin"));
  assert.ok(invitableRoles("superadmin").includes("admin"));
  assert.ok(!invitableRoles("superadmin").includes("superadmin"));
});

test("redactForRole strips dollars for labor and sub only", () => {
  const data = { projects: [{ contractValue: 125000 }], changeOrders: [{ amount: 4000 }] };
  const labor = redactForRole("labor", data);
  assert.equal(labor.projects[0].contractValue, 0);
  assert.equal(labor.changeOrders[0].amount, 0);
  assert.equal(labor.moneyHidden, true);
  assert.equal(redactForRole("sub", data).moneyHidden, true);
  assert.equal(redactForRole("lead", data).moneyHidden, true);
  const owner = redactForRole("owner", data);
  assert.equal(owner.projects[0].contractValue, 125000);
  assert.equal(data.projects[0].contractValue, 125000, "input not mutated");
});
