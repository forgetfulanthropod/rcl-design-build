/**
 * The PDF caption under an activity log or daily report: each session lettered a, b, c…
 * with the project name emphasized and that session's notes after it.
 */
import { PdfDoc, textWidth, PAGE } from "./pdf.ts";
import { sessionCaptionRuns, type CaptionRun } from "./work-sessions.ts";
import type { WorkSession } from "./work-sessions.ts";

export function drawSessionCaption(doc: PdfDoc, sessions: readonly Pick<WorkSession, "id" | "startMin" | "projectName" | "notes">[]): void {
  if (sessions.length === 0) return;
  doc.gap(10);
  doc.rule();
  doc.paragraph("Sessions", 13, { bold: true, leading: 18 });
  doc.gap(2);
  drawRuns(doc, sessionCaptionRuns(sessions), 11);
}

/** Flow mixed regular/bold runs across the content width. One Tj per run that lands on a line. */
export function drawRuns(doc: PdfDoc, runs: readonly CaptionRun[], size: number): void {
  const leading = size * 1.45;
  const max = doc.contentWidth;
  const tokens: CaptionRun[] = [];
  for (const run of runs) {
    for (const bit of run.text.split(/(\s+)/)) {
      if (bit) tokens.push({ text: bit, bold: run.bold });
    }
  }
  let line: CaptionRun[] = [];
  let width = 0;
  const flush = () => {
    if (!line.length) return;
    doc.ensure(leading);
    doc.y -= leading;
    let x = PAGE.margin;
    const y = doc.y + (leading - size) / 2;
    for (const tok of line) {
      if (tok.text) doc.text(x, y, tok.text, size, { bold: tok.bold });
      x += textWidth(tok.text, size, tok.bold);
    }
    line = [];
    width = 0;
  };
  for (const tok of tokens) {
    const w = textWidth(tok.text, size, tok.bold);
    if (width + w > max && line.some((t) => t.text.trim())) flush();
    if (width === 0 && !tok.text.trim()) continue;
    line.push(tok);
    width += w;
  }
  flush();
}
