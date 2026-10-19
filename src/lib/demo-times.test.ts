import assert from "node:assert/strict";
import { test } from "node:test";
import { demoReportTimes } from "./demo-times.ts";

const local = (day: string, h: number, m: number) => {
  const d = new Date(`${day}T00:00:00`);
  d.setHours(h, m, 0, 0);
  return d;
};
const ms = (iso: string) => new Date(iso).getTime();

function assertOrdered(t: ReturnType<typeof demoReportTimes>, now: Date, day: string) {
  const all = [...t.photos.flatMap((p) => [p.taken, p.created]), t.first, t.last, t.submitted].map(ms);
  for (const v of all) {
    assert.ok(v <= now.getTime(), `${new Date(v).toISOString()} is after now ${now.toISOString()}`);
    assert.ok(v >= local(day, 0, 0).getTime(), "never before the report's own day");
  }
  for (let i = 1; i < all.length; i++) assert.ok(all[i] >= all[i - 1], "photos, then first edit, then submit");
}

test("regression: today's demo report seeded at 9:00 AM isn't submitted in the future", () => {
  const day = "2026-10-19";
  const now = local(day, 9, 0);
  const t = demoReportTimes(day, 0, 2, now);
  assert.ok(ms(t.submitted) < now.getTime());
  assert.equal(t.submitted, t.last);
  assertOrdered(t, now, day);
});

test("every hour of today keeps all times at or before now", () => {
  const day = "2026-10-19";
  for (let h = 0; h < 24; h++) {
    for (const m of [0, 1, 4, 30]) {
      const now = local(day, h, m);
      for (const photos of [0, 1, 3]) assertOrdered(demoReportTimes(day, 0, photos, now), now, day);
    }
  }
});

test("past days keep their usual work-day times", () => {
  const now = local("2026-10-19", 9, 0);
  const t = demoReportTimes("2026-10-17", 2, 1, now);
  assert.equal(ms(t.first), local("2026-10-17", 7, 19).getTime());
  assert.equal(ms(t.submitted), local("2026-10-17", 15, 42).getTime());
  assert.equal(ms(t.photos[0].taken), local("2026-10-17", 7, 2).getTime());
  assert.equal(ms(t.photos[0].created), local("2026-10-17", 7, 3).getTime());
});

test("late in the day, today's report gets the normal times", () => {
  const day = "2026-10-19";
  const t = demoReportTimes(day, 0, 1, local(day, 18, 0));
  assert.equal(ms(t.submitted), local(day, 15, 20).getTime());
  assert.equal(ms(t.first), local(day, 7, 5).getTime());
});
