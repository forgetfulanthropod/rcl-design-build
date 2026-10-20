/**
 * Crew & skills board helpers (spec 01). Pure: shared by the server, the UI and the tests.
 */

/** Days before expiry that a cert shows as "Expiring" (copper). [DECIDE] Charlie may want 14 or 60. */
export const CERT_EXPIRING_DAYS = 30;

export const TRADE_SEED = [
  "Carpentry",
  "Framing",
  "Finish carpentry",
  "Drywall",
  "Paint",
  "Tile",
  "Demo",
  "Concrete",
  "Electrical",
  "Plumbing",
  "HVAC",
  "Project lead",
] as const;

export const CERT_TYPE_SEED = [
  "OSHA 10",
  "OSHA 30",
  "EPA RRP (lead-safe)",
  "First aid/CPR",
  "Forklift",
  "Fall protection",
  "KY electrical license",
] as const;

export const TRADE_LEVELS = ["apprentice", "journeyman", "lead"] as const;
export type TradeLevel = (typeof TRADE_LEVELS)[number];

export const ASSIGNMENT_PARTS = ["full", "am", "pm"] as const;
export type AssignmentPart = (typeof ASSIGNMENT_PARTS)[number];

export const UNAVAIL_REASONS = ["pto", "sick", "training", "other"] as const;
export type UnavailReason = (typeof UNAVAIL_REASONS)[number];

export type CertHealth = "ok" | "expiring" | "expired" | "missing";

export type ConflictKind = "double_booked" | "unavailable" | "missing_cert" | "orientation" | "training" | "sub_mismatch";
export type ConflictSeverity = "blocking" | "warning" | "info";

export const CONFLICT_SEVERITY: Record<ConflictKind, ConflictSeverity> = {
  double_booked: "blocking",
  unavailable: "blocking",
  missing_cert: "warning",
  orientation: "warning",
  training: "info",
  sub_mismatch: "info",
};

export const CONFLICT_LABEL: Record<ConflictKind, string> = {
  double_booked: "Already assigned that half-day",
  unavailable: "Assigned while unavailable",
  missing_cert: "Missing or expired required cert",
  orientation: "Orientation not attended",
  training: "Overdue safety training",
  sub_mismatch: "Sub on a job they aren't attached to",
};

const DAY_MS = 86_400_000;

/** Monday (local) of the week that contains `iso` (YYYY-MM-DD). */
export function weekStart(iso: string): string {
  const d = parseDay(iso);
  const day = d.getDay(); // 0 Sun … 6 Sat
  const mondayOffset = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + mondayOffset);
  return formatDay(d);
}

/** Mon–Sat of the week (Sun omitted unless needed elsewhere). */
export function weekDays(monday: string): string[] {
  const start = parseDay(monday);
  return Array.from({ length: 6 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return formatDay(d);
  });
}

export function addDays(iso: string, n: number): string {
  const d = parseDay(iso);
  d.setDate(d.getDate() + n);
  return formatDay(d);
}

export function formatWeekLabel(monday: string): string {
  const days = weekDays(monday);
  const a = parseDay(days[0]);
  const b = parseDay(days[5]);
  const opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
  const left = a.toLocaleDateString("en-US", opts);
  const right =
    a.getMonth() === b.getMonth()
      ? String(b.getDate())
      : b.toLocaleDateString("en-US", opts);
  return `${left}–${right}`;
}

export function parseDay(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

export function formatDay(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function todayIso(now = new Date()): string {
  return formatDay(now);
}

/** Cert health relative to `onDay` (defaults to today). */
export function certHealth(expiresOn: string | null | undefined, onDay = todayIso()): CertHealth {
  if (!expiresOn) return "missing";
  if (expiresOn < onDay) return "expired";
  const limit = addDays(onDay, CERT_EXPIRING_DAYS);
  if (expiresOn <= limit) return "expiring";
  return "ok";
}

export function certHealthLabel(health: CertHealth): string {
  return health === "ok" ? "OK" : health === "expiring" ? "Expiring" : health === "expired" ? "Expired" : "Missing";
}

/** Worst health across a person's certs (missing only when `required` and absent). */
export function worstCertHealth(statuses: CertHealth[]): CertHealth {
  if (statuses.includes("expired")) return "expired";
  if (statuses.includes("missing")) return "missing";
  if (statuses.includes("expiring")) return "expiring";
  return "ok";
}

/** Parts that collide with an assignment of `part` on the same day. */
export function collidingParts(part: AssignmentPart): AssignmentPart[] {
  if (part === "full") return ["full", "am", "pm"];
  return ["full", part];
}

export function partsOverlap(a: AssignmentPart, b: AssignmentPart): boolean {
  return collidingParts(a).includes(b);
}

export type DraftAssignment = {
  userId: string;
  projectId: string;
  day: string;
  part: AssignmentPart;
};

/**
 * Blocking double-book: two assignments for the same person on overlapping parts of one day.
 * The unique (user_id, day, part) constraint covers identical parts; this catches full vs am/pm.
 */
export function findDoubleBooks(rows: DraftAssignment[]): { userId: string; day: string; a: DraftAssignment; b: DraftAssignment }[] {
  const out: { userId: string; day: string; a: DraftAssignment; b: DraftAssignment }[] = [];
  const byKey = new Map<string, DraftAssignment[]>();
  for (const row of rows) {
    const key = `${row.userId}|${row.day}`;
    const list = byKey.get(key) ?? [];
    list.push(row);
    byKey.set(key, list);
  }
  for (const [, list] of byKey) {
    for (let i = 0; i < list.length; i += 1) {
      for (let j = i + 1; j < list.length; j += 1) {
        if (list[i].projectId !== list[j].projectId && partsOverlap(list[i].part, list[j].part)) {
          out.push({ userId: list[i].userId, day: list[i].day, a: list[i], b: list[j] });
        }
      }
    }
  }
  return out;
}

export function dayInRange(day: string, from: string, to: string): boolean {
  return day >= from && day <= to;
}

export function unavailLabel(reason: UnavailReason): string {
  return reason === "pto" ? "PTO" : reason === "sick" ? "Sick" : reason === "training" ? "Training" : "Off";
}

export function isTradeLevel(value: string): value is TradeLevel {
  return (TRADE_LEVELS as readonly string[]).includes(value);
}

export function isAssignmentPart(value: string): value is AssignmentPart {
  return (ASSIGNMENT_PARTS as readonly string[]).includes(value);
}

export function isUnavailReason(value: string): value is UnavailReason {
  return (UNAVAIL_REASONS as readonly string[]).includes(value);
}

/** Short job name for a pill: first word, or first 12 chars. */
export function shortJobName(name: string): string {
  const trimmed = name.trim();
  const first = trimmed.split(/\s+/)[0] ?? trimmed;
  return first.length <= 14 ? first : `${first.slice(0, 12)}…`;
}

export function daysBetween(a: string, b: string): number {
  return Math.round((parseDay(b).getTime() - parseDay(a).getTime()) / DAY_MS);
}
