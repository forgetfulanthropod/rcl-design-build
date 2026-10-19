import { normalizeRole, type Role } from "./roles.ts";
import type { Sharing, SharingKey } from "./sharing.ts";

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
  "crew.board.view", // whole-company week board (spec 01)
  "crew.assign", // create/move/remove draft assignments
  "crew.publish", // publish drafts + outbound messages
  "skill.manage", // trades, certs, job requirements
  "crew.unavailable.confirm", // confirm/decline requested time off
  "crew.myWeek", // own week + request off (everyone)
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
  "budget.dollars", // budget, actual and change-order $ on Budgets (03); Leads only via lead_budget_dollars
  "settings.sharing.view",
  "settings.sharing.edit",
  "project.sharingReview", // "Mark reviewed" on one job (spec 06)
] as const;
export type Action = (typeof ACTIONS)[number];

const ALL = new Set<Action>(ACTIONS);
const without = (...drop: Action[]) => new Set<Action>(ACTIONS.filter((a) => !drop.includes(a)));
const FIELD = new Set<Action>([
  "rfi.create",
  "log.create",
  "workorder.updateOwn",
  "report.write",
  "doc.view",
  "doc.create",
  "crew.myWeek",
]);
// doc.send is not in LABOR: Labor sends only where "Labor can send documents" is on (spec 06).
const LABOR = new Set<Action>([...FIELD, "activity.add", "activity.edit", "safety.write"]);

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
    "crew.board.view",
    "crew.assign",
    "crew.publish",
    "crew.unavailable.confirm",
    "crew.myWeek",
    "report.write",
    "activity.add",
    "activity.edit",
    "activity.approve",
    "safety.write",
    "safety.manage",
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

/**
 * Sharing settings grant on top of the role matrix and never take anything away (spec 06).
 * Pay rates (rate.view), money.view, bids and invoices are never granted by a setting.
 */
export const SHARING_GRANTS: Partial<Record<Action, { role: Role; key: SharingKey }[]>> = {
  "budget.dollars": [{ role: "lead", key: "lead_budget_dollars" }],
  "doc.send": [{ role: "labor", key: "labor_doc_send" }],
};

export function canWith(role: string, action: Action, sharing: Sharing): boolean {
  if (can(role, action)) return true;
  const r = normalizeRole(role);
  if (!r) return false;
  return (SHARING_GRANTS[action] ?? []).some((grant) => grant.role === r && sharing[grant.key] === true);
}

export function assertCanWith(role: string, action: Action, sharing: Sharing): void {
  if (!canWith(role, action, sharing)) throw new ForbiddenError(action);
}

/** Roles a given inviter may assign. */
export function invitableRoles(role: string): Role[] {
  if (!can(role, "crew.invite")) return [];
  const base: Role[] = ["lead", "labor", "sub"];
  if (can(role, "crew.inviteAdmin")) return ["owner", "admin", ...base];
  return base;
}

export type NavId = "today" | "mine" | "reports" | "attention" | "crew" | "activities" | "safety" | "docs";

/**
 * The app is slimmed to daily reports. Principals (report.review) review; everyone else writes.
 * Owner/Admin/Lead also get Crew (spec 01). The older desk views stay hidden from nav.
 */
export function navFor(role: string): NavId[] {
  const items: NavId[] = [];
  if (can(role, "report.review")) items.push("reports", "attention");
  else if (can(role, "report.write")) items.push("today", "mine");
  if (can(role, "crew.board.view")) items.push("crew");
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
