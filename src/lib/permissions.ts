import { normalizeRole, type Role } from "./roles.ts";

/** Every server action that a role can or cannot take. */
export const ACTIONS = [
  "money.view",
  "project.create",
  "project.phase",
  "project.archive",
  "milestone.create",
  "milestone.toggle",
  "rfi.create",
  "rfi.status",
  "co.create",
  "co.status",
  "log.create",
  "workorder.create",
  "workorder.update", // full edit: assignee, priority, any order
  "workorder.updateOwn", // status + notes on orders assigned to me
  "crew.view",
  "crew.invite",
  "crew.inviteAdmin",
  "foreman.use",
  "code.approve",
  "report.write", // write my own daily report
  "report.review", // browse everyone's reports + AI attention summary
  "activity.add",
  "activity.edit",
  "activity.approve",
  "safety.write",
  "safety.manage",
  "doc.view",
  "doc.create",
  "doc.send",
  "doc.status",
  "jsa.write", // record the daily job safety analysis (lead and up); labor only reads it
] as const;
export type Action = (typeof ACTIONS)[number];

const ALL = new Set<Action>(ACTIONS);
const without = (...drop: Action[]) => new Set<Action>(ACTIONS.filter((a) => !drop.includes(a)));
// Field roles read documents; creating them (RFIs included) is the lead's job (spec 05 · F2c).
const FIELD = new Set<Action>(["log.create", "workorder.updateOwn", "report.write", "doc.view"]);
const LABOR = new Set<Action>([...FIELD, "activity.add", "activity.edit", "safety.write", "doc.send"]);

const MATRIX: Record<Role, Set<Action>> = {
  superadmin: ALL,
  owner: without("code.approve"),
  admin: without("code.approve", "crew.inviteAdmin"),
  lead: new Set<Action>([
    "project.phase",
    "milestone.create",
    "milestone.toggle",
    "rfi.create",
    "rfi.status",
    "co.create",
    "log.create",
    "workorder.create",
    "workorder.update",
    "workorder.updateOwn",
    "crew.view",
    "report.write",
    "activity.add",
    "activity.edit",
    "activity.approve",
    "safety.write",
    "safety.manage",
    "jsa.write",
    "doc.view",
    "doc.create",
    "doc.send",
    "doc.status",
  ]),
  labor: LABOR,
  sub: FIELD,
};

export function can(role: string, action: Action): boolean {
  const r = normalizeRole(role);
  return r ? MATRIX[r].has(action) : false;
}

export class ForbiddenError extends Error {
  constructor(action: Action) {
    super(`Your role can't do that (${action}).`);
    this.name = "ForbiddenError";
  }
}

export function assertCan(role: string, action: Action): void {
  if (!can(role, action)) throw new ForbiddenError(action);
}

/** Roles a given inviter may assign. */
export function invitableRoles(role: string): Role[] {
  if (!can(role, "crew.invite")) return [];
  const base: Role[] = ["lead", "labor", "sub"];
  if (can(role, "crew.inviteAdmin")) return ["owner", "admin", ...base];
  return base;
}

export type NavId = "today" | "mine" | "reports" | "attention" | "activities" | "safety" | "docs";

/**
 * The app is slimmed to daily reports. Principals (report.review) review; everyone else writes.
 * The older desk views (jobs, dispatch, RFIs, change orders, milestones, Foreman) are hidden from nav.
 */
export function navFor(role: string): NavId[] {
  const items: NavId[] = [];
  if (can(role, "report.review")) items.push("reports", "attention");
  else if (can(role, "report.write")) items.push("today", "mine");
  if (can(role, "activity.add") || can(role, "activity.approve")) items.push("activities");
  if (can(role, "doc.view")) items.push("docs");
  if (can(role, "safety.write") || can(role, "safety.manage")) items.push("safety");
  return items;
}

type Moneyed = {
  projects: { contractValue: number }[];
  changeOrders: { amount: number }[];
};

/** Strip dollar amounts for roles without money.view. Returns a new object. */
export function redactForRole<T extends Moneyed>(role: string, data: T): T & { moneyHidden: boolean } {
  if (can(role, "money.view")) return { ...data, moneyHidden: false };
  return {
    ...data,
    projects: data.projects.map((p) => ({ ...p, contractValue: 0 })),
    changeOrders: data.changeOrders.map((c) => ({ ...c, amount: 0 })),
    moneyHidden: true,
  };
}
