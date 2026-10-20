/**
 * The daily report PDF: job, date, author, then every entry in time order with its timestamp,
 * photos embedded. Takes display strings the caller formats in the worker's own time zone, so
 * the PDF shows the same times as the screen. No money is ever part of the model.
 */
import { PdfDoc } from "./pdf.ts";

export type ReportPdfEntry =
  | { kind: "text"; stamp: string; body: string }
  | { kind: "photo"; stamp: string; jpeg: Uint8Array | null };

export type ReportPdfModel = {
  job: string;
  day: string;
  author: string;
  firstEdit: string;
  lastEdit: string;
  lunch: string;
  status: string;
  generated: string;
  entries: ReportPdfEntry[];
};

export function reportPdfFileName(author: string, isoDay: string): string {
  const who = author.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^\w]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase() || "report";
  return `daily-report-${isoDay}-${who}.pdf`;
}

export function buildReportPdf(model: ReportPdfModel): Uint8Array {
  const doc = new PdfDoc();
  doc.paragraph("Daily report", 22, { bold: true, leading: 28 });
  doc.gap(4);
  for (const [label, value] of [
    ["Job", model.job],
    ["Date", model.day],
    ["Author", model.author],
  ] as const) {
    doc.paragraph(`${label}: ${value}`, 12, { leading: 17 });
  }
  doc.paragraph(`First edit ${model.firstEdit} · Last edit ${model.lastEdit} · Lunch ${model.lunch} · ${model.status}`, 10, {
    gray: 0.35,
    leading: 15,
  });
  doc.rule();
  if (model.entries.length === 0) doc.paragraph("Nothing added yet.", 11, { gray: 0.35 });
  for (const entry of model.entries) {
    doc.gap(6);
    // Keep a stamp with its first line of text, and with its whole photo.
    const photoHeight = entry.kind === "photo" && entry.jpeg ? doc.jpegHeight(entry.jpeg) : null;
    doc.ensure(14 + (entry.kind === "photo" ? (photoHeight ?? 16) + 4 : 20));
    doc.paragraph(`${entry.stamp} · ${entry.kind === "photo" ? "Photo" : "Note"}`, 9.5, { bold: true, gray: 0.4, leading: 14 });
    if (entry.kind === "text") doc.paragraph(entry.body, 11.5, { leading: 16 });
    else if (!entry.jpeg || !doc.jpeg(entry.jpeg)) doc.paragraph("(This photo could not be included.)", 11, { gray: 0.35 });
  }
  return doc.render({
    title: `Daily report · ${model.author} · ${model.day}`,
    footer: (page, total) => `${model.author} · ${model.day} · ${model.job} · Generated ${model.generated} · Page ${page} of ${total}`,
  });
}
