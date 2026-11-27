/**
 * Dispatch map selectors.
 *
 * The server hands back facts (jobs, people, and every day someone was on a
 * job). `selectDispatchMap` turns those facts into the picture for one date,
 * so the slider can move across a year back and six months ahead without
 * another request.
 *
 * Progress is the job's phase percent as of today. Dragging backward scales
 * that percent by how much of the crew's time on the job had already happened.
 * Dragging forward walks the remaining gap to 100% across days that are
 * already scheduled. A job with no future assignments stays at today's percent.
 */
import { addDays, parseDay } from "./crew.ts";

export const MAP_PAST_DAYS = 365;
export const MAP_FUTURE_DAYS = 182;

export const MAP_STAGES = ["nothing", "starting", "maturing", "finished"] as const;
export type MapStage = (typeof MAP_STAGES)[number];

export const PRESENCE_KINDS = ["assignment", "session", "activity", "report"] as const;
export type PresenceKind = (typeof PRESENCE_KINDS)[number];

export type MapPresence = {
  userId: string;
  projectId: string;
  day: string;
  kind: PresenceKind;
};

export type MapJobInput = {
  id: string;
  name: string;
  address: string;
  phase: string;
  lat: number;
  lng: number;
};

export type MapPersonInput = {
  userId: string;
  name: string;
  active: boolean;
};

export type DispatchMapFacts = {
  today: string;
  rangeStart: string;
  rangeEnd: string;
  canEdit: boolean;
  jobs: MapJobInput[];
  people: MapPersonInput[];
  presences: MapPresence[];
};

export type WorkerChip = {
  userId: string;
  name: string;
  initials: string;
  /** Distinct days on this job on or before the slider date. */
  days: number;
};

export type JobBubble = {
  id: string;
  name: string;
  address: string;
  phase: string;
  lat: number;
  lng: number;
  percent: number;
  stage: MapStage;
  /** Nobody is assigned on the following day, and that day is still ahead. */
  needsCrew: boolean;
  nextDay: string;
  lastActive: WorkerChip[];
  nextCrew: WorkerChip[];
};

export type DispatchMapView = {
  asOf: string;
  nextDay: string;
  today: string;
  canEdit: boolean;
  /** Assigning writes a future day. History stays read-only. */
  canAssign: boolean;
  jobs: JobBubble[];
  needsCrewCount: number;
};

export type CrewOption = {
  userId: string;
  name: string;
  assignedHere: boolean;
  /** Job name when this person is already on a different job that day. */
  busyElsewhere: string | null;
};

const DAY = /^\d{4}-\d{2}-\d{2}$/;

export function mapRange(today: string): { start: string; end: string } {
  return { start: addDays(today, -MAP_PAST_DAYS), end: addDays(today, MAP_FUTURE_DAYS) };
}

export function daysBetween(start: string, end: string): number {
  const ms = parseDay(end).getTime() - parseDay(start).getTime();
  return Math.round(ms / 86_400_000);
}

export function sliderSpan(today: string): number {
  const range = mapRange(today);
  return daysBetween(range.start, range.end);
}

export function clampAsOf(today: string, asOf: string): string {
  const range = mapRange(today);
  if (!DAY.test(asOf) || asOf < range.start) return range.start;
  if (asOf > range.end) return range.end;
  return asOf;
}

export function asOfFromIndex(today: string, index: number): string {
  const range = mapRange(today);
  const span = daysBetween(range.start, range.end);
  const clamped = Math.max(0, Math.min(span, Math.round(index)));
  return addDays(range.start, clamped);
}

export function indexFromAsOf(today: string, asOf: string): number {
  return daysBetween(mapRange(today).start, clampAsOf(today, asOf));
}

/** Where the recorded phase sits on a 0–100 job, as of today. */
export function phasePercent(phase: string): number {
  switch (phase.trim().toLowerCase()) {
    case "schematic":
    case "precon":
      return 8;
    case "design":
      return 22;
    case "permit":
      return 40;
    case "build":
      return 68;
    case "finish":
    case "closeout":
    case "done":
      return 100;
    default:
      return 0;
  }
}

export function stageForPercent(percent: number): MapStage {
  if (percent <= 0) return "nothing";
  if (percent < 34) return "starting";
  if (percent < 90) return "maturing";
  return "finished";
}

function dayOf(slot: string): string {
  return slot.slice(0, 10);
}

/**
 * Completion at `asOf`. `personDays` are `YYYY-MM-DD|userId` keys (one per
 * person per calendar day, whatever recorded the time).
 */
export function progressAt(input: {
  phase: string;
  asOf: string;
  today: string;
  personDays: string[];
}): number {
  const target = phasePercent(input.phase);
  const slots = [...new Set(input.personDays.filter((slot) => DAY.test(dayOf(slot))))];
  const past = slots.filter((slot) => dayOf(slot) <= input.today);
  const future = slots.filter((slot) => dayOf(slot) > input.today);
  if (input.asOf <= input.today) {
    if (past.length === 0) return input.asOf < input.today ? 0 : target;
    const had = past.filter((slot) => dayOf(slot) <= input.asOf).length;
    if (had === 0) return 0;
    return Math.round((target * had) / past.length);
  }
  if (future.length === 0) return target;
  const reached = future.filter((slot) => dayOf(slot) <= input.asOf).length;
  const gap = 100 - target;
  return Math.min(100, Math.round(target + (gap * reached) / future.length));
}

