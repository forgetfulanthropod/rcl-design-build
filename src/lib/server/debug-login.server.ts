// Debug persona sign-in into an isolated demo company.
// ON BY DEFAULT. Turn off with DEBUG_LOGIN=false (checked on the server for every call).
// WARNING: while on, anyone who can reach the login page can sign in to the demo company as any persona.
// The demo company is a normal company row (DEMO_COMPANY_ID); every query is company-scoped, so it
// cannot see real companies' data, and its outbound email/SMS is never delivered (see deliverOutbound).
import { randomUUID } from "node:crypto";
import { getSql, type Sql } from "@/lib/db";
import { DEMO_COMPANY_ID } from "@/lib/demo";
import { COPY_PATH, COPY_SOURCE, WORKFLOW_PATH, WORKFLOW_SOURCE } from "@/lib/product";
import { insertMagicLink } from "@/lib/server/magic.server";
import type { Role } from "@/lib/roles";

export const DEBUG_ROLES = ["owner", "admin", "lead", "labor", "subcontractor"] as const;
export type DebugRole = (typeof DEBUG_ROLES)[number];

/** Personas use the roles-foundation roles (src/lib/roles.ts). */
export const DEBUG_ROLE_MAP: Record<DebugRole, { role: Role; name: string; email: string; phone: string | null }> = {
  owner: { role: "owner", name: "Olivia Grant", email: "owner@demo.rcl.test", phone: null },
  admin: { role: "admin", name: "Adam Price", email: "admin@demo.rcl.test", phone: null },
  lead: { role: "lead", name: "Lena Ortiz", email: "lead@demo.rcl.test", phone: null },
  labor: { role: "labor", name: "Luis Moreno", email: "labor@demo.rcl.test", phone: null },
  subcontractor: { role: "sub", name: "Sam Whitfield (Bluegrass Electric)", email: "sub@demo.rcl.test", phone: null },
};

const DEMO_EMAILS = Object.values(DEBUG_ROLE_MAP).map((p) => p.email);

export function debugLoginEnabled(): boolean {
  return process.env.DEBUG_LOGIN !== "false";
}

async function userIdFor(sql: Sql, email: string, name: string): Promise<string> {
  const found = await sql<{ id: string }>`select "id" from "user" where lower("email") = ${email}`;
  if (found[0]?.id) return found[0].id;
  const id = randomUUID();
  await sql`
    insert into "user" ("id", "name", "email", "emailVerified", "createdAt", "updatedAt")
    values (${id}, ${name}, ${email}, true, now(), now())
  `;
  return id;
}

