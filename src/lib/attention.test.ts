import { test } from "node:test";
import assert from "node:assert/strict";
import { parseAttention } from "./attention.ts";

const reports = [
  { id: "r1", userName: "Luis Moreno", day: "2026-10-10" },
  { id: "r2", userName: "Lena Ortiz", day: "2026-10-11" },
];

test("keeps only items that cite a real report, and attributes person and day", () => {
  const raw = JSON.stringify({
    items: [
      { category: "safety", severity: "high", summary: "Cracked ladder", reportId: "r1", quote: "cracked rail" },
      { category: "delay", severity: "medium", summary: "Invented", reportId: "nope", quote: "" },
      { category: "weird", severity: "?", summary: "Client upset", reportId: "r2", quote: "complained" },
    ],
  });
  const items = parseAttention(raw, reports);
  assert.equal(items.length, 2);
  assert.deepEqual([items[0].person, items[0].day, items[0].severity], ["Luis Moreno", "2026-10-10", "high"]);
  assert.equal(items[1].category, "other");
  assert.equal(items[1].severity, "medium");
});

test("tolerates prose around the JSON and bad output", () => {
  assert.equal(parseAttention('Here you go: {"items":[{"reportId":"r2","summary":"x"}]} thanks', reports).length, 1);
  assert.deepEqual(parseAttention("not json", reports), []);
  assert.deepEqual(parseAttention('{"items":"nope"}', reports), []);
});

test("sorts high before medium before low", () => {
  const raw = JSON.stringify({
    items: [
      { severity: "low", reportId: "r1" },
      { severity: "high", reportId: "r2" },
      { severity: "medium", reportId: "r1" },
    ],
  });
  assert.deepEqual(parseAttention(raw, reports).map((i) => i.severity), ["high", "medium", "low"]);
});

import { attentionPayload, needsFreshAttention, planAttention } from "./attention.ts";

test("payload format is stable, so summaries cached before this change still hit", () => {
  const { payload, withText } = attentionPayload([
    { id: "r1", day: "2026-10-10", userName: "Luis Moreno", projectName: "Whitaker kitchen remodel", narrative: "  Cracked rail on the ladder.  " },
    { id: "r2", day: "2026-10-10", userName: "Lena Ortiz", projectName: "", narrative: "   " },
    { id: "r3", day: "2026-10-09", userName: "Sam Whitfield", projectName: "", narrative: "Rough-in done." },
  ]);
  assert.equal(withText.length, 2);
  assert.equal(
    payload,
    "[report r1] 2026-10-10 · Luis Moreno · Whitaker kitchen remodel\nCracked rail on the ladder.\n\n[report r3] 2026-10-09 · Sam Whitfield\nRough-in done.",
  );
});

test("the instant read never waits on the model", () => {
  const plan = (o: Partial<Parameters<typeof planAttention>[0]>) =>
    planAttention({ reportCount: 3, exactHit: false, latestHit: false, refresh: false, cachedOnly: true, ...o }).kind;
  assert.equal(plan({ exactHit: true, latestHit: true }), "cached");
  assert.equal(plan({ latestHit: true }), "stale");
  assert.equal(plan({}), "pending");
  assert.equal(plan({ reportCount: 0 }), "empty");
  // Refresh skips the cache; only a non-instant call generates.
  assert.equal(plan({ exactHit: true, refresh: true, cachedOnly: false }), "generate");
  assert.equal(plan({ exactHit: true, cachedOnly: false }), "cached");
  assert.equal(plan({ cachedOnly: false }), "generate");
});

test("the client starts fresh work only for pending or stale answers", () => {
  assert.equal(needsFreshAttention("pending", false), true);
  assert.equal(needsFreshAttention("ok", true), true);
  assert.equal(needsFreshAttention("ok", false), false);
  for (const s of ["empty", "no-key", "error"]) assert.equal(needsFreshAttention(s, false), false);
});
