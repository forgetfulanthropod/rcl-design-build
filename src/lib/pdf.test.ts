import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PdfDoc, extractPdfText, jpegInfo, pdfString, textWidth, toWinAnsi, wrapText } from "./pdf.ts";
import { buildReportPdf, reportPdfFileName, type ReportPdfModel } from "./report-pdf.ts";

const PHOTO = new Uint8Array(readFileSync(new URL("../../e2e/fixtures/site-photo.jpg", import.meta.url)));
const latin1 = (bytes: Uint8Array) => Buffer.from(bytes).toString("latin1");

/** Header, EOF, xref at startxref, and every xref offset pointing at its own "n 0 obj". */
function assertValidPdf(bytes: Uint8Array) {
  const raw = latin1(bytes);
  assert.ok(raw.startsWith("%PDF-1.4\n"), "header");
  assert.ok(raw.endsWith("%%EOF\n"), "eof");
  const start = Number(/startxref\n(\d+)\n%%EOF\n$/.exec(raw)![1]);
  assert.equal(raw.slice(start, start + 4), "xref");
  const size = Number(/\/Size (\d+)/.exec(raw)![1]);
  const offsets = [...raw.slice(start).matchAll(/^(\d{10}) 00000 n $/gm)].map((m) => Number(m[1]));
  assert.equal(offsets.length, size - 1);
  offsets.forEach((at, i) => assert.equal(raw.slice(at, at + `${i + 1} 0 obj`.length), `${i + 1} 0 obj`, `object ${i + 1}`));
  for (const m of raw.matchAll(/<< \/Length (\d+)[^>]*>>\nstream\n/g)) {
    const begin = m.index! + m[0].length;
    assert.equal(raw.slice(begin + Number(m[1]), begin + Number(m[1]) + 10), "\nendstream", "stream length");
  }
  return raw;
}

test("WinAnsi: ASCII and Latin-1 pass through, smart punctuation maps, odd spaces become spaces, the rest is '?'", () => {
  assert.deepEqual(toWinAnsi("Ab 1"), [65, 98, 32, 49]);
  assert.deepEqual(toWinAnsi("café"), [99, 97, 102, 0xe9]);
  assert.deepEqual(toWinAnsi("“—’…•"), [0x93, 0x97, 0x92, 0x85, 0x95]);
  assert.deepEqual(toWinAnsi("7:02\u202fAM"), toWinAnsi("7:02 AM"));
  assert.deepEqual(toWinAnsi("日😀"), [0x3f, 0x3f]);
});

test("pdfString escapes parentheses, backslashes and high bytes", () => {
  assert.equal(pdfString("a (b) \\ c"), "(a \\(b\\) \\\\ c)");
  assert.equal(pdfString("é—"), "(\\351\\227)");
});

test("wrapText fits the width, keeps blank lines, and breaks a word longer than a line", () => {
  const lines = wrapText("one two three four five six seven eight nine ten\n\nend", 12, 100);
  for (const line of lines) assert.ok(textWidth(line, 12) <= 100, line);
  assert.equal(lines.join(" ").replace(/\s+/g, " "), "one two three four five six seven eight nine ten end");
  assert.ok(lines.includes(""));
  const broken = wrapText("x".repeat(80), 12, 100);
  assert.ok(broken.length > 1);
  assert.equal(broken.join(""), "x".repeat(80));
});

test("jpegInfo reads size and components from the JPEG header; not a JPEG → null", () => {
  assert.deepEqual(jpegInfo(PHOTO), { width: 1200, height: 900, components: 3 });
  assert.equal(jpegInfo(new Uint8Array([0x89, 0x50, 0x4e, 0x47])), null);
  assert.equal(jpegInfo(new Uint8Array([])), null);
});

test("PdfDoc writes a valid PDF; the text reads back exactly; a JPEG is embedded as DCTDecode", () => {
  const doc = new PdfDoc();
  doc.paragraph("Hello (world) — café \\ done", 12);
  assert.equal(doc.jpeg(PHOTO), true);
  assert.equal(doc.jpeg(new Uint8Array([1, 2, 3])), false, "non-JPEG is skipped");
  const bytes = doc.render({ title: "T", footer: (i, n) => `Page ${i} of ${n}` });
  const raw = assertValidPdf(bytes);
  assert.deepEqual(extractPdfText(bytes), ["Hello (world) — café \\ done", "Page 1 of 1"]);
  assert.equal((raw.match(/\/Subtype \/Image/g) ?? []).length, 1);
  assert.match(raw, /\/Width 1200 \/Height 900 \/ColorSpace \/DeviceRGB \/BitsPerComponent 8 \/Filter \/DCTDecode/);
});

