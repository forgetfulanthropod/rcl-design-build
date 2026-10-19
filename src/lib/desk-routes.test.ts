import assert from "node:assert/strict";
import { test } from "node:test";
import { canOpen, defaultPath, pageTitle, safeNext, viewForPath, viewsFor } from "./desk-routes.ts";

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