export function initials(name: string): string {
  const words = name
    .replace(/[()]/g, " ")
    .split(/\s+/)
    .map((word) => word.trim())
    .filter((word) => /[A-Za-z]/.test(word));
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase();
  return `${words[0]![0] ?? ""}${words[1]![0] ?? ""}`.toUpperCase();
}

export function formatMapDay(iso: string): string {
  return parseDay(iso).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function mapDayCaption(today: string, asOf: string): string {
  const delta = daysBetween(today, asOf);
  if (delta === 0) return "Today";
  if (delta === 1) return "Tomorrow";
  if (delta === -1) return "Yesterday";
  if (delta > 1) return `${delta} days ahead`;
  return `${-delta} days ago`;
}

function personDayKey(userId: string, day: string): string {
  return `${day}|${userId}`;
}

function chip(person: MapPersonInput | undefined, userId: string, days: number): WorkerChip {
  const name = person?.name || "Crew";
  return { userId, name, initials: initials(name), days };
}

function byName(a: WorkerChip, b: WorkerChip): number {
  return a.name.localeCompare(b.name) || a.userId.localeCompare(b.userId);
}

export function selectDispatchMap(facts: DispatchMapFacts, rawAsOf: string): DispatchMapView {
  const asOf = clampAsOf(facts.today, rawAsOf);
  const nextDay = addDays(asOf, 1);
  // The following day is only actionable when it is still ahead and inside the window.
  const inWindow = nextDay >= facts.today && nextDay <= facts.rangeEnd;
  const canAssign = facts.canEdit && inWindow;
  const people = new Map(facts.people.map((person) => [person.userId, person]));

  const jobs = facts.jobs.map((job) => {
    const onJob = facts.presences.filter((row) => row.projectId === job.id && DAY.test(row.day));
    const slots = [...new Set(onJob.map((row) => personDayKey(row.userId, row.day)))];
    const percent = progressAt({ phase: job.phase, asOf, today: facts.today, personDays: slots });
    const stage = stageForPercent(percent);

    const daysByUser = new Map<string, number>();
    for (const slot of slots) {
      const day = dayOf(slot);
      if (day > asOf) continue;
      const userId = slot.slice(11);
      daysByUser.set(userId, (daysByUser.get(userId) ?? 0) + 1);
    }

    // Latest day each person worked anywhere, on or before the slider.
    const latest = new Map<string, string>();
    for (const row of facts.presences) {
      if (!DAY.test(row.day) || row.day > asOf) continue;
      const prev = latest.get(row.userId);
      if (!prev || row.day > prev) latest.set(row.userId, row.day);
    }
    const lastActive: WorkerChip[] = [];
    for (const [userId, day] of latest) {
      const here = onJob.some((row) => row.userId === userId && row.day === day);
      if (!here) continue;
      lastActive.push(chip(people.get(userId), userId, daysByUser.get(userId) ?? 0));
    }
    lastActive.sort(byName);

    const nextIds = new Set(
      onJob.filter((row) => row.kind === "assignment" && row.day === nextDay).map((row) => row.userId),
    );
    const nextCrew = [...nextIds]
      .map((userId) => chip(people.get(userId), userId, daysByUser.get(userId) ?? 0))
      .sort(byName);

    const needsCrew = stage !== "finished" && nextCrew.length === 0 && inWindow;
    return {
      id: job.id,
      name: job.name,
      address: job.address,
      phase: job.phase,
      lat: job.lat,
      lng: job.lng,
      percent,
      stage,
      needsCrew,
      nextDay,
      lastActive,
      nextCrew,
    };
  });

  jobs.sort((a, b) => Number(b.needsCrew) - Number(a.needsCrew) || a.name.localeCompare(b.name));

  return {
    asOf,
    nextDay,
    today: facts.today,
    canEdit: facts.canEdit,
    canAssign,
    jobs,
    needsCrewCount: jobs.filter((job) => job.needsCrew).length,
  };
}

/** Who can be picked for `day` on `projectId`. Already-there people stay checked. */
export function crewOptions(facts: DispatchMapFacts, projectId: string, day: string): CrewOption[] {
  const names = new Map(facts.jobs.map((job) => [job.id, job.name]));
  const assigned = new Map<string, string>();
  for (const row of facts.presences) {
    if (row.kind !== "assignment" || row.day !== day) continue;
    assigned.set(row.userId, row.projectId);
  }
  return facts.people
    .filter((person) => person.active)
    .map((person) => {
      const project = assigned.get(person.userId) ?? null;
      return {
        userId: person.userId,
        name: person.name,
        assignedHere: project === projectId,
        busyElsewhere: project && project !== projectId ? (names.get(project) ?? "another job") : null,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}
