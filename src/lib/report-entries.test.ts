import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_ENTRY_TEXT,
  entryStamp,
  legacyEntries,
  legacyPhotoId,
  legacyTextId,
  narrativeOf,
  planTextSave,
  sortEntries,
  type ReportEntry,
} from "./report-entries.ts";

const t = (id: string, createdAt: string, body = id, editedAt: string | null = null): ReportEntry => ({
  id, kind: "text", body, photoId: null, createdAt, editedAt,
});
const p = (id: string, createdAt: string): ReportEntry => ({ id, kind: "photo", body: "", photoId: `ph-${id}`, createdAt, editedAt: null });

test("entries sort oldest first; same instant keeps a stable order by id", () => {
  const list = [t("c", "2026-10-20T15:00:00Z"), p("b", "2026-10-20T13:00:00Z"), t("a2", "2026-10-20T14:00:00Z"), t("a1", "2026-10-20T14:00:00Z")];
  assert.deepEqual(sortEntries(list).map((e) => e.id), ["b", "a1", "a2", "c"]);
  assert.deepEqual(list.map((e) => e.id), ["c", "b", "a2", "a1"], "does not mutate");
});

test("narrative = the non-empty notes in time order, trimmed, a blank line apart (photos skipped)", () => {
  const list = [t("2", "2026-10-20T15:00:00Z", "  Second.  "), p("x", "2026-10-20T14:30:00Z"), t("1", "2026-10-20T14:00:00Z", "First."), t("3", "2026-10-20T16:00:00Z", "   ")];
  assert.equal(narrativeOf(list), "First.\n\nSecond.");
  assert.equal(narrativeOf([p("x", "2026-10-20T14:30:00Z")]), "");
  assert.equal(narrativeOf([]), "");
});

test("legacy report → entries: the narrative is one note at the first edit (edited at the last), each photo at its time; nothing lost", () => {
  const report = { id: "r1", narrative: "Hung drywall.\nRan out of screws.", firstEditAt: "2026-10-20T13:00:00.000Z", lastEditAt: "2026-10-20T20:00:00.000Z", createdAt: "2026-10-20T12:59:00.000Z" };
  const photos = [{ id: "p2", createdAt: "2026-10-20T15:00:00.000Z" }, { id: "p1", createdAt: "2026-10-20T12:30:00.000Z" }];
  const out = legacyEntries(report, photos);
  assert.deepEqual(out, [
    { id: legacyPhotoId("p1"), kind: "photo", body: "", photoId: "p1", createdAt: "2026-10-20T12:30:00.000Z", editedAt: null },
    { id: legacyTextId("r1"), kind: "text", body: report.narrative, photoId: null, createdAt: report.firstEditAt, editedAt: report.lastEditAt },
    { id: legacyPhotoId("p2"), kind: "photo", body: "", photoId: "p2", createdAt: "2026-10-20T15:00:00.000Z", editedAt: null },
  ]);
  assert.equal(narrativeOf(out), report.narrative.trim(), "the narrative reads back the same");
  assert.equal(out.filter((e) => e.kind === "photo").length, photos.length, "every photo kept");
});

test("legacy edge cases: blank narrative makes no note; no first edit falls back to created; same first/last isn't 'edited'", () => {
  assert.deepEqual(legacyEntries({ id: "r", narrative: "  ", firstEditAt: null, lastEditAt: null, createdAt: "2026-10-20T12:00:00.000Z" }, []), []);
  const [only] = legacyEntries({ id: "r", narrative: "x", firstEditAt: null, lastEditAt: "2026-10-20T12:00:00.000Z", createdAt: "2026-10-20T12:00:00.000Z" }, []);
  assert.equal(only.createdAt, "2026-10-20T12:00:00.000Z");
  assert.equal(only.editedAt, null);
  assert.equal(legacyTextId("abc"), "legacy-text-abc");
  assert.equal(legacyPhotoId("abc"), "legacy-photo-abc");
});

test("planTextSave: new text is added, changed text updated, cleared text removed, unchanged and blank drafts left alone", () => {
  const current = [t("a", "2026-10-20T13:00:00Z", "Alpha"), t("b", "2026-10-20T14:00:00Z", "Bravo"), t("c", "2026-10-20T15:00:00Z", "Charlie"), p("ph", "2026-10-20T15:30:00Z")];
  const plan = planTextSave(current, [
    { id: "a", key: "a", body: "Alpha" }, // unchanged
    { id: "b", key: "b", body: "Bravo two" }, // changed
    { id: "c", key: "c", body: "   " }, // cleared
    { id: null, key: "k1", body: "New note" },
    { id: null, key: "k2", body: "  " }, // blank draft
    { id: "ph", key: "ph", body: "can't turn a photo into text" },
    { id: "nope", key: "nope", body: "not this report's" },
  ]);
  assert.deepEqual(plan, { insert: [{ key: "k1", body: "New note" }], update: [{ id: "b", body: "Bravo two" }], remove: ["c"] });
});

test("planTextSave: duplicates in one save count once; text is capped at the max", () => {
  const current = [t("a", "2026-10-20T13:00:00Z", "Alpha")];
  const long = "x".repeat(MAX_ENTRY_TEXT + 50);
  const plan = planTextSave(current, [
    { id: null, key: "k", body: "one" },
    { id: null, key: "k", body: "one again" },
    { id: "a", key: "a", body: long },
    { id: "a", key: "a", body: "second edit ignored" },
  ]);
  assert.equal(plan.insert.length, 1);
  assert.equal(plan.update.length, 1);
  assert.equal(plan.update[0].body.length, MAX_ENTRY_TEXT);
});

test("entryStamp shows the time, plus 'edited' when it changed later", () => {
  const clock = (iso: string) => iso.slice(11, 16);
  assert.equal(entryStamp({ createdAt: "2026-10-20T08:14:00Z", editedAt: null }, clock), "08:14");
  assert.equal(entryStamp({ createdAt: "2026-10-20T08:14:00Z", editedAt: "2026-10-20T09:02:00Z" }, clock), "08:14 · edited 09:02");
  assert.equal(entryStamp({ createdAt: "2026-10-20T08:14:00Z", editedAt: "2026-10-20T08:14:30Z" }, clock), "08:14", "same minute: no noise");
});
