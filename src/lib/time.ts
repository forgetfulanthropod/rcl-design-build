/**
 * Timesheets (spec 02). Pure: shared by the server, the UI and the tests.
 *
 * Every product choice the spec left open is a named constant here, so changing one is a
 * one-line edit. The PR description lists them as [DECIDE].
 */

// ---------------------------------------------------------------- [DECIDE] choices (spec defaults)

/** [DECIDE] Hours round to this many minutes. Spec default: 15. */
export const ROUND_MINUTES = 15;
/** [DECIDE] How rounding breaks: "nearest" (spec example 8h 09m → 8h 15m), "up", or "down". */
export const ROUND_MODE: "nearest" | "up" | "down" = "nearest";
/** [DECIDE] Weekly overtime threshold (FLSA): over 40 h in the pay week is OT. */
export const WEEKLY_OT_MINUTES = 40 * 60;
/** [DECIDE] Daily overtime threshold. Spec default: off (null). Set e.g. 8 * 60 to turn it on. */
export const DAILY_OT_MINUTES: number | null = null;
/** [DECIDE] An explicit "Start my day" tap. Spec default: off; start comes from the first edit. */
export const START_MY_DAY_ENABLED = false;
/** [DECIDE] Payroll CSV adds `rate,amount` columns. Spec default: off (generic CSV first). */
export const PAYROLL_CSV_INCLUDE_RATES = false;

// ---------------------------------------------------------------- rules (spec, not choices)

/** A day under this many minutes gets a "check" flag. */
export const FLAG_UNDER_MINUTES = 60;
/** A day over this many minutes gets a "check" flag; a worker can't submit more than this. */
export const MAX_DAY_MINUTES = 14 * 60;
export const DEFAULT_TIMEZONE = "America/New_York";

export const ENTRY_STATUSES = ["submitted", "approved", "rejected", "exported"] as const;
export type EntryStatus = (typeof ENTRY_STATUSES)[number];
export const ENTRY_SOURCES = ["derived", "edited", "manual"] as const;
export type EntrySource = (typeof ENTRY_SOURCES)[number];

export const STATUS_LABEL: Record<EntryStatus, string> = {
  submitted: "Submitted",
  approved: "Approved",
  rejected: "Rejected",
  exported: "Exported",
};

/** CSI-lite cost codes seeded for every company (spec 02 data model). [ASSUMPTION] kinds. */
export const COST_CODE_SEED: { code: string; name: string; kind: "labor" | "material" | "sub" | "equipment" | "other" | "mixed" }[] = [
  { code: "01-100", name: "General conditions", kind: "mixed" },
  { code: "01-700", name: "Punch & closeout", kind: "labor" },
  { code: "02-400", name: "Demolition", kind: "labor" },
  { code: "06-100", name: "Rough carpentry/framing", kind: "mixed" },
  { code: "06-200", name: "Finish carpentry & cabinets", kind: "mixed" },
  { code: "09-200", name: "Drywall", kind: "mixed" },
  { code: "09-300", name: "Tile", kind: "mixed" },
  { code: "09-900", name: "Paint", kind: "mixed" },
  { code: "22-000", name: "Plumbing", kind: "sub" },
  { code: "23-000", name: "HVAC", kind: "sub" },
  { code: "26-000", name: "Electrical", kind: "sub" },
  { code: "31-000", name: "Sitework/excavation", kind: "sub" },
];

/** Primary trade (spec 01) → default cost code for a one-line day. [ASSUMPTION] mapping. */
export const TRADE_DEFAULT_CODE: Record<string, string> = {
  Carpentry: "06-100",
  Framing: "06-100",
  "Finish carpentry": "06-200",
  Drywall: "09-200",
  Paint: "09-900",
  Tile: "09-300",
  Demo: "02-400",
  Electrical: "26-000",
  Plumbing: "22-000",
  HVAC: "23-000",
  "Project lead": "01-100",
};

// ---------------------------------------------------------------- minutes and clock times

export function roundMinutes(minutes: number, step = ROUND_MINUTES, mode = ROUND_MODE): number {
  if (!Number.isFinite(minutes)) return 0;
  const n = minutes / step;
  const r = mode === "up" ? Math.ceil(n) : mode === "down" ? Math.floor(n) : Math.round(n);
  return r * step;
}

/** 495 → "8h 15m". */
export function formatMinutes(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
}

/** 495 → "8.25" (payroll CSV: decimals to 2 places). */
export function decimalHours(minutes: number): string {
  return (Math.round((minutes / 60) * 100) / 100).toFixed(2);
}

/** "07:02" → 422; anything else → null. */
export function parseClock(value: string | null | undefined): number | null {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec((value ?? "").trim());
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/** 422 → "7:02 AM". */
export function clock12(hhmm: string): string {
  const total = parseClock(hhmm);
  if (total == null) return "—";
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

// ---------------------------------------------------------------- time zones

function zonedFields(ms: number, tz: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(ms));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return { y: get("year"), mo: get("month"), d: get("day"), h: get("hour") % 24, mi: get("minute"), s: get("second") };
}

/** The wall-clock day and "HH:MM" of an instant in `tz`. */
export function zonedClock(iso: string | null | undefined, tz: string): { day: string; hhmm: string } | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return null;
  const f = zonedFields(ms, tz);
  const p = (n: number) => String(n).padStart(2, "0");
  return { day: `${f.y}-${p(f.mo)}-${p(f.d)}`, hhmm: `${p(f.h)}:${p(f.mi)}` };
}

