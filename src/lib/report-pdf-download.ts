/** Browser side of "Download PDF": fetch what the server allows, build the PDF, save it. */
import { getReportPdfData, getReportPhoto } from "@/lib/server/fns";
import { buildReportPdf, reportPdfFileName, type ReportPdfEntry } from "@/lib/report-pdf";
import { entryStamp } from "@/lib/report-entries";
import { clock } from "@/components/today-report";

export type PdfTarget = { day: string; reportId?: undefined } | { reportId: string; day?: undefined };

function fullDay(day: string): string {
  return new Date(`${day}T12:00:00`).toLocaleDateString([], { weekday: "long", month: "short", day: "numeric", year: "numeric" });
}

function bytesOf(dataUrl: string): { mime: string; bytes: Uint8Array } {
  const comma = dataUrl.indexOf(",");
  const mime = /^data:([^;]+)/.exec(dataUrl)?.[1] ?? "";
  const bin = atob(dataUrl.slice(comma + 1));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  return { mime, bytes };
}

/** PNG/WebP photos go through a canvas so the PDF can embed them as JPEG. */
async function asJpeg(dataUrl: string): Promise<Uint8Array | null> {
  const { mime, bytes } = bytesOf(dataUrl);
  if (mime === "image/jpeg") return bytes;
  try {
    const img = new Image();
    img.src = dataUrl;
    await img.decode();
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    canvas.getContext("2d")!.drawImage(img, 0, 0);
    return bytesOf(canvas.toDataURL("image/jpeg", 0.85)).bytes;
  } catch {
    return null;
  }
}

/** Build the report PDF in the browser (no size limits from a serverless response) and save it. */
export async function downloadReportPdf(target: PdfTarget): Promise<string> {
  const data = await getReportPdfData({ data: target });
  const entries: ReportPdfEntry[] = [];
  for (const e of data.entries) {
    const stamp = entryStamp(e, (v) => clock(v));
    if (e.kind === "text") {
      entries.push({ kind: "text", stamp, body: e.body });
      continue;
    }
    let jpeg: Uint8Array | null = null;
    try {
      jpeg = e.photoId ? await asJpeg((await getReportPhoto({ data: { id: e.photoId } })).url) : null;
    } catch {
      jpeg = null;
    }
    entries.push({ kind: "photo", stamp, jpeg });
  }
  const pdf = buildReportPdf({
    job: data.projectName || "No job",
    day: fullDay(data.day),
    author: data.userName || "Unknown",
    firstEdit: clock(data.firstEditAt),
    lastEdit: clock(data.lastEditAt),
    lunch: data.lunchMinutes == null ? "—" : `${data.lunchMinutes} min`,
    status: data.submittedAt ? `Submitted ${clock(data.submittedAt)}` : "Not submitted yet",
    generated: new Date().toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }),
    entries,
  });
  const name = reportPdfFileName(data.userName, data.day);
  const url = URL.createObjectURL(new Blob([pdf as BlobPart], { type: "application/pdf" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
  return name;
}


export const PDF_OFF_HINT = "PDF download is off for your role on this job. Ask an owner or admin.";
