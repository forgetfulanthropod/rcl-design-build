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
