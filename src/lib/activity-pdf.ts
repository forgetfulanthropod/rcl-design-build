/**
 * The activity-log PDF. Photos are captioned (time, then the words the person typed)
 * and laid out four to a page in a 2×2 grid, so a day of photos is not one picture per page.
 * Every photo is placed, including one whose JPEG could not be embedded.
 * Saved work sessions stay lettered at the end.
 * Project time is those sessions' entered durations, not the gaps between photos.
 */
import { PdfDoc, PAGE, wrapText } from "./pdf.ts";
import { drawSessionCaption } from "./session-caption.ts";
import { formatMinutes, projectTimesFromSessions, type WorkSession } from "./work-sessions.ts";

/** Four captioned photos per page, two across and two down. */
export const PHOTOS_PER_PDF_PAGE = 4;

export function activityPhotoPageCount(photoCount: number): number {
  const n = Number.isFinite(photoCount) ? Math.max(0, Math.floor(photoCount)) : 0;
  if (n === 0) return 0;
  return Math.ceil(n / PHOTOS_PER_PDF_PAGE);
}

const GRID_GAP = 14;
const GRID_BOTTOM = PAGE.margin + 28;
const CELL_H = 300;
const CAPTION_BAND = 84;

export type ActivityPdfItem =
  | {
      kind: "photo";
      captionTime: string;
      caption: string;
      project?: string;
      jpeg: Uint8Array | null;
    }
  | { kind: "text" | "project" | "lunch"; stamp: string; body: string; project?: string };

export type ActivityPdfModel = {
  dayKey: string;
  dayLabel: string;
  items: ActivityPdfItem[];
  sessions: Pick<WorkSession, "id" | "startMin" | "endMin" | "projectName" | "notes">[];
};

type PhotoItem = Extract<ActivityPdfItem, { kind: "photo" }>;

/** One page holds at most four photos. A chunk that does not fit starts a new page. */
function drawPhotoChunk(
  doc: PdfDoc,
  chunk: PhotoItem[],
  tracker: { photosOnPage: number; pageCount: number },
) {
  const sync = () => {
    if (doc.pages.length !== tracker.pageCount) {
      tracker.pageCount = doc.pages.length;
      tracker.photosOnPage = 0;
    }
  };
  sync();
  if (tracker.photosOnPage + chunk.length > PHOTOS_PER_PDF_PAGE) {
    doc.addPage();
    sync();
  }
  const rows = Math.ceil(chunk.length / 2);
  const needed = rows * CELL_H + (rows - 1) * GRID_GAP;
  if (doc.y - needed < GRID_BOTTOM) {
    doc.addPage();
    sync();
  }
  const cellW = (doc.contentWidth - GRID_GAP) / 2;
  const imageH = CELL_H - CAPTION_BAND;
  const origin = doc.y;
  chunk.forEach((item, index) => {
    const col = index % 2;
    const row = Math.floor(index / 2);
    const x = PAGE.margin + col * (cellW + GRID_GAP);
    const top = origin - row * (CELL_H + GRID_GAP);
    const imageBottom = top - imageH;
    const placed = item.jpeg ? doc.jpegBox(item.jpeg, x, imageBottom, cellW, imageH) : false;
    if (!placed) doc.text(x, top - 14, "(Photo could not be included.)", 9, { gray: 0.35 });
    const floor = top - CELL_H + 8;
    let y = imageBottom - 2;
    const line = (
      value: string,
      size: number,
      opts: { bold?: boolean; gray?: number },
      maxLines: number,
    ) => {
      const lines = wrapText(value, size, cellW, opts.bold).filter(Boolean).slice(0, maxLines);
      for (const text of lines) {
        if (y < floor) return;
        doc.text(x, y, text, size, opts);
        y -= size + 3;
      }
    };
    if (item.captionTime) line(item.captionTime, 10, { bold: true }, 2);
    if (item.caption) line(item.caption, 9, {}, 3);
    if (item.project) line(`Project: ${item.project}`, 9, { gray: 0.35 }, 2);
  });
  tracker.photosOnPage += chunk.length;
  doc.y = origin - needed - 8;
}

export function buildActivityPdf(model: ActivityPdfModel): Uint8Array {
  const doc = new PdfDoc();
  doc.paragraph("Activity log", 22, { bold: true, leading: 28 });
  doc.gap(4);
  doc.paragraph(`Day: ${model.dayLabel}`, 12);
  doc.paragraph(`Entries: ${model.items.length}`, 11, { gray: 0.4 });
  doc.rule();
  if (model.items.length === 0) doc.paragraph("Nothing logged yet.", 11, { gray: 0.35 });
  const tracker = { photosOnPage: 0, pageCount: doc.pages.length };
  const queue: PhotoItem[] = [];
  const flush = () => {
    while (queue.length) drawPhotoChunk(doc, queue.splice(0, PHOTOS_PER_PDF_PAGE), tracker);
  };
  for (const item of model.items) {
    if (item.kind === "photo") {
      queue.push(item);
      if (queue.length === PHOTOS_PER_PDF_PAGE) flush();
      continue;
    }
    flush();
    doc.gap(8);
    doc.ensure(20);
    doc.paragraph(item.stamp, 9.5, { bold: true, gray: 0.4 });
    if (item.body) doc.paragraph(item.body, 11.5);
    if (item.project) doc.paragraph(`Project: ${item.project}`, 11);
  }
  flush();
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
