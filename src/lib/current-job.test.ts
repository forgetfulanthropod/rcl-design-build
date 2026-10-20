import assert from "node:assert/strict";
import { test } from "node:test";
import { activityMayBeCompanyWide, docMayBeCompanyWide, requireJob, resolveCurrentJob } from "./current-job.ts";

const hints = (o: Partial<{ todayJobId: string | null; recentJobId: string | null; activeJobIds: string[] }> = {}) => ({
  todayJobId: null,
  recentJobId: null,
  activeJobIds: ["whitaker", "garage"],
  ...o,
});

test("current job: today's report wins, then the latest report, then the last pick, then the only job", () => {
  assert.deepEqual(resolveCurrentJob(hints({ todayJobId: "garage", recentJobId: "whitaker" }), "whitaker"), { id: "garage", source: "today" });
  assert.deepEqual(resolveCurrentJob(hints({ recentJobId: "whitaker" }), "garage"), { id: "whitaker", source: "recent" });
  assert.deepEqual(resolveCurrentJob(hints(), "garage"), { id: "garage", source: "last" });
  assert.deepEqual(resolveCurrentJob(hints({ activeJobIds: ["solo"] }), null), { id: "solo", source: "only" });
  assert.deepEqual(resolveCurrentJob(hints(), null), { id: "", source: "none" });
});

test("current job: archived or unknown jobs are never preselected", () => {
  assert.deepEqual(resolveCurrentJob(hints({ todayJobId: "old", recentJobId: "older" }), "gone"), { id: "", source: "none" });
});

test("company-wide is only for policy and bid docs, and owner/admin activities", () => {
  for (const k of ["policy", "bid"]) assert.equal(docMayBeCompanyWide(k), true, k);
  for (const k of ["rfi", "submittal", "change_order", "invoice"]) assert.equal(docMayBeCompanyWide(k), false, k);
  for (const r of ["owner", "admin", "superadmin"]) assert.equal(activityMayBeCompanyWide(r), true, r);
  for (const r of ["lead", "labor", "sub", "subcontractor"]) assert.equal(activityMayBeCompanyWide(r), false, r);
});

test("regression: a job-only form with no job is rejected with 'Pick a job.'", () => {
  assert.throws(() => requireJob("", false), /^Error: Pick a job\.$/);
  assert.doesNotThrow(() => requireJob("", true));
  assert.doesNotThrow(() => requireJob("whitaker", false));
});
