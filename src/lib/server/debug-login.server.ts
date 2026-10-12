// Debug sign-in for demo roles. Server-gated by DEBUG_LOGIN=true.
// WARNING: while enabled, anyone who can reach the login page can sign in as these demo users.
import { getSql } from "@/lib/db";
import { insertMagicLink } from "@/lib/server/magic.server";
import type { Role } from "@/lib/roles";

export const DEBUG_ROLES = ["owner", "admin", "lead", "labor", "subcontractor"] as const;
export type DebugRole = (typeof DEBUG_ROLES)[number];

/** Requested roles mapped onto the app's existing roles (src/lib/roles.ts). */
export const DEBUG_ROLE_MAP: Record<DebugRole, { role: Role; name: string; email: string }> = {
  owner: { role: "admin", name: "Olivia Owner", email: "owner@demo.rcl.test" },
  admin: { role: "admin", name: "Adam Admin", email: "admin@demo.rcl.test" },
  lead: { role: "superintendent", name: "Lena Lead", email: "lead@demo.rcl.test" },
  labor: { role: "field", name: "Luis Labor", email: "labor@demo.rcl.test" },
  subcontractor: { role: "field", name: "Sam Subcontractor", email: "sub@demo.rcl.test" },
};

const DEMO_COMPANY = "RCL Demo Co (debug)";

export function debugLoginEnabled(): boolean {
  return process.env.DEBUG_LOGIN === "true";
}

async function userIdFor(email: string, name: string): Promise<string> {
  const sql = await getSql();
  const found = await sql<{ id: string }>`select "id" from "user" where lower("email") = ${email}`;
  if (found[0]?.id) return found[0].id;
  const id = crypto.randomUUID();
  await sql`
    insert into "user" ("id", "name", "email", "emailVerified", "createdAt", "updatedAt")
    values (${id}, ${name}, ${email}, true, now(), now())
  `;
  return id;
}

/** Creates (once) the demo company, owned by the owner user, with the app's sample data. */
async function demoCompanyId(): Promise<string> {
  const sql = await getSql();
  const owner = DEBUG_ROLE_MAP.owner;
  const ownerId = await userIdFor(owner.email, owner.name);
  const existing = await sql<{ company_id: string }>`
    select company_id from profiles where user_id = ${ownerId}
  `;
  if (existing[0]?.company_id) return existing[0].company_id;
  const { completeSetup } = await import("@/lib/server/data.server");
  await completeSetup(ownerId, { name: owner.name, companyName: DEMO_COMPANY, phone: "" });
  const rows = await sql<{ company_id: string }>`select company_id from profiles where user_id = ${ownerId}`;
  if (!rows[0]?.company_id) throw new Error("Could not create the demo company.");
  return rows[0].company_id;
}

/** Returns a single-use magic-link path that signs in as the demo user for this role. */
export async function debugSignIn(role: string): Promise<{ path: string }> {
  if (!debugLoginEnabled()) throw new Error("Debug sign-in is turned off.");
  if (!(DEBUG_ROLES as readonly string[]).includes(role)) throw new Error("Unknown debug role.");
  const who = DEBUG_ROLE_MAP[role as DebugRole];
  const companyId = await demoCompanyId();
  const path = await insertMagicLink({
    channel: "email",
    destination: who.email,
    email: who.email,
    displayName: who.name,
    companyId,
    role: who.role,
    action: null,
    proposalId: null,
    redirectPath: "/",
    minutes: 5,
  });
  return { path };
}
