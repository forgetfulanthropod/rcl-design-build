import { test } from "node:test";
import assert from "node:assert/strict";
import { buildActivityPdf } from "./activity-pdf.ts";
import { extractPdfText } from "./pdf.ts";

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
      { id: "b", startMin: 13 * 60, projectName: "Project B", notes: "drywall takeoffs" },
      { id: "a", startMin: 8 * 60, projectName: "Project A", notes: "demolish fence" },
    ],
    projectTimes: [],
    totalLabel: "0m",
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
});
