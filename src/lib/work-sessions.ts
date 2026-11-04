/**
 * A work session is a block of hours on one job, inside a single calendar day.
 * Sessions are what paint the 24-hour bar and what the PDF caption letters (a, b, c…).
 * The activity log edits these sessions: each letter is a job with a start and an end.
 * Pure: the activity log, the daily report, the PDF and the server all share these rules.
 */
import { can } from "./permissions.ts";

export const MAX_SESSION_NOTES = 500;
export const MAX_SESSION_PROJECT = 120;

export type WorkSession = {
  id: string;
  day: string;
  userId?: string;
  userName?: string;
  projectId: string | null;
  projectName: string;
  /** Minutes from local midnight, 0–1439. */
  startMin: number;
  /** Minutes from local midnight, 1–1440 (1440 = end of the day). */
  endMin: number;
  notes: string;
};

export type LabeledSession = WorkSession & { letter: string };

export type SessionDraft = {
  startMin: number;
  endMin: number;
  projectName: string;
  notes: string;
};

/** a, b, … z, aa, ab… in the order sessions are passed (already sorted). */
export function sessionLetter(index: number): string {
  let n = index + 1;
  let out = "";
  while (n > 0) {
    n -= 1;
    out = String.fromCharCode(97 + (n % 26)) + out;
    n = Math.floor(n / 26);
  }
  return out;
}

/** Oldest start first; the same start keeps a stable order by id. */
export function sortSessions<T extends Pick<WorkSession, "startMin" | "id">>(sessions: readonly T[]): T[] {
  return [...sessions].sort((a, b) => a.startMin - b.startMin || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

export function labelSessions<T extends WorkSession>(sessions: readonly T[]): (T & { letter: string })[] {
  return sortSessions(sessions).map((session, index) => ({ ...session, letter: sessionLetter(index) }));
}

/**
 * "a  Project A  demolish fence   b  Project B  drywall takeoffs"
 * Two spaces after the letter, the project name, one space, the notes; three spaces between sessions.
 */
export function sessionCaption(sessions: readonly Pick<WorkSession, "id" | "startMin" | "projectName" | "notes">[]): string {
  return sortSessions(sessions)
    .map((session, index) => {
      const notes = session.notes.trim();
      const project = session.projectName.trim() || "Untitled";
      return notes ? `${sessionLetter(index)}  ${project} ${notes}` : `${sessionLetter(index)}  ${project}`;
    })
    .join("   ");
}

export type CaptionRun = { text: string; bold: boolean };

/** The caption as PDF runs: the project name is the bold span, everything else is regular. */
export function sessionCaptionRuns(sessions: readonly Pick<WorkSession, "id" | "startMin" | "projectName" | "notes">[]): CaptionRun[] {
  const runs: CaptionRun[] = [];
  sortSessions(sessions).forEach((session, index) => {
    const letter = sessionLetter(index);
    runs.push({ text: index ? `   ${letter}  ` : `${letter}  `, bold: false });
    runs.push({ text: session.projectName.trim() || "Untitled", bold: true });
    const notes = session.notes.trim();
    if (notes) runs.push({ text: ` ${notes}`, bold: false });
  });
  return runs;
}

export function clockFromMinutes(min: number): string {
  const clamped = Math.max(0, Math.min(24 * 60, Math.round(min)));
  const h24 = Math.floor(clamped / 60) % 24;
  const m = clamped % 60;
  const suffix = h24 >= 12 ? "PM" : "AM";
  const h = h24 % 12 || 12;
  return `${h}:${String(m).padStart(2, "0")} ${suffix}`;
}

export function minutesToInput(min: number): string {
  const clamped = Math.max(0, Math.min(23 * 60 + 59, Math.round(min)));
  return `${String(Math.floor(clamped / 60)).padStart(2, "0")}:${String(clamped % 60).padStart(2, "0")}`;
}

/** A `<input type="time">` value, or null. 24:00 is the end of the day. */
export function inputToMinutes(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (minute > 59 || hour > 24) return null;
  if (hour === 24) return minute === 0 ? 1440 : null;
  return hour * 60 + minute;
}

export function sessionMinutes(session: Pick<WorkSession, "startMin" | "endMin">): number {
  return Math.max(0, session.endMin - session.startMin);
}

export function normalizeSession(input: SessionDraft): { ok: true; value: SessionDraft } | { ok: false; error: string } {
  const startMin = Math.round(input.startMin);
  const endMin = Math.round(input.endMin);
  if (!Number.isInteger(startMin) || startMin < 0 || startMin > 1439) return { ok: false, error: "Start time is outside the day." };
  if (!Number.isInteger(endMin) || endMin < 1 || endMin > 1440) return { ok: false, error: "End time is outside the day." };
  if (endMin <= startMin) return { ok: false, error: "End time has to be after the start." };
  const projectName = input.projectName.trim().slice(0, MAX_SESSION_PROJECT);
  if (!projectName) return { ok: false, error: "Choose a project." };
  return { ok: true, value: { startMin, endMin, projectName, notes: input.notes.trim().slice(0, MAX_SESSION_NOTES) } };
}

/** Anyone who logs a day can add their own block. */
export function mayAddSession(role: string): boolean {
  return can(role, "session.write");
}

/** Leads and principals can see the crew's hours. Labor and subs cannot. */
export function mayReviewSessions(role: string): boolean {
  return can(role, "session.review");
}

/**
 * Own hours follow session.write. Someone else's hours follow session.manage
 * (owner, admin, superadmin). A lead can see the crew and cannot change their hours.
 */
export function mayEditSession(role: string, ownerId: string | undefined, actorId: string | undefined): boolean {
  if (!ownerId || !actorId) return false;
  if (ownerId === actorId) return can(role, "session.write");
  return can(role, "session.manage");
}
