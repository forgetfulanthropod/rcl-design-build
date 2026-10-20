import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  MAX_STORED_BYTES,
  MAX_UPLOAD_BYTES,
  QUALITY_LADDER,
  dataUrlBytes,
  exifIso,
  exifTakenAt,
  firstThatFits,
  isHeic,
  plausibleTakenAt,
  tooLargeMessage,
} from "./photo-upload.ts";
import { takenLabel } from "./report-entries.ts";

const fixture = (name: string) => new Uint8Array(readFileSync(new URL(`../../e2e/fixtures/${name}`, import.meta.url)));

/** A minimal big-endian JPEG with an EXIF sub-IFD holding DateTimeOriginal and OffsetTimeOriginal. */
function jpegWithExif(dateTime: string, offset?: string): Uint8Array {
  const strings: [number, string][] = [[0x9003, `${dateTime}\0`]];
  if (offset) strings.push([0x9011, `${offset}\0`]);
  const tiff: number[] = [0x4d, 0x4d, 0, 42, 0, 0, 0, 8];
  const u16 = (v: number) => [(v >> 8) & 255, v & 255];
  const u32 = (v: number) => [(v >>> 24) & 255, (v >> 16) & 255, (v >> 8) & 255, v & 255];
  // IFD0 at 8: one entry (ExifIFD pointer) → sub-IFD at 26
  tiff.push(...u16(1), ...u16(0x8769), ...u16(4), ...u32(1), ...u32(26), ...u32(0));
  const subStart = 26;
  const dataStart = subStart + 2 + strings.length * 12 + 4;
  const data: number[] = [];
  tiff.push(...u16(strings.length));
  for (const [tag, value] of strings) {
    tiff.push(...u16(tag), ...u16(2), ...u32(value.length), ...u32(dataStart + data.length));
    for (const ch of value) data.push(ch.charCodeAt(0));
  }
  tiff.push(...u32(0), ...data);
  const app1 = [...Array.from("Exif\0\0", (c) => c.charCodeAt(0)), ...tiff];
  return new Uint8Array([0xff, 0xd8, 0xff, 0xe1, ...u16(app1.length + 2), ...app1, 0xff, 0xd9]);
}

test("upload size limit: up to 40 MB is fine; bigger is refused with a clear message", () => {
  assert.equal(tooLargeMessage(MAX_UPLOAD_BYTES), null);
  assert.equal(tooLargeMessage(5_000_000), null);
  assert.equal(tooLargeMessage(MAX_UPLOAD_BYTES + 1), "That photo is 40 MB. Photos up to 40 MB can be added.");
  assert.match(tooLargeMessage(52 * 1024 * 1024)!, /^That photo is 52 MB\./);
});

test("HEIC is recognised by type, by extension, or by its ftyp brand (iPhone files often come with no type)", () => {
  assert.equal(isHeic({ type: "image/heic", name: "a" }), true);
  assert.equal(isHeic({ type: "image/heif" }), true);
  assert.equal(isHeic({ type: "", name: "IMG_0412.HEIC" }), true);
  assert.equal(isHeic({ type: "", name: "blob" }, fixture("site-photo.heic").subarray(0, 32)), true);
  assert.equal(isHeic({ type: "image/jpeg", name: "a.jpg" }, fixture("site-photo.jpg").subarray(0, 32)), false);
  assert.equal(isHeic({}), false);
});

test("compression ladder: the first quality whose JPEG fits the stored limit wins; none fitting → null", () => {
  const sizes: Record<number, number> = { 0.82: 4_000_000, 0.72: 3_500_000, 0.6: 2_000_000, 0.5: 1_000_000 };
  const tried: number[] = [];
  const fake = (bytes: number) => `data:image/jpeg;base64,${"A".repeat(Math.ceil((bytes * 4) / 3))}`;
  const out = firstThatFits((q) => (tried.push(q), { url: fake(sizes[q]), q }));
  assert.equal(out?.q, 0.6);
  assert.deepEqual(tried, [0.82, 0.72, 0.6]);
  assert.equal(firstThatFits(() => ({ url: fake(MAX_STORED_BYTES + 10) })), null);
  assert.deepEqual([...QUALITY_LADDER], [0.82, 0.72, 0.6, 0.5]);
  assert.equal(dataUrlBytes("data:image/jpeg;base64,QUJD"), 3);
  assert.equal(dataUrlBytes("data:image/jpeg;base64,QUI="), 2);
});

test("EXIF taken-at: read from a real camera-style JPEG (little-endian) and a big-endian one with an offset", () => {
  assert.deepEqual(exifTakenAt(fixture("exif-photo.jpg")), { local: "2026-10-20T06:45:00", offset: null });
  assert.deepEqual(exifTakenAt(jpegWithExif("2026:10:19 17:30:05", "-04:00")), { local: "2026-10-19T17:30:05", offset: "-04:00" });
  assert.equal(exifIso({ local: "2026-10-19T17:30:05", offset: "-04:00" }), "2026-10-19T21:30:05.000Z");
  // no EXIF, not a JPEG, or a blank camera clock → nothing
  assert.equal(exifTakenAt(fixture("site-photo.jpg")), null);
  assert.equal(exifTakenAt(fixture("site-photo.heic")), null);
  assert.equal(exifTakenAt(jpegWithExif("0000:00:00 00:00:00")), null);
  assert.equal(exifTakenAt(new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0, 1])), null, "garbage length doesn't throw");
  assert.equal(exifIso(null), null);
});

test("a stored taken-at must be plausible: not before 2000, not more than a day ahead", () => {
  const now = Date.parse("2026-10-20T12:00:00Z");
  assert.equal(plausibleTakenAt("2026-10-20T10:45:00Z", now), "2026-10-20T10:45:00.000Z");
  assert.equal(plausibleTakenAt("1999-12-31T00:00:00Z", now), null);
  assert.equal(plausibleTakenAt("2026-10-22T12:00:00Z", now), null);
  assert.equal(plausibleTakenAt("not a date", now), null);
  assert.equal(plausibleTakenAt(null, now), null);
});

test("takenLabel: shown only when the camera time differs from when it was added; the date shows if it's another day", () => {
  const fmt = { clock: (v: string) => v.slice(11, 16), dayKey: (v: string) => v.slice(0, 10), shortDay: (v: string) => `D${v.slice(8, 10)}` };
  assert.equal(takenLabel("2026-10-20T06:45:00Z", "2026-10-20T09:00:00Z", fmt), "taken 06:45");
  assert.equal(takenLabel("2026-10-18T06:45:00Z", "2026-10-20T09:00:00Z", fmt), "taken D18, 06:45");
  assert.equal(takenLabel("2026-10-20T09:00:20Z", "2026-10-20T09:00:00Z", fmt), "", "same minute: added = taken");
  assert.equal(takenLabel(null, "2026-10-20T09:00:00Z", fmt), "");
});