async function seedDemo(sql: Sql) {
  await sql`insert into companies (id, name) values (${DEMO_COMPANY_ID}, ${"Demo: RCL Design Build"})`;
  await sql`
    insert into source_files (company_id, path, content) values
      (${DEMO_COMPANY_ID}, ${COPY_PATH}, ${COPY_SOURCE}),
      (${DEMO_COMPANY_ID}, ${WORKFLOW_PATH}, ${WORKFLOW_SOURCE})
  `;
  const ids = {} as Record<DebugRole, string>;
  for (const key of DEBUG_ROLES) {
    const p = DEBUG_ROLE_MAP[key];
    const id = await userIdFor(sql, p.email, p.name);
    ids[key] = id;
    // A demo persona belongs only to the demo company.
    await sql`delete from profiles where user_id = ${id}`;
    await sql`
      insert into profiles (user_id, company_id, name, email, phone, role)
      values (${id}, ${DEMO_COMPANY_ID}, ${p.name}, ${p.email}, ${p.phone}, ${p.role})
    `;
  }
  const { seedSample } = await import("@/lib/server/data.server");
  await seedSample(sql, DEMO_COMPANY_ID, ids.owner);

  const jobs = [
    ["Whitaker kitchen remodel", "Whitaker family", "418 Whitaker Ln, Lexington, KY", "Build", 142000, "Full gut kitchen, new island, relocated sink wall."],
    ["Oak Street duplex addition", "Oak Street Partners", "1510 Oak St, Lexington, KY", "Permit", 388000, "Two-story rear addition, 2 bed / 1 bath per unit."],
    ["Chevy Chase dental fit-up", "Bright Smiles PLLC", "820 Euclid Ave, Lexington, KY", "Design", 265000, "Tenant fit-up, 4 operatories, ADA restroom."],
  ] as const;
  const jobIds: string[] = [];
  for (const [name, client, address, phase, value, summary] of jobs) {
    const id = randomUUID();
    jobIds.push(id);
    await sql`
      insert into projects (id, company_id, name, client_name, address, phase, contract_value, summary)
      values (${id}, ${DEMO_COMPANY_ID}, ${name}, ${client}, ${address}, ${phase}, ${value}, ${summary})
    `;
  }
  const orders: [string, string, string, string, string, string, DebugRole | null, number][] = [
    ["Punch list walk-through", "Whitaker family", "418 Whitaker Ln", "Remodel", "Normal", "Scheduled", "labor", 0],
    ["Set base cabinets, east wall", "Whitaker family", "418 Whitaker Ln", "Remodel", "High", "On site", "labor", 0],
    ["Rough-in electrical, unit B", "Oak Street Partners", "1510 Oak St", "Addition", "Normal", "Scheduled", "subcontractor", 1],
    ["Layout for operatory walls", "Bright Smiles PLLC", "820 Euclid Ave", "Fit-up", "Normal", "New", null, 2],
    ["Leaking shutoff under sink", "Elena Ortiz", "77 Birch Ct", "Repairs", "Rush", "New", "labor", -1],
  ];
  for (const [title, customer, site, trade, priority, status, who, job] of orders) {
    await sql`
      insert into work_orders (
        id, company_id, project_id, customer, site, title, trade, priority, status, notes, created_by, assigned_user_id
      ) values (
        ${randomUUID()}, ${DEMO_COMPANY_ID}, ${job >= 0 ? jobIds[job] : null}, ${customer}, ${site}, ${title},
        ${trade}, ${priority}, ${status}, ${"Demo data. Edits here are real and saved."}, ${ids.lead},
        ${who ? ids[who] : null}
      )
    `;
  }
  const today = new Date().toISOString().slice(0, 10);
  await sql`
    insert into daily_logs (id, company_id, project_id, log_date, crew, weather, notes, created_by)
    values (${randomUUID()}, ${DEMO_COMPANY_ID}, ${jobIds[0]}, ${today}, ${3}, ${"Overcast, 61F"},
            ${"Cabinets delivered. Island base set and leveled. Countertop template Thursday."}, ${ids.lead})
  `;
}

/** Seeds the demo company if it's missing. Safe to call repeatedly (called when the login page loads). */
export async function ensureDemoCompany(): Promise<void> {
  const sql = await getSql();
  const found = await sql<{ id: string }>`select id from companies where id = ${DEMO_COMPANY_ID}`;
  if (found[0]) return;
  try {
    await seedDemo(sql);
  } catch (error) {
    // A concurrent first load may have seeded it; anything else is real.
    const again = await sql<{ id: string }>`select id from companies where id = ${DEMO_COMPANY_ID}`;
    if (!again[0]) throw error;
  }
}

/** Wipes the demo company (cascade) and seeds it again. Demo personas' sessions are signed out. */
export async function resetDemoCompany(): Promise<void> {
  if (!debugLoginEnabled()) throw new Error("Debug sign-in is turned off.");
  const sql = await getSql();
  await sql`delete from companies where id = ${DEMO_COMPANY_ID}`;
  await sql.query(
    `delete from "session" where "userId" in (select "id" from "user" where lower("email") = any($1))`,
    [DEMO_EMAILS],
  );
  await ensureDemoCompany();
}

/** Returns a single-use magic-link path that signs in as the demo persona. */
export async function debugSignIn(role: string): Promise<{ path: string }> {
  if (!debugLoginEnabled()) throw new Error("Debug sign-in is turned off.");
  if (!(DEBUG_ROLES as readonly string[]).includes(role)) throw new Error("Unknown debug role.");
  await ensureDemoCompany();
  const who = DEBUG_ROLE_MAP[role as DebugRole];
  const path = await insertMagicLink({
    channel: "email",
    destination: who.email,
    email: who.email,
    displayName: who.name,
    companyId: DEMO_COMPANY_ID,
    role: who.role,
    action: null,
    proposalId: null,
    redirectPath: "/",
    minutes: 5,
  });
  return { path };
}
