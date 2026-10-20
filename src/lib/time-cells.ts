/** Per-cell rules for the approvals table (pure, unit-tested). */
import { dayFlags, type EntryStatus, type Flag } from "./time.ts";

/** One status for a person-day: rejected beats submitted beats approved beats exported. */
export function dayStatusOf(statuses: EntryStatus[]): EntryStatus | null {
  if (statuses.length === 0) return null;
  if (statuses.includes("rejected")) return "rejected";
  if (statuses.includes("submitted")) return "submitted";
  if (statuses.includes("approved")) return "approved";
  return "exported";
}

/** Check flags for the lines shown in one cell. */
export function flagsOf(entries: { minutes: number; start: string }[]): Flag[] {
  if (entries.length === 0) return [];
  const minutes = entries.reduce((n, e) => n + e.minutes, 0);
  return dayFlags(minutes, entries.every((e) => Boolean(e.start)));
}

/** "Mon" / "Oct 19" for a YYYY-MM-DD day (no time zone shift). */
export function weekdayLabel(day: string): { dow: string; date: string } {
  const d = new Date(`${day}T12:00:00Z`);
  return {
    dow: d.toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" }),
    date: d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }),
  };
}

/** Compact hours for the week strip: 480 → "8h", 495 → "8h15". */
export function shortHours(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h}h${String(m).padStart(2, "0")}` : `${h}h`;
}
