/**
 * A private link to one activity-log day. Sharing defaults to less:
 * the link does not exist until someone creates it, it follows the same
 * permission as sending a document (doc.send; principals via report.review),
 * and the snapshot leaves location off.
 *
 * Pure, so the browser, the server and the tests share one rule.
 */
import { can, canWith } from "./permissions.ts";
import { dataUrlBytes, MAX_STORED_BYTES, plausibleTakenAt, type PhotoTimeSource } from "./photo-upload.ts";
import type { Sharing } from "./sharing.ts";
import { normalizeSession } from "./work-sessions.ts";

export const MAX_CAPTION = 800;
export const MAX_SHARE_PHOTOS = 24;
export const MAX_SHARE_ENTRIES = 120;
export const MAX_SHARE_JSON = 6_000_000;
export const SHARE_UNAVAILABLE = "This link is not available.";

export type SharedEntry = {
  id: string;
  kind: "text" | "photo" | "project" | "lunch";
  body: string;
  image: string | null;
  takenAt: string | null;
  takenSource: PhotoTimeSource | null;
  project: string;
  ts: string;
};

export type SharedSession = {
  id: string;
  startMin: number;
  endMin: number;
  project: string;
  notes: string;
};

export type ActivitySnapshot = {
  day: string;
  entries: SharedEntry[];
  sessions: SharedSession[];
};

/**
 * Who may create a private link for their own day. Same gate as downloading
 * your own report as a PDF: a link can be opened by anyone who has it, so it
 * is a document leaving the company.
 * Owner, admin and superadmin may. A lead may. Labor may only when
 * "Labor can send documents" is on (the default is off). Subs never may.
 */
export function mayShareActivity(role: string, sharing: Sharing): boolean {
  if (can(role, "report.review")) return true;
  return can(role, "report.write") && canWith(role, "doc.send", sharing);
}

const KINDS = new Set(["text", "photo", "project", "lunch"]);

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function imageOk(url: string): boolean {
  if (!url) return true;
  const match = /^data:image\/(jpeg|png|webp|svg\+xml)((?:;charset=[^;,]+)?;base64)?,([\s\S]*)$/i.exec(url);
  if (!match) return false;
  const payload = match[3];
  if (/base64/i.test(match[2] ?? "")) {
    if (!/^[A-Za-z0-9+/=\s]+$/.test(payload)) return false;
    return dataUrlBytes(url) <= MAX_STORED_BYTES;
  }
  return /^svg\+xml$/i.test(match[1]) && payload.length <= 100_000;
}

export function sanitizeActivityShare(input: unknown): { ok: true; value: ActivitySnapshot } | { ok: false; error: string } {
  const root = asRecord(input);
  if (!root) return { ok: false, error: "Nothing to share." };
  const day = typeof root.day === "string" ? root.day.trim() : "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return { ok: false, error: "Pick a day." };
  if (!Array.isArray(root.entries)) return { ok: false, error: "Nothing to share." };
  if (root.entries.length > MAX_SHARE_ENTRIES) return { ok: false, error: `Up to ${MAX_SHARE_ENTRIES} entries can go on a link.` };
  if (!Array.isArray(root.sessions)) return { ok: false, error: "Nothing to share." };

  const entries: SharedEntry[] = [];
  let photos = 0;
  for (const item of root.entries) {
    const row = asRecord(item);
    if (!row) return { ok: false, error: "Nothing to share." };
    const kind = typeof row.kind === "string" && KINDS.has(row.kind) ? (row.kind as SharedEntry["kind"]) : null;
    if (!kind) return { ok: false, error: "That day has an entry the link can't carry." };
    if (kind === "photo") photos += 1;
    if (photos > MAX_SHARE_PHOTOS) {
      return { ok: false, error: `Up to ${MAX_SHARE_PHOTOS} photos can go on a link. Download the PDF for the full day.` };
    }
    const imageRaw = typeof row.image === "string" ? row.image : typeof row.dataUrl === "string" ? row.dataUrl : "";
    const image = kind === "photo" ? imageRaw : "";
    if (kind === "photo" && !imageOk(image)) return { ok: false, error: "A photo on this day can't be shared. Download the PDF instead." };
    const source: PhotoTimeSource | null = row.takenSource === "file" || row.takenSource === "exif" ? row.takenSource : null;
    const atRaw = typeof row.takenAt === "string" && row.takenAt ? row.takenAt : typeof row.fileTime === "string" ? row.fileTime : "";
    const at = plausibleTakenAt(atRaw || null);
    entries.push({
      id: (typeof row.id === "string" && row.id.trim() ? row.id.trim() : `e-${entries.length}`).slice(0, 80),
      kind,
      body: (typeof row.body === "string" ? row.body : "").trim().slice(0, MAX_CAPTION),
      image: image || null,
      takenAt: at,
      takenSource: at ? (source ?? "exif") : source === "file" ? "file" : null,
      project: (typeof row.project === "string" ? row.project : "").trim().slice(0, 120),
      ts: (typeof row.ts === "string" ? row.ts : "").slice(0, 40),
    });
  }

  const sessions: SharedSession[] = [];
  for (const item of root.sessions) {
    const row = asRecord(item);
    if (!row) return { ok: false, error: "A saved hour on this day can't be shared." };
    const parsed = normalizeSession({
      startMin: Number(row.startMin),
      endMin: Number(row.endMin),
      projectName: typeof row.project === "string" ? row.project : typeof row.projectName === "string" ? row.projectName : "",
      notes: typeof row.notes === "string" ? row.notes : "",
    });
    if (!parsed.ok) return { ok: false, error: parsed.error };
    sessions.push({
      id: (typeof row.id === "string" && row.id.trim() ? row.id.trim() : `s-${sessions.length}`).slice(0, 80),
      startMin: parsed.value.startMin,
      endMin: parsed.value.endMin,
      project: parsed.value.projectName,
      notes: parsed.value.notes,
    });
  }

  if (entries.length === 0 && sessions.length === 0) return { ok: false, error: "Nothing to share yet." };
  const value = { day, entries, sessions };
  if (JSON.stringify(value).length > MAX_SHARE_JSON) {
    return { ok: false, error: "That day is too large to share. Download the PDF instead." };
  }
  return { ok: true, value };
}