test("long content flows onto more pages, each with its footer", () => {
  const doc = new PdfDoc();
  for (let i = 0; i < 120; i += 1) doc.paragraph(`Line ${i}`, 12);
  const bytes = doc.render({ title: "T", footer: (i, n) => `Page ${i} of ${n}` });
  assertValidPdf(bytes);
  const text = extractPdfText(bytes);
  assert.ok(doc.pages.length >= 3);
  assert.deepEqual(text.filter((s) => s.startsWith("Page ")), doc.pages.map((_, i) => `Page ${i + 1} of ${doc.pages.length}`));
  assert.deepEqual(text.filter((s) => s.startsWith("Line ")), Array.from({ length: 120 }, (_, i) => `Line ${i}`));
});

const MODEL: ReportPdfModel = {
  job: "Oak Street duplex addition",
  day: "Tuesday, Oct 20, 2026",
  author: "Luis Moreno",
  firstEdit: "7:02 AM",
  lastEdit: "3:10 PM",
  lunch: "30 min",
  status: "Not submitted yet",
  generated: "Oct 20, 3:12 PM",
  entries: [
    { kind: "text", stamp: "7:02 AM", body: "Hung drywall in the hallway." },
    { kind: "photo", stamp: "7:30 AM", jpeg: PHOTO },
    { kind: "text", stamp: "8:00 AM · edited 9:15 AM", body: "Ran out of screws by 2pm." },
    { kind: "photo", stamp: "9:30 AM", jpeg: null },
  ],
};

test("report PDF: job, date, author, then every entry in order under its time stamp; photos embedded", () => {
  const bytes = buildReportPdf(MODEL);
  const raw = assertValidPdf(bytes);
  const text = extractPdfText(bytes);
  assert.deepEqual(text.slice(0, 5), [
    "Daily report",
    "Job: Oak Street duplex addition",
    "Date: Tuesday, Oct 20, 2026",
    "Author: Luis Moreno",
    "First edit 7:02 AM · Last edit 3:10 PM · Lunch 30 min · Not submitted yet",
  ]);
  assert.deepEqual(text.slice(5, 11), [
    "7:02 AM · Note",
    "Hung drywall in the hallway.",
    "7:30 AM · Photo",
    "8:00 AM · edited 9:15 AM · Note",
    "Ran out of screws by 2pm.",
    "9:30 AM · Photo",
  ]);
  assert.equal(text[11], "(This photo could not be included.)");
  assert.equal((raw.match(/\/Subtype \/Image/g) ?? []).length, 1);
  assert.match(raw, /\/Title \(Daily report \\267 Luis Moreno \\267 Tuesday, Oct 20, 2026\)/);
  assert.ok(!text.join(" ").includes("$"), "no money in a report PDF");
});

test("report PDF with nothing written says so; a photo never splits from its time stamp", () => {
  assert.ok(extractPdfText(buildReportPdf({ ...MODEL, entries: [] })).includes("Nothing added yet."));
  const many = buildReportPdf({ ...MODEL, entries: Array.from({ length: 5 }, (_, i) => ({ kind: "photo" as const, stamp: `${i + 1}:00 PM`, jpeg: PHOTO })) });
  assertValidPdf(many);
  // Each page's content stream: every stamp on it is followed by its image on the same page.
  const raw = latin1(many);
  const pages = [...raw.matchAll(/stream\n(BT [\s\S]*?)\nendstream/g)].map((m) => m[1]);
  let stamps = 0;
  for (const page of pages) {
    const s = (page.match(/\\267 Photo\) Tj/g) ?? []).length;
    const imgs = (page.match(/ Do Q/g) ?? []).length;
    assert.equal(s, imgs);
    stamps += s;
  }
  assert.equal(stamps, 5);
});

test("PDF file name: day and a slug of the author", () => {
  assert.equal(reportPdfFileName("Sam Whitfield (Bluegrass Electric)", "2026-10-20"), "daily-report-2026-10-20-sam-whitfield-bluegrass-electric.pdf");
  assert.equal(reportPdfFileName("José Núñez", "2026-10-20"), "daily-report-2026-10-20-jose-nunez.pdf");
  assert.equal(reportPdfFileName("", "2026-10-20"), "daily-report-2026-10-20-report.pdf");
});
