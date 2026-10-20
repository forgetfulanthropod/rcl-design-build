import assert from "node:assert/strict";
import { test } from "node:test";
import { NOT_ON_DESK, canOpen, defaultPath, deskRedirect, pageTitle, safeNext, viewForPath, viewsFor } from "./desk-routes.ts";

test("deep links: every desk path maps to its view", () => {
  assert.equal(viewForPath("/reports"), "reports");
  assert.equal(viewForPath("/reports/abc"), "reports");
  assert.equal(viewForPath("/docs/123"), "docs");
  assert.equal(viewForPath("/team"), "team");
  assert.equal(viewForPath("/"), null);
  assert.equal(viewForPath("/login"), null);
});

test("deep links: / goes to the role's first view", () => {
  assert.equal(defaultPath("owner"), "/reports");
  assert.equal(defaultPath("admin"), "/reports");
  assert.equal(defaultPath("lead"), "/today");
  assert.equal(defaultPath("labor"), "/today");
  assert.equal(defaultPath("sub"), "/today");
});

test("deep links: a page that isn't on the desk is refused per role", () => {
  assert.equal(canOpen("labor", "attention"), false);
  assert.equal(canOpen("labor", "reports"), false);
  assert.equal(canOpen("sub", "safety"), false);
  assert.equal(canOpen("sub", "activities"), false);
  assert.equal(canOpen("owner", "today"), false);
  assert.equal(canOpen("owner", "attention"), true);
  assert.equal(canOpen("owner", "team"), true);
  assert.equal(canOpen("labor", "today"), true);
  assert.deepEqual(viewsFor("sub"), ["today", "mine", "docs"]);
});

test("deep links: titles read '<Record> · <View> · RCL'", () => {
  assert.equal(pageTitle("docs", "RFI 004"), "RFI 004 · Docs · RCL");
  assert.equal(pageTitle("reports"), "Reports · RCL");
  assert.equal(pageTitle("mine", "  "), "My reports · RCL");
});

test("deep links: ?next= is same-origin only and never loops back to sign-in", () => {
  assert.equal(safeNext("/docs/abc"), "/docs/abc");
  assert.equal(safeNext("/reports?day=2026-10-19&focus=r1"), "/reports?day=2026-10-19&focus=r1");
  for (const bad of ["https://evil.example/x", "//evil.example", "/\\evil", "javascript:alert(1)", "/login?next=/x", "/m/token", "/api/auth/x", "", null, undefined]) {
    assert.equal(safeNext(bad as string), "/", String(bad));
  }
});

test("deep links: the shell redirects only once the router has settled", () => {
  // Pending transition (e.g. a nav click right after sign-in): never redirect, even from "/".
  assert.equal(deskRedirect("owner", "/", false), null);
  assert.equal(deskRedirect("owner", "/team", false), null);
  assert.equal(deskRedirect("labor", "/attention", false), null);
  // Settled on "/": the role's first view, no notice.
  assert.deepEqual(deskRedirect("owner", "/", true), { to: "/reports", notice: "" });
  assert.deepEqual(deskRedirect("lead", "/", true), { to: "/today", notice: "" });
  // Settled on a view the role can't open: first view with the notice.
  assert.deepEqual(deskRedirect("labor", "/attention", true), { to: "/today", notice: NOT_ON_DESK });
  // Settled on a view the role can open (including the tab just clicked): stay.
  assert.equal(deskRedirect("owner", "/attention", true), null);
  assert.equal(deskRedirect("lead", "/activities", true), null);
  assert.equal(deskRedirect("lead", "/mine", true), null);
  assert.equal(deskRedirect("owner", "/reports/abc", true), null);
  // Desk not loaded yet: no role, no redirect.
  assert.equal(deskRedirect("", "/", true), null);
});

test("deep links: Crew (spec 01) and Sharing settings (spec 06) have URLs, for the roles that have them", () => {
  assert.equal(viewForPath("/crew"), "crew");
  assert.equal(viewForPath("/settings"), "settings");
  for (const role of ["owner", "admin"]) {
    assert.ok(canOpen(role, "crew"), role);
    assert.ok(canOpen(role, "settings"), role);
  }
  assert.ok(canOpen("lead", "crew"));
  assert.equal(canOpen("lead", "settings"), false);
  for (const role of ["labor", "subcontractor"]) {
    assert.equal(canOpen(role, "crew"), false, role);
    assert.equal(canOpen(role, "settings"), false, role);
  }
  assert.equal(pageTitle("settings"), "Sharing settings · RCL");
  assert.equal(pageTitle("crew"), "Crew · RCL");
  assert.deepEqual(deskRedirect("labor", "/crew", true), { to: "/today", notice: NOT_ON_DESK });
  assert.deepEqual(deskRedirect("lead", "/settings", true), { to: "/today", notice: NOT_ON_DESK });
});

test("deep links: Time (spec 02) is /time, for the roles that review hours", () => {
  assert.equal(viewForPath("/time"), "time");
  assert.equal(pageTitle("time"), "Time · RCL");
  for (const role of ["owner", "admin", "lead"]) assert.ok(canOpen(role, "time"), role);
  for (const role of ["labor", "subcontractor"]) {
    assert.equal(canOpen(role, "time"), false, role);
    assert.deepEqual(deskRedirect(role, "/time", true), { to: "/today", notice: NOT_ON_DESK });
  }
});