function offsetMs(ms: number, tz: string): number {
  const f = zonedFields(ms, tz);
  return Date.UTC(f.y, f.mo - 1, f.d, f.h, f.mi, f.s) - Math.floor(ms / 1000) * 1000;
}

/** "2026-10-19" + "07:02" in `tz` → ISO instant. */
export function zonedToIso(day: string, hhmm: string, tz: string): string {
  const minutes = parseClock(hhmm);
  const [y, mo, d] = day.split("-").map(Number);
  if (minutes == null || !y || !mo || !d) throw new Error("Enter a time.");
  const guess = Date.UTC(y, mo - 1, d, Math.floor(minutes / 60), minutes % 60);
  let ms = guess - offsetMs(guess, tz);
  ms = guess - offsetMs(ms, tz); // second pass settles DST edges
  return new Date(ms).toISOString();
}

// ---------------------------------------------------------------- the hours rule

export type HoursInput = { start: string; end: string; lunch: number };
export type HoursResult = { rawMinutes: number; minutes: number; errors: string[] };

/** suggested = round15((end − start) − lunch). Errors block submit. */
export function computeHours({ start, end, lunch }: HoursInput): HoursResult {
  const errors: string[] = [];
  const s = parseClock(start);
  const e = parseClock(end);
  if (s == null) errors.push("Enter your start time.");
  if (e == null) errors.push("Enter your end time.");
  if (s == null || e == null) return { rawMinutes: 0, minutes: 0, errors };
  if (e <= s) errors.push("End must be after start.");
  const raw = e - s - (Number(lunch) || 0);
  if (e > s && raw < 0) errors.push("Lunch is longer than the day.");
  const minutes = Math.max(0, roundMinutes(raw));
  if (minutes > MAX_DAY_MINUTES) errors.push(`That's over ${MAX_DAY_MINUTES / 60} hours. Check start and end.`);
  return { rawMinutes: Math.max(0, raw), minutes, errors };
}

export type Line = { projectId: string | null; costCodeId: string | null; minutes: number };

/** Lines must each be whole minutes ≥ 0 and add up to the day's total. */
export function lineErrors(total: number, lines: Line[]): string[] {
  if (lines.length === 0) return ["Add a line."];
  const errors: string[] = [];
  if (lines.some((l) => !Number.isInteger(l.minutes) || l.minutes < 0)) errors.push("Each line needs hours.");
  const sum = lines.reduce((n, l) => n + (Number.isFinite(l.minutes) ? l.minutes : 0), 0);
  if (sum !== total) {
    const left = total - sum;
    errors.push(left > 0 ? `${formatMinutes(left)} still to assign.` : `Lines are ${formatMinutes(-left)} over the total.`);
  }
  return errors;
}

export type Flag = "under" | "over" | "noStart";
export const FLAG_LABEL: Record<Flag, string> = {
  under: `Under ${FLAG_UNDER_MINUTES / 60} h`,
  over: `Over ${MAX_DAY_MINUTES / 60} h`,
  noStart: "No start time",
};

/** "Check" flags for one person-day. Flagged days are left out of bulk approve. */
export function dayFlags(minutes: number, hasStart = true): Flag[] {
  const flags: Flag[] = [];
  if (!hasStart) flags.push("noStart");
  if (minutes < FLAG_UNDER_MINUTES) flags.push("under");
  if (minutes > MAX_DAY_MINUTES) flags.push("over");
  return flags;
}

// ---------------------------------------------------------------- weeks and periods

const DAY_MS = 86_400_000;
const utcDay = (day: string) => Date.parse(`${day}T00:00:00Z`);
const fromUtc = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export function isDayString(day: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(day) && !Number.isNaN(utcDay(day)) && fromUtc(utcDay(day)) === day;
}

export function shiftDay(day: string, n: number): string {
  return fromUtc(utcDay(day) + n * DAY_MS);
}

/** First day of the pay week containing `day`. weekStarts: 0 = Sunday … 1 = Monday (default). */
export function payWeekStart(day: string, weekStarts = 1): string {
  const dow = new Date(utcDay(day)).getUTCDay();
  return shiftDay(day, -((dow - weekStarts + 7) % 7));
}

export function weekDays7(start: string): string[] {
  return Array.from({ length: 7 }, (_, i) => shiftDay(start, i));
}

/** The last full pay week before `today` (the export sheet's default period). */
export function lastFullWeek(today: string, weekStarts = 1): { start: string; end: string } {
  const start = shiftDay(payWeekStart(today, weekStarts), -7);
  return { start, end: shiftDay(start, 6) };
}

export function daysBetweenInclusive(start: string, end: string): number {
  return Math.round((utcDay(end) - utcDay(start)) / DAY_MS) + 1;
}

