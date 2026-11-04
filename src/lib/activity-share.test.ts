import { test } from "node:test";
import assert from "node:assert/strict";
import { mayDownloadPdf } from "./server/entries.server.ts";
import { SHARING_DEFAULTS, type Sharing } from "./sharing.ts";
import { ROLES } from "./roles.ts";
import { mayShareActivity, sanitizeActivityShare } from "./activity-share.ts";

const svg = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"/>')}`;

const day = {
  day: "2026-11-02",
  entries: [
    {
      id: "p1",
      kind: "photo",
      body: "  Rotten posts at the alley line.  ",
      image: svg,
      takenAt: "2026-11-02T08:41:00.000Z",
      takenSource: "exif",
      project: "Project A",
      ts: "2026-11-02T08:40:00.000Z",
      lat: 38.04,
      lng: -84.5,
    },
    {
      id: "p2",
      kind: "photo",
      body: "Counted sheets.",
      dataUrl: svg,
      fileTime: "2026-11-02T10:22:00.000Z",
      takenSource: "file",
      project: "Project B",
      ts: "2026-11-02T10:22:00.000Z",
    },
  ],
  sessions: [{ id: "ss-a", startMin: 8 * 60, endMin: 11 * 60 + 30, project: "Project A", notes: "demolish fence" }],
};

test("a private link follows document sending: principals and leads may; labor only when the setting is on; subs never", () => {
  const off: Sharing = { ...SHARING_DEFAULTS };
  const on: Sharing = { ...SHARING_DEFAULTS, labor_doc_send: true };
  for (const role of ["owner", "admin", "superadmin", "lead"] as const) {
    assert.equal(mayShareActivity(role, off), true, role);
    assert.equal(mayShareActivity(role, on), true, role);
  }
  assert.equal(mayShareActivity("labor", off), false);
  assert.equal(mayShareActivity("labor", on), true);
  assert.equal(mayShareActivity("sub", off), false);
  assert.equal(mayShareActivity("sub", on), false);
  assert.equal(mayShareActivity("subcontractor", on), false);
  assert.equal(mayShareActivity("hacker", on), false);
  assert.equal(mayShareActivity("field", off), false); // legacy field → labor, setting still off
  assert.equal(mayShareActivity("field", on), true);
  for (const role of ROLES) {
    assert.equal(mayShareActivity(role, off), mayDownloadPdf(role, true, off), `${role} off`);
    assert.equal(mayShareActivity(role, on), mayDownloadPdf(role, true, on), `${role} on`);
  }
});

test("sanitize keeps the caption and the file-time mark, and leaves location off the link", () => {
  const parsed = sanitizeActivityShare(day);
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  const json = JSON.stringify(parsed.value);
  assert.equal(json.includes("38.04"), false);
  assert.equal(json.includes("lat"), false);
  assert.equal(json.includes("lng"), false);
  assert.equal(parsed.value.entries[0].body, "Rotten posts at the alley line.");
  assert.equal(parsed.value.entries[0].takenSource, "exif");
  assert.equal(parsed.value.entries[1].takenSource, "file");
  assert.equal(parsed.value.entries[1].takenAt, "2026-11-02T10:22:00.000Z");
  assert.equal(parsed.value.entries[1].image?.startsWith("data:image/svg+xml,"), true);
  assert.equal(parsed.value.sessions[0].project, "Project A");
  assert.equal(parsed.value.sessions[0].notes, "demolish fence");
});

test("sanitize refuses a non-photo and an empty day", () => {
  const bad = sanitizeActivityShare({
    day: "2026-11-02",
    entries: [{ id: "x", kind: "photo", body: "nope", image: "data:text/html,hi", takenSource: "exif" }],
    sessions: [],
  });
  assert.equal(bad.ok, false);
  const empty = sanitizeActivityShare({ day: "2026-11-02", entries: [], sessions: [] });
  assert.equal(empty.ok, false);
  const long = sanitizeActivityShare({
    day: "2026-11-02",
    entries: [{ id: "n", kind: "text", body: "x".repeat(2000), ts: "2026-11-02T08:00:00.000Z" }],
    sessions: [],
  });
  assert.equal(long.ok, true);
  if (long.ok) assert.equal(long.value.entries[0].body.length, 800);
});
