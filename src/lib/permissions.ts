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
] as const;
export type Action = (typeof ACTIONS)[number];

const ALL = new Set<Action>(ACTIONS);
const without = (...drop: Action[]) => new Set<Action>(ACTIONS.filter((a) => !drop.includes(a)));
const FIELD = new Set<Action>(["rfi.create", "log.create", "workorder.updateOwn"]);

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
  ]),
  labor: FIELD,
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

export type NavId = "desk" | "jobs" | "field" | "comms" | "foreman" | "crew";

/** Bottom nav per role. Never more than 5 tabs. */
export function navFor(role: string): NavId[] {
  const r = normalizeRole(role);
  switch (r) {
    case "superadmin":
      return ["desk", "jobs", "field", "crew", "foreman"];
    case "owner":
    case "admin":
      return ["desk", "jobs", "field", "crew", "comms"];
    case "lead":
      return ["desk", "field", "jobs", "crew"];
    case "labor":
    case "sub":
      return ["desk", "field", "comms"];
    default:
      return ["desk"];
  }
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
