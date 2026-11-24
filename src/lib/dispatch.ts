/**
 * Dispatch board helpers. Pure: shared by the server, the page and the tests.
 *
 * Full-time people are assumed out at 8:00 AM every day. Their location is the latest
 * placement on or before that day, and it carries forward until someone moves them.
 * Part-time people appear only on days they are placed; every other day they sit in
 * the available pool.
 */
import { addDays, parseDay, weekStart } from "./crew.ts";

/** Everyone on the board is dispatched for an 8:00 AM start. Not editable. */
export const DISPATCH_START_MIN = 8 * 60;
export const DISPATCH_START_LABEL = "8:00 AM";

export const DISPATCH_KINDS = ["full", "part"] as const;
export type DispatchKind = (typeof DISPATCH_KINDS)[number];

export const NOTE_MAX = 800;

export function isDispatchKind(value: string): value is DispatchKind {
  return (DISPATCH_KINDS as readonly string[]).includes(value);
}

/** Monday–Sunday of the week containing `iso`. Sunday is included: the crew can be sent any day. */
export function dispatchWeekDays(iso: string): string[] {
  const monday = weekStart(iso);
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
}

export function formatDispatchDay(iso: string): string {
  return parseDay(iso).toLocaleDateString("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
  });
}

export function formatDispatchWeek(monday: string): string {
  const days = dispatchWeekDays(monday);
  const a = parseDay(days[0]);
  const b = parseDay(days[6]);
  const opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
  const left = a.toLocaleDateString("en-US", opts);
  const right =
    a.getMonth() === b.getMonth() ? String(b.getDate()) : b.toLocaleDateString("en-US", opts);
  const year =
    a.getFullYear() === b.getFullYear()
      ? String(b.getFullYear())
      : `${a.getFullYear()}–${b.getFullYear()}`;
  return `${left}–${right}, ${year}`;
}

export type RosterPerson = { userId: string; kind: DispatchKind };

export type PlacementRow = {
  userId: string;
  day: string;
  locationId: string | null;
  kind: DispatchKind;
};

export type ResolvedPlacement = {
  userId: string;
  kind: DispatchKind;
  locationId: string | null;
  /** Full-time location inherited from an earlier day, not set on this day itself. */
  carried: boolean;
};

/**
 * Where each roster person is on `day`.
 * Archived (or unknown) locations count as unassigned so a hidden site cannot swallow someone.
 */
export function resolveDay(
  people: RosterPerson[],
  placements: PlacementRow[],
  activeLocationIds: readonly string[],
  day: string,
): ResolvedPlacement[] {
  const active = new Set(activeLocationIds);
  return people.map((person) => {
    if (person.kind === "part") {
      const row = placements.find(
        (p) => p.userId === person.userId && p.kind === "part" && p.day === day,
      );
      const locationId = row?.locationId && active.has(row.locationId) ? row.locationId : null;
      return { userId: person.userId, kind: "part", locationId, carried: false };
    }
    const prior = placements
      .filter((p) => p.userId === person.userId && p.kind === "full" && p.day <= day)
      .sort((a, b) => (a.day < b.day ? 1 : a.day > b.day ? -1 : 0));
    const row = prior[0];
    const locationId = row?.locationId && active.has(row.locationId) ? row.locationId : null;
    return {
      userId: person.userId,
      kind: "full",
      locationId,
      carried: Boolean(row && row.day < day && locationId),
    };
  });
}

/** A drop on the available pool clears a part-time day. Full-time people only move between locations. */
export function placementForDrop(
  kind: DispatchKind,
  over: string | null,
): { locationId: string | null } | null {
  if (!over || over === "unassigned") return null;
  if (over === "available") return kind === "part" ? { locationId: null } : null;
  return { locationId: over };
}

export function kindLabel(kind: DispatchKind): string {
  return kind === "full" ? "Full-time" : "Part-time";
}

/**
 * US 10-digit numbers gain +1. Anything else must already include a country code.
 * Matches the sign-in normalizer and Twilio's E.164 check.
 */
export function toE164(raw: string): string | null {
  let digits = raw.trim().replace(/\D/g, "");
  if (digits.length === 10) digits = `1${digits}`;
  if (digits.length < 11 || digits.length > 15 || !/^[1-9]/.test(digits)) return null;
  const phone = `+${digits}`;
  return /^\+[1-9]\d{7,14}$/.test(phone) ? phone : null;
}

export type DispatchText = {
  personName: string;
  phone: string | null;
  dayLabel: string;
  startLabel: string;
  locationName: string | null;
  locationAddress: string;
  locationInstruction: string;
  personInstruction: string;
  /** Set when this text is about removing an instruction, so the employee can see that it is gone. */
  cleared: "person" | "location" | null;
};

/** One employee's dispatch text. Callers pass only that employee's location and instructions. */
export function dispatchMessage(input: DispatchText): string {
  const place = input.locationName
    ? [input.locationName, input.locationAddress].filter(Boolean).join(", ")
    : "";
  const lines = [
    `${input.personName}, dispatch for ${input.dayLabel}.`,
    place ? `You're at ${place} from ${input.startLabel}.` : `You're not placed on ${input.dayLabel}.`,
  ];
  if (input.phone) lines.push(`Number on file: ${input.phone}`);
  if (input.cleared === "location") lines.push("Location instruction: cleared.");
  else if (input.locationInstruction) lines.push(`Location: ${input.locationInstruction}`);
  if (input.cleared === "person") lines.push("For you: cleared.");
  else if (input.personInstruction) lines.push(`For you: ${input.personInstruction}`);
  return lines.join("\n");
}

/** Rapid drops of the same person collapse to the last location. */
export const DISPATCH_DRAG_SAVE_MS = 800;

/** A second assignment text for the same person inside this window updates the log instead of sending again. */
export const DISPATCH_TEXT_WINDOW_MS = 15_000;

export function createDragGate(waitMs: number) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let latest: string | null = null;
  return {
    push(locationId: string | null, save: (locationId: string | null) => void) {
      latest = locationId;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        const next = latest;
        latest = null;
        save(next);
      }, waitMs);
    },
    pending() {
      return timer !== null;
    },
  };
}
