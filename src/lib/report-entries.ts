/**
 * The daily report as an ordered list of entries (Charlie, Oct 20): each entry is a piece of
 * text or a photo, stamped when it was added and again whenever its text changes. Pure helpers,
 * shared by the server, the editor and the PDF; unit-tested in report-entries.test.ts.
 */

export type EntryKind = "text" | "photo";

export type ReportEntry = {
  id: string;
  kind: EntryKind;
  /** The text of a text entry ("" for photos). */
  body: string;
  /** Photo entries only. */
  photoId: string | null;
  createdAt: string;
  /** Set when a text entry's words change after it was first saved. */
  editedAt: string | null;
};

export const MAX_ENTRY_TEXT = 8000;
export const MAX_ENTRIES = 120;

/** Time order: oldest first; entries added in the same instant keep a stable order by id. */
export function sortEntries<T extends Pick<ReportEntry, "createdAt" | "id">>(entries: readonly T[]): T[] {
  return [...entries].sort((a, b) => {
    const t = Date.parse(a.createdAt) - Date.parse(b.createdAt);
    if (t !== 0 && !Number.isNaN(t)) return t;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

/**
 * The report's narrative, kept in `daily_reports.narrative` for everything that reads it (the
 * owner's review, the AI attention summary, the submit check): every non-empty text entry, in
 * time order, separated by a blank line.
 */
export function narrativeOf(entries: readonly ReportEntry[]): string {
  return sortEntries(entries)
    .filter((e) => e.kind === "text" && e.body.trim())
    .map((e) => e.body.trim())
    .join("\n\n");
}

/** Stable ids for entries made from a pre-entries report (same in the migration and the code). */
export const legacyTextId = (reportId: string) => `legacy-text-${reportId}`;
export const legacyPhotoId = (photoId: string) => `legacy-photo-${photoId}`;

export type LegacyReport = {
  id: string;
  narrative: string;
  firstEditAt: string | null;
  lastEditAt: string | null;
  createdAt: string;
};
export type LegacyPhoto = { id: string; createdAt: string };

/**
 * How a report written before entries existed becomes entries (migration 0017 does the same in
 * SQL). The narrative becomes one text entry stamped at the first edit (edited at the last edit,
 * if later); each photo becomes a photo entry stamped when it was added. Nothing is dropped.
 */
export function legacyEntries(report: LegacyReport, photos: readonly LegacyPhoto[]): ReportEntry[] {
  const out: ReportEntry[] = [];
  if (report.narrative.trim()) {
    const created = report.firstEditAt ?? report.createdAt;
    const edited = report.lastEditAt && Date.parse(report.lastEditAt) > Date.parse(created) ? report.lastEditAt : null;
    out.push({ id: legacyTextId(report.id), kind: "text", body: report.narrative, photoId: null, createdAt: created, editedAt: edited });
  }
  for (const p of photos) {
    out.push({ id: legacyPhotoId(p.id), kind: "photo", body: "", photoId: p.id, createdAt: p.createdAt, editedAt: null });
  }
  return sortEntries(out);
}

/** One text edit sent by the editor: an existing entry (id) or a new one (no id, keyed by the client). */
export type TextEdit = { id: string | null; key: string; body: string };

export type TextPlan = {
  insert: { key: string; body: string }[];
  update: { id: string; body: string }[];
  remove: string[];
};

/**
 * What a save does with the editor's text: new non-empty text is added; changed text is
 * updated (and stamped edited); an existing entry cleared to nothing is removed; unchanged and
 * empty new text is left alone. Edits to ids that aren't this report's text entries are ignored.
 */
export function planTextSave(current: readonly ReportEntry[], edits: readonly TextEdit[]): TextPlan {
  const texts = new Map(current.filter((e) => e.kind === "text").map((e) => [e.id, e]));
  const plan: TextPlan = { insert: [], update: [], remove: [] };
  const seen = new Set<string>();
  for (const edit of edits) {
    const body = edit.body.slice(0, MAX_ENTRY_TEXT);
    if (edit.id == null) {
      if (body.trim() && !seen.has(`k:${edit.key}`)) plan.insert.push({ key: edit.key, body });
      seen.add(`k:${edit.key}`);
      continue;
    }
    const found = texts.get(edit.id);
    if (!found || seen.has(edit.id)) continue;
    seen.add(edit.id);
    if (!body.trim()) plan.remove.push(edit.id);
    else if (body !== found.body) plan.update.push({ id: edit.id, body });
  }
  return plan;
}

/** "8:14 AM", or "8:14 AM · edited 9:02 AM". */
export function entryStamp(entry: Pick<ReportEntry, "createdAt" | "editedAt">, clock: (iso: string) => string): string {
  const made = clock(entry.createdAt);
  if (!entry.editedAt) return made;
  const edited = clock(entry.editedAt);
  return edited === made ? made : `${made} · edited ${edited}`;
}

/**
 * "taken 6:45 AM" (or "taken Oct 19, 6:45 AM" on another day) for a photo whose camera time
 * differs from when it was added by a minute or more; "" otherwise.
 */
export function takenLabel(
  takenAt: string | null | undefined,
  addedAt: string,
  fmt: { clock: (iso: string) => string; dayKey: (iso: string) => string; shortDay: (iso: string) => string },
): string {
  if (!takenAt) return "";
  const taken = Date.parse(takenAt);
  const added = Date.parse(addedAt);
  if (Number.isNaN(taken) || (!Number.isNaN(added) && Math.abs(added - taken) < 60_000)) return "";
  const sameDay = !Number.isNaN(added) && fmt.dayKey(takenAt) === fmt.dayKey(addedAt);
  return `taken ${sameDay ? "" : `${fmt.shortDay(takenAt)}, `}${fmt.clock(takenAt)}`;
}
