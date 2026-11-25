/**
 * The activity-log PDF. A photo's caption starts with the creation time, then
 * the words the person typed. Saved work sessions stay lettered at the end.
 * Project time is those sessions' entered durations, not the gaps between photos.
 */
import { PAGE, PdfDoc, wrapText } from "./pdf.ts";
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

type PhotoItem = Extract<ActivityPdfItem, { kind: "photo" }>;

function clipLine(value: string, size: number, width: number, bold = false): string {
  return wrapText(value, size, width, bold)[0] ?? "";
}

/** Four captioned photos in a 2×2 grid. Each further group starts its own page. */
function drawPhotoGrid(doc: PdfDoc, photos: PhotoItem[], first: boolean) {
  const gap = 12;
  const imageMaxH = 200;
  const captionH = 36;
  const cellW = (doc.contentWidth - gap) / 2;
  const cellH = imageMaxH + captionH;
  const gridH = cellH * 2 + gap;
  if (!first) doc.addPage();
  else doc.ensure(gridH);
  const top = doc.y;
  photos.forEach((item, index) => {
    const col = index % 2;
    const row = Math.floor(index / 2);
    const x = PAGE.margin + col * (cellW + gap);
    const cellTop = top - row * (cellH + gap);
    const placed = item.jpeg ? doc.placeJpeg(item.jpeg, x, cellTop - imageMaxH, cellW, imageMaxH) : null;
    if (!placed) doc.text(x, cellTop - 14, "(Photo could not be included.)", 8, { gray: 0.35 });
    let line = cellTop - imageMaxH - 12;
    if (item.captionTime) {
      doc.text(x, line, clipLine(item.captionTime, 9, cellW, true), 9, { bold: true });
      line -= 12;
    }
    if (item.caption) {
      doc.text(x, line, clipLine(item.caption, 9, cellW), 9);
      line -= 12;
    }
    if (item.project) doc.text(x, line, clipLine(`Project: ${item.project}`, 8, cellW), 8, { gray: 0.4 });
  });
  doc.y = top - gridH;
}

export function buildActivityPdf(model: ActivityPdfModel): Uint8Array {
  const doc = new PdfDoc();
  doc.paragraph("Activity log", 22, { bold: true, leading: 28 });
  doc.gap(4);
  doc.paragraph(`Day: ${model.dayLabel}`, 12);
  doc.paragraph(`Entries: ${model.items.length}`, 11, { gray: 0.4 });
  doc.rule();
  if (model.items.length === 0) doc.paragraph("Nothing logged yet.", 11, { gray: 0.35 });
  let photos: PhotoItem[] = [];
  let firstGrid = true;
  const flushPhotos = () => {
    for (let i = 0; i < photos.length; i += 4) {
      drawPhotoGrid(doc, photos.slice(i, i + 4), firstGrid);
      firstGrid = false;
    }
    photos = [];
  };
  for (const item of model.items) {
    if (item.kind === "photo") {
      photos.push(item);
      continue;
    }
    flushPhotos();
    doc.gap(8);
    doc.ensure(20);
    doc.paragraph(item.stamp, 9.5, { bold: true, gray: 0.4 });
    if (item.body) doc.paragraph(item.body, 11.5);
    if (item.project) doc.paragraph(`Project: ${item.project}`, 11);
  }
  flushPhotos();
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
