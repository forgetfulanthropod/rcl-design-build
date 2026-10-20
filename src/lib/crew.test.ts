import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CERT_EXPIRING_DAYS,
  addDays,
  certHealth,
  certHealthLabel,
  collidingParts,
  findDoubleBooks,
  formatWeekLabel,
  partsOverlap,
  shortJobName,
  weekDays,
  weekStart,
  worstCertHealth,
} from "./crew.ts";

test("CERT_EXPIRING_DAYS is the named 30-day window [DECIDE]", () => {
  assert.equal(CERT_EXPIRING_DAYS, 30);
});

test("weekStart lands on Monday", () => {
  // 2026-10-19 is a Monday
  assert.equal(weekStart("2026-10-19"), "2026-10-19");
  assert.equal(weekStart("2026-10-21"), "2026-10-19"); // Wed
  assert.equal(weekStart("2026-10-25"), "2026-10-19"); // Sun → prior Mon
  assert.deepEqual(weekDays("2026-10-19"), ["2026-10-19", "2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23", "2026-10-24"]);
  assert.equal(formatWeekLabel("2026-10-19"), "Oct 19–24");
});

test("certHealth: ok / expiring / expired / missing relative to onDay", () => {
  const day = "2026-10-19";
  assert.equal(certHealth(null, day), "missing");
  assert.equal(certHealth("2026-10-18", day), "expired");
  assert.equal(certHealth("2026-11-05", day), "expiring"); // within 30 days
  assert.equal(certHealth("2026-11-18", day), "expiring"); // exactly +30
  assert.equal(certHealth("2026-11-19", day), "ok"); // day after window
  assert.equal(certHealthLabel("expiring"), "Expiring");
  assert.equal(worstCertHealth(["ok", "expiring", "ok"]), "expiring");
  assert.equal(worstCertHealth(["ok", "expired", "expiring"]), "expired");
});

test("partsOverlap: full blocks am and pm; am does not block pm", () => {
  assert.deepEqual(collidingParts("full"), ["full", "am", "pm"]);
  assert.deepEqual(collidingParts("am"), ["full", "am"]);
  assert.equal(partsOverlap("full", "am"), true);
  assert.equal(partsOverlap("am", "pm"), false);
  assert.equal(partsOverlap("am", "full"), true);
});

test("findDoubleBooks catches two jobs on the same half-day", () => {
  const hits = findDoubleBooks([
    { userId: "luis", projectId: "whitaker", day: "2026-10-19", part: "full" },
    { userId: "luis", projectId: "oak", day: "2026-10-19", part: "am" },
    { userId: "luis", projectId: "oak", day: "2026-10-20", part: "full" },
  ]);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].day, "2026-10-19");
  assert.equal(findDoubleBooks([{ userId: "luis", projectId: "w", day: "2026-10-19", part: "am" }, { userId: "luis", projectId: "o", day: "2026-10-19", part: "pm" }]).length, 0);
});

test("shortJobName and addDays", () => {
  assert.equal(shortJobName("Whitaker kitchen remodel"), "Whitaker");
  assert.equal(addDays("2026-10-19", 7), "2026-10-26");
});
