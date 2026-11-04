import { test } from "node:test";
import assert from "node:assert/strict";
import { photoCaptionHeading } from "./photo-caption.ts";

const clock = (iso: string) => iso.slice(11, 16);

test("photo caption puts camera time on top and marks a file-time fallback", () => {
  assert.equal(photoCaptionHeading({ takenAt: "2026-11-02T08:41:00.000Z", takenSource: "exif" }, clock), "08:41");
  assert.equal(
    photoCaptionHeading({ takenAt: "2026-11-02T10:22:00.000Z", takenSource: "file" }, clock),
    "file time 10:22 (not camera)",
  );
  assert.equal(photoCaptionHeading({ fileTime: "2026-11-02T10:22:00.000Z" }, clock), "file time 10:22 (not camera)");
  // Camera time wins when both are present and the source is the camera.
  assert.equal(
    photoCaptionHeading({ takenAt: "2026-11-02T08:41:00.000Z", fileTime: "2026-11-02T10:22:00.000Z", takenSource: "exif" }, clock),
    "08:41",
  );
  assert.equal(photoCaptionHeading({ takenSource: "file" }, clock), "file time (not camera)");
  assert.equal(photoCaptionHeading({}, clock), "");
  assert.equal(photoCaptionHeading({ takenAt: "not-a-date", takenSource: "exif" }, clock), "");
});
