import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { activityPhotoPageCount, buildActivityPdf, PHOTOS_PER_PDF_PAGE } from "./activity-pdf.ts";
import { extractPdfText } from "./pdf.ts";

const PHOTO = new Uint8Array(
  readFileSync(new URL("../../e2e/fixtures/site-photo.jpg", import.meta.url)),
);

/** Page content streams (not JPEG image streams), in order. */
function pageStreams(bytes: Uint8Array): string[] {
  const raw = Buffer.from(bytes).toString("latin1");
  const out: string[] = [];
  const re = /<<([^>]*)>>\nstream\n/g;
  for (const match of raw.matchAll(re)) {
    if (match[1].includes("/Subtype /Image")) continue;
    const len = Number(/\/Length (\d+)/.exec(match[1])?.[1] ?? 0);
    const start = match.index! + match[0].length;
    out.push(raw.slice(start, start + len));
  }
  return out;
}

function textPages(bytes: Uint8Array): string[][] {
  const pages: string[][] = [[]];
  for (const line of extractPdfText(bytes)) {
    pages[pages.length - 1].push(line);
    if (/Page \d+ of \d+$/.test(line)) pages.push([]);
  }
  if (pages.at(-1)?.length === 0) pages.pop();
  return pages;
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
      {
        id: "b",
        startMin: 13 * 60,
        endMin: 16 * 60,
        projectName: "Project B",
        notes: "drywall takeoffs",
      },
      {
        id: "a",
        startMin: 8 * 60,
        endMin: 11 * 60 + 30,
        projectName: "Project A",
        notes: "demolish fence",
      },
    ],
  });
  assert.ok(Buffer.from(bytes).toString("latin1").startsWith("%PDF-1.4"));
  const text = extractPdfText(bytes).join("");
  const camera = text.indexOf("8:41 AM");
  const rotten = text.indexOf("Rotten posts at the alley line.");
  const fileTime = text.indexOf("file time 10:22 AM (not camera)");
  const counted = text.indexOf("Counted sheets. One box in the garage is damaged.");
  assert.ok(camera >= 0 && rotten > camera, "camera time is the first line of that caption");
  assert.ok(
    fileTime > rotten && counted > fileTime,
    "file time is labeled and sits above its caption",
  );
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
      {
        id: "a",
        startMin: 16 * 60,
        endMin: 16 * 60 + 30,
        projectName: "Greenville",
        notes: "Shiplap placement, attic access",
      },
    ],
  });
  const text = extractPdfText(bytes).join("");
  assert.match(text, /a {2}Greenville Shiplap placement, attic access/);
  assert.match(text, /Greenville: 30m/);
  assert.match(text, /Total: 30m/);
  assert.equal(text.includes("Unassigned"), false);
  assert.equal(text.includes(": 1m"), false);
});

test("five photos fill two pages of a 2x2 grid, and every photo is included", () => {
  assert.equal(PHOTOS_PER_PDF_PAGE, 4);
  assert.equal(activityPhotoPageCount(5), 2);
  assert.equal(activityPhotoPageCount(4), 1);
  assert.equal(activityPhotoPageCount(0), 0);
  const items = [1, 2, 3, 4, 5].map((n) => ({
    kind: "photo" as const,
    captionTime: `4:${10 + n} PM`,
    caption: `Cap ${n}`,
    jpeg: PHOTO,
  }));
  const bytes = buildActivityPdf({
    dayKey: "2026-11-23",
    dayLabel: "Monday, Nov 23, 2026",
    items,
    sessions: [
      {
        id: "a",
        startMin: 16 * 60,
        endMin: 16 * 60 + 30,
        projectName: "Greenville",
        notes: "Shiplap placement",
      },
    ],
  });
  const raw = Buffer.from(bytes).toString("latin1");
  assert.equal((raw.match(/\/Subtype \/Image/g) ?? []).length, 5, "every photo is embedded");
  const streams = pageStreams(bytes);
  const imageCounts = streams.map((stream) => (stream.match(/\/Im\d+ Do/g) ?? []).length);
  const photoStreams = imageCounts.filter((count) => count > 0);
  assert.deepEqual(
    photoStreams,
    [4, 1],
    "first photo page has four pictures, the next has the fifth",
  );
  const photoPages = textPages(bytes).filter((page) => page.some((line) => /^Cap \d$/.test(line)));
  assert.equal(photoPages.length, 2);
  assert.deepEqual(
    photoPages[0].filter((line) => /^Cap \d$/.test(line)),
    ["Cap 1", "Cap 2", "Cap 3", "Cap 4"],
  );
  assert.deepEqual(
    photoPages[1].filter((line) => /^Cap \d$/.test(line)),
    ["Cap 5"],
  );
  const text = extractPdfText(bytes).join("");
  for (const n of [1, 2, 3, 4, 5])
    assert.ok(text.includes(`Cap ${n}`), `caption ${n} is in the PDF`);
  assert.match(text, /Greenville/);
  assert.match(text, /Shiplap placement/);
});

test("photos with no session do not invent project time", () => {
  const bytes = buildActivityPdf({
    dayKey: "2026-11-23",
    dayLabel: "Monday, Nov 23, 2026",
    items: [
      {
        kind: "photo",
        captionTime: "4:14 PM",
        caption: "Boards staged.",
        project: "Greenville",
        jpeg: null,
      },
      { kind: "photo", captionTime: "4:18 PM", caption: "Attic open.", jpeg: null },
    ],
    sessions: [],
  });
  const text = extractPdfText(bytes).join("");
  assert.equal(text.includes("Project time"), false);
  assert.equal(text.includes("Unassigned"), false);
  assert.equal(text.includes("Total:"), false);
});
