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

test("nav never exceeds 5 tabs and field roles get their own set", () => {
  for (const r of ROLES) assert.ok(navFor(r).length <= 5, r);
  assert.deepEqual(navFor("labor"), ["today", "mine", "activities", "docs", "safety"]);
  assert.deepEqual(navFor("sub"), ["today", "mine", "docs"]);
  assert.deepEqual(navFor("lead"), ["today", "mine", "activities", "docs", "safety"]);
  for (const r of ["owner", "admin", "superadmin"]) {
    assert.deepEqual(navFor(r), ["reports", "attention", "activities", "docs", "safety"], r);
  }
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

test("lead approves activities; labor can add and edit but not approve", () => {
  assert.equal(can("labor", "activity.add"), true);
  assert.equal(can("labor", "activity.edit"), true);
  assert.equal(can("labor", "activity.approve"), false);
  assert.equal(can("lead", "activity.add"), true);
  assert.equal(can("lead", "activity.edit"), true);
  assert.equal(can("lead", "activity.approve"), true);
  assert.equal(can("sub", "activity.add"), false);
  assert.equal(can("owner", "activity.approve"), true);
  assert.throws(() => assertCan("labor", "activity.approve"), /can't do that/);
});

test("safety checks: labor records, lead manages, subs stay out", () => {
  assert.equal(can("labor", "safety.write"), true);
  assert.equal(can("labor", "safety.manage"), false);
  assert.equal(can("lead", "safety.write"), true);
  assert.equal(can("lead", "safety.manage"), true);
  assert.equal(can("sub", "safety.write"), false);
  assert.equal(can("owner", "safety.manage"), true);
  assert.throws(() => assertCan("labor", "safety.manage"), /can't do that/);
});

test("daily JSA: lead and up record it; labor keeps its own orientation but only reads the JSA (spec 05 · F2b)", () => {
  for (const r of ["lead", "owner", "admin", "superadmin"]) assert.equal(can(r, "jsa.write"), true, r);
  for (const r of ["labor", "sub"]) assert.equal(can(r, "jsa.write"), false, r);
  assert.equal(can("labor", "safety.write"), true); // own orientation
  assert.throws(() => assertCan("labor", "jsa.write"), /can't do that/);
});

test("activities: owner and admin can add, edit and approve (spec 05 · F2a)", () => {
  for (const r of ["owner", "admin", "superadmin"]) {
    for (const a of ["activity.add", "activity.edit", "activity.approve"] as const) assert.equal(can(r, a), true, `${r} ${a}`);
  }
});

// Spec 05 · F2c changed this on purpose: labor and subs read documents but no longer create
// them (RFIs included). Labor's doc.send stays until 06's sharing setting replaces it.
test("documents: labor and subs read documents, the lead runs the pipeline, only principals approve money", () => {
  assert.equal(can("labor", "doc.view"), true);
  assert.equal(can("sub", "doc.view"), true);
  for (const r of ["labor", "sub"]) {
    assert.equal(can(r, "doc.create"), false, r);
    assert.equal(can(r, "rfi.create"), false, r);
    assert.throws(() => assertCan(r, "doc.create"), /can't do that/);
  }
  for (const r of ["lead", "owner", "admin", "superadmin"]) assert.equal(can(r, "doc.create"), true, r);
  assert.equal(can("labor", "doc.send"), true); // flips to false with 06 (sharing settings)
  assert.equal(can("labor", "doc.status"), false);
  assert.equal(can("sub", "doc.send"), false);
  assert.equal(can("lead", "doc.status"), true);
  assert.equal(can("lead", "co.status"), false);
  assert.equal(can("owner", "doc.status"), true);
  assert.equal(can("owner", "co.status"), true);
});

test("daily reports: everyone writes, only principals review", () => {
  for (const r of ["labor", "sub", "lead", "owner", "admin", "superadmin"]) assert.ok(can(r, "report.write"), r);
  for (const r of ["labor", "sub", "lead"]) assert.ok(!can(r, "report.review"), r);
  for (const r of ["owner", "admin", "superadmin"]) assert.ok(can(r, "report.review"), r);
});
