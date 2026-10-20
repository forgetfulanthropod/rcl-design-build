/**
 * Which job a form should start on (spec 05 · F3). The server supplies the report-based
 * hints; the browser adds the last job picked in any form (localStorage "rcl.lastJob").
 * Order: today's report job → most recent report job in the last 14 days → last picked →
 * the company's only active job → none ("Pick a job", required).
 * (Crew assignments from spec 01 will slot in first once they ship.)
 */
export type JobHints = { todayJobId: string | null; recentJobId: string | null; activeJobIds: string[] };
export type CurrentJobSource = "today" | "recent" | "last" | "only" | "none";

export const LAST_JOB_KEY = "rcl.lastJob";
export const NO_JOB_LABEL = "Company-wide (no job)";
export const PICK_A_JOB = "Pick a job.";

export function resolveCurrentJob(hints: JobHints, lastPicked: string | null): { id: string; source: CurrentJobSource } {
  const active = new Set(hints.activeJobIds);
  const ok = (id: string | null | undefined): id is string => Boolean(id) && active.has(id as string);
  if (ok(hints.todayJobId)) return { id: hints.todayJobId, source: "today" };
  if (ok(hints.recentJobId)) return { id: hints.recentJobId, source: "recent" };
  if (ok(lastPicked)) return { id: lastPicked, source: "last" };
  if (hints.activeJobIds.length === 1) return { id: hints.activeJobIds[0], source: "only" };
  return { id: "", source: "none" };
}

const COMPANY_WIDE_DOCS = new Set(["policy", "bid"]);
const OFFICE = new Set(["owner", "admin", "superadmin"]);

/** Docs kinds that may be company-wide. Everything else (RFI, submittal, CO, invoice) needs a job. */
export function docMayBeCompanyWide(kind: string): boolean {
  return COMPANY_WIDE_DOCS.has(kind);
}

/** Only owner/admin activities may be company-wide. */
export function activityMayBeCompanyWide(role: string): boolean {
  return OFFICE.has(role === "sub" ? "subcontractor" : role);
}

/** Server-side guard: throws "Pick a job." when a job is required and missing. */
export function requireJob(projectId: string | null | undefined, companyWideOk: boolean): void {
  if (!companyWideOk && !projectId) throw new Error(PICK_A_JOB);
}
