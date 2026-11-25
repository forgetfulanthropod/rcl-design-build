import { test } from "node:test";
import assert from "node:assert/strict";
import { buildActivityPdf } from "./activity-pdf.ts";
import { extractPdfText } from "./pdf.ts";

function pdfPageCount(bytes: Uint8Array): number {
  const raw = Buffer.from(bytes).toString("latin1");
  const match = raw.match(/\/Type \/Pages \/Kids \[[^\]]+\] \/Count (\d+)/);
  return match ? Number(match[1]) : 0;
}

test("activity PDF puts the creation time above the caption, and still letters saved sessions", () => {
  const bytes = buildActivityPdf({
    dayKey: "2026-11-02",
    dayLabel: "Monday, Nov 2, 2026",
    items: [
      {
        kind: "photo",
        captionTime: "8:41 AM",
        caption: "Rotten posts at the alley line.",
        project: "Project A",
        jpeg: null,
      },
      {
        kind: "photo",
        captionTime: "file time 10:22 AM (not camera)",
        caption: "Counted sheets. One box in the garage is damaged.",
        project: "Project B",
        jpeg: null,
      },
    ],
    sessions: [
      { id: "b", startMin: 13 * 60, endMin: 16 * 60, projectName: "Project B", notes: "drywall takeoffs" },
      { id: "a", startMin: 8 * 60, endMin: 11 * 60 + 30, projectName: "Project A", notes: "demolish fence" },
    ],
  });
  assert.ok(Buffer.from(bytes).toString("latin1").startsWith("%PDF-1.4"));
  const text = extractPdfText(bytes).join("");
  const camera = text.indexOf("8:41 AM");
  const rotten = text.indexOf("Rotten posts at the alley line.");
  const fileTime = text.indexOf("file time 10:22 AM (not camera)");
  const counted = text.indexOf("Counted sheets. One box in the garage is damaged.");
  assert.ok(camera >= 0 && rotten > camera, "camera time is the first line of that caption");
  assert.ok(fileTime > rotten && counted > fileTime, "file time is labeled and sits above its caption");
  assert.match(text, /a {2}Project A demolish fence {3}b {2}Project B drywall takeoffs/);
  assert.ok(text.includes("(not camera)"));
  assert.match(text, /Project A: 3h 30m/);
  assert.match(text, /Project B: 3h/);
  assert.match(text, /Total: 6h 30m/);
});

test("activity PDF project time is the entered session, on that session's project", () => {
  // Charlie, 23 Nov 2026: photos captioned 4:14, 4:16 and 4:18 PM, and a 30-minute Greenville
  // session. The old export printed "Unassigned: 1m" from the gaps between log times.
  const bytes = buildActivityPdf({
    dayKey: "2026-11-23",
    dayLabel: "Monday, Nov 23, 2026",
    items: [
      { kind: "photo", captionTime: "4:18 PM", caption: "", jpeg: null },
      { kind: "photo", captionTime: "4:16 PM", caption: "", jpeg: null },
      { kind: "photo", captionTime: "4:14 PM", caption: "", jpeg: null },
    ],
    sessions: [
      { id: "a", startMin: 16 * 60, endMin: 16 * 60 + 30, projectName: "Greenville", notes: "Shiplap placement, attic access" },
    ],
  });
  const text = extractPdfText(bytes).join("");
  assert.match(text, /a {2}Greenville Shiplap placement, attic access/);
  assert.match(text, /Greenville: 30m/);
  assert.match(text, /Total: 30m/);
  assert.equal(text.includes("Unassigned"), false);
  assert.equal(text.includes(": 1m"), false);
});

test("activity PDF puts four captioned photos on a page and keeps every photo", () => {
  const photos = (count: number) =>
    Array.from({ length: count }, (_, i) => ({
      kind: "photo" as const,
      captionTime: `${i + 1}:00 PM`,
      caption: `Photo ${i + 1}`,
      jpeg: null,
    }));
  const five = buildActivityPdf({
    dayKey: "2026-11-24",
    dayLabel: "Tuesday, Nov 24, 2026",
    items: photos(5),
    sessions: [],
  });
  assert.equal(pdfPageCount(five), 2);
  const text = extractPdfText(five).join("");
  for (let i = 1; i <= 5; i += 1) {
    assert.ok(text.includes(`${i}:00 PM`), `time ${i}`);
    assert.ok(text.includes(`Photo ${i}`), `caption ${i}`);
  }
  assert.equal(pdfPageCount(buildActivityPdf({
    dayKey: "2026-11-24",
    dayLabel: "Tuesday, Nov 24, 2026",
    items: photos(4),
    sessions: [],
  })), 1);
  assert.equal(pdfPageCount(buildActivityPdf({
    dayKey: "2026-11-24",
    dayLabel: "Tuesday, Nov 24, 2026",
    items: photos(8),
    sessions: [],
  })), 2);
});

test("photos with no session do not invent project time", () => {
  const bytes = buildActivityPdf({
    dayKey: "2026-11-23",
    dayLabel: "Monday, Nov 23, 2026",
    items: [
      { kind: "photo", captionTime: "4:14 PM", caption: "Boards staged.", project: "Greenville", jpeg: null },
      { kind: "photo", captionTime: "4:18 PM", caption: "Attic open.", jpeg: null },
    ],
    sessions: [],
  });
  const text = extractPdfText(bytes).join("");
  assert.equal(text.includes("Project time"), false);
  assert.equal(text.includes("Unassigned"), false);
  assert.equal(text.includes("Total:"), false);
});