// ---------------------------------------------------------------- overtime

export type OtRow = { key: string; userId: string; day: string; order?: string; minutes: number };

/**
 * Splits each row into regular and OT minutes. Daily OT (when on) comes first; then weekly OT
 * over WEEKLY_OT_MINUTES of the remaining regular time, allocated to the latest days of the
 * pay week. OT is computed here at export, never stored per entry.
 */
export function allocateOvertime(
  rows: OtRow[],
  opts: { weeklyMinutes?: number; dailyMinutes?: number | null; weekStarts?: number } = {},
): Map<string, { regular: number; overtime: number }> {
  const weekly = opts.weeklyMinutes ?? WEEKLY_OT_MINUTES;
  const daily = opts.dailyMinutes === undefined ? DAILY_OT_MINUTES : opts.dailyMinutes;
  const out = new Map<string, { regular: number; overtime: number }>();
  const sorted = [...rows].sort(
    (a, b) => a.userId.localeCompare(b.userId) || a.day.localeCompare(b.day) || (a.order ?? a.key).localeCompare(b.order ?? b.key),
  );
  const dayUsed = new Map<string, number>();
  for (const row of sorted) {
    let regular = row.minutes;
    let overtime = 0;
    if (daily != null) {
      const k = `${row.userId}|${row.day}`;
      const before = dayUsed.get(k) ?? 0;
      const room = Math.max(0, daily - before);
      overtime = Math.max(0, regular - room);
      regular -= overtime;
      dayUsed.set(k, before + row.minutes);
    }
    out.set(row.key, { regular, overtime });
  }
  const weekUsed = new Map<string, number>();
  for (const row of sorted) {
    const k = `${row.userId}|${payWeekStart(row.day, opts.weekStarts ?? 1)}`;
    const cur = out.get(row.key)!;
    const before = weekUsed.get(k) ?? 0;
    const room = Math.max(0, weekly - before);
    const moved = Math.max(0, cur.regular - room);
    weekUsed.set(k, before + cur.regular - moved);
    out.set(row.key, { regular: cur.regular - moved, overtime: cur.overtime + moved });
  }
  return out;
}

// ---------------------------------------------------------------- payroll CSV

export const PAYROLL_HEADER = [
  "employee_number",
  "employee_name",
  "email",
  "period_start",
  "period_end",
  "work_date",
  "job_name",
  "job_id",
  "cost_code",
  "cost_code_name",
  "regular_hours",
  "overtime_hours",
  "approved_by",
  "approved_at",
  "notes",
] as const;

export type PayrollRow = {
  employeeNumber: string;
  employeeName: string;
  email: string;
  workDate: string;
  jobName: string;
  jobId: string;
  costCode: string;
  costCodeName: string;
  regularMinutes: number;
  overtimeMinutes: number;
  approvedBy: string;
  approvedAt: string;
  notes: string;
  subCompany?: string;
  rateCents?: number;
  amountCents?: number;
};

/** One CSV cell: quoted when needed, and text that a spreadsheet would run as a formula is neutralised. */
export function csvCell(value: string | number): string {
  let s = String(value ?? "");
  if (typeof value === "string" && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function payrollCsv(
  rows: PayrollRow[],
  period: { start: string; end: string },
  opts: { kind?: "payroll" | "sub_hours"; includeRates?: boolean } = {},
): string {
  const sub = opts.kind === "sub_hours";
  const rates = !sub && (opts.includeRates ?? PAYROLL_CSV_INCLUDE_RATES);
  const header: string[] = [...PAYROLL_HEADER];
  if (sub) header.push("sub_company");
  if (rates) header.push("rate", "amount");
  const lines = [header.join(",")];
  for (const r of rows) {
    const cells: (string | number)[] = [
      r.employeeNumber,
      r.employeeName,
      r.email,
      period.start,
      period.end,
      r.workDate,
      r.jobName,
      r.jobId,
      r.costCode,
      r.costCodeName,
      decimalHours(r.regularMinutes),
      decimalHours(r.overtimeMinutes),
      r.approvedBy,
      r.approvedAt,
      r.notes,
    ];
    if (sub) cells.push(r.subCompany ?? "");
    if (rates) cells.push(((r.rateCents ?? 0) / 100).toFixed(2), ((r.amountCents ?? 0) / 100).toFixed(2));
    lines.push(cells.map((c) => (typeof c === "number" ? String(c) : csvCell(c))).join(","));
  }
  // UTF-8 BOM so Excel opens accented names correctly; CRLF per RFC 4180.
  return `\uFEFF${lines.join("\r\n")}\r\n`;
}

export function payrollFilename(kind: "payroll" | "sub_hours", period: { start: string; end: string }): string {
  return `rcl-${kind === "sub_hours" ? "sub-hours" : "payroll"}-${period.start}_${period.end}.csv`;
}

/** Labor cost of minutes at a rate: minutes/60 × rate × (1 + burden%). Integer cents. */
export function laborCents(minutes: number, rateCents: number, burdenPct: number): number {
  return Math.round((minutes / 60) * rateCents * (1 + (Number(burdenPct) || 0) / 100));
}
