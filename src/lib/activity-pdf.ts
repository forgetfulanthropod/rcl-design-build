/**
 * The activity-log PDF. A photo's caption starts with the creation time, then
 * the words the person typed. Saved work sessions stay lettered at the end.
 * Project time is those sessions' entered durations, not the gaps between photos.
 */
import { PdfDoc } from "./pdf.ts";
import { drawSessionCaption } from "./session-caption.ts";
import { formatMinutes, projectTimesFromSessions, type WorkSession } from "./work-sessions.ts";

export type ActivityPdfItem =
  | { kind: "photo"; captionTime: string; caption: string; project?: string; jpeg: Uint8Array | null }
  | { kind: "text" | "project" | "lunch"; stamp: string; body: string; project?: string };

export type ActivityPdfModel = {
  dayKey: string;
  dayLabel: string;
  items: ActivityPdfItem[];
  sessions: Pick<WorkSession, "id" | "startMin" | "endMin" | "projectName" | "notes">[];
};

export function buildActivityPdf(model: ActivityPdfModel): Uint8Array {
  const doc = new PdfDoc();
  doc.paragraph("Activity log", 22, { bold: true, leading: 28 });
  doc.gap(4);
  doc.paragraph(`Day: ${model.dayLabel}`, 12);
  doc.paragraph(`Entries: ${model.items.length}`, 11, { gray: 0.4 });
  doc.rule();
  if (model.items.length === 0) doc.paragraph("Nothing logged yet.", 11, { gray: 0.35 });
  for (const item of model.items) {
    doc.gap(8);
    if (item.kind === "photo") {
      const photoHeight = item.jpeg ? doc.jpegHeight(item.jpeg) : null;
      doc.ensure(14 + (photoHeight ?? 16) + 4);
      if (!item.jpeg || !doc.jpeg(item.jpeg)) doc.paragraph("(Photo could not be included.)", 11, { gray: 0.35 });
      if (item.captionTime) doc.paragraph(item.captionTime, 11, { bold: true, leading: 15 });
      if (item.caption) doc.paragraph(item.caption, 11.5);
      if (item.project) doc.paragraph(`Project: ${item.project}`, 11);
      continue;
    }
    doc.ensure(20);
    doc.paragraph(item.stamp, 9.5, { bold: true, gray: 0.4 });
    if (item.body) doc.paragraph(item.body, 11.5);
    if (item.project) doc.paragraph(`Project: ${item.project}`, 11);
  }
  drawSessionCaption(doc, model.sessions);
  const projectTimes = projectTimesFromSessions(model.sessions);
  if (projectTimes.length > 0) {
    doc.gap(12);
    doc.rule();
    doc.paragraph("Project time", 14, { bold: true });
    for (const pt of projectTimes) doc.paragraph(`${pt.project}: ${formatMinutes(pt.minutes)}`, 11);
    const total = projectTimes.reduce((sum, pt) => sum + pt.minutes, 0);
    doc.paragraph(`Total: ${formatMinutes(total)}`, 12, { bold: true });
  }
  return doc.render({
    title: `Activity log · ${model.dayKey}`,
    footer: (page, total) => `Activity log · ${model.dayKey} · Page ${page} of ${total}`,
  });
}
