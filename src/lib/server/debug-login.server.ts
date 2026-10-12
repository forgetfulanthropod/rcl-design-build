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
import { DEMO_PHOTOS } from "@/lib/server/demo-photos";
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
  await seedReports(sql, ids, jobIds);
}

// A week of realistic daily reports. [daysAgo, persona, job index or -1, narrative, photo indexes, lunch]
const WEEK: [number, DebugRole, number, string, number[], number][] = [
  [6, "labor", 0, "Demo'd the old soffit over the sink wall and hauled two loads to the dumpster. Found knob-and-tube in the ceiling cavity, left it alone and flagged it for the electrician.", [0], 30],
  [6, "lead", 0, "Walked Whitaker with the homeowner. She wants the pantry door swapped to a pocket door; told her we'd price it. Cabinet delivery confirmed for Wednesday.", [], 30],
  [5, "labor", 0, "Patched and sistered two joists under the sink wall. Subfloor is soft by the dishwasher, about a 2x3 area, looks like an old leak.", [2], 30],
  [5, "subcontractor", 1, "Rough-in electrical on unit B, first floor done. Waiting on the panel location from the GC before I can run the homeruns.", [0], 20],
  [4, "labor", 0, "Replaced the soft subfloor by the dishwasher. Set blocking for the upper cabinets. Ran out of 3/4 ply, used the last sheet.", [5], 30],
  [4, "lead", 1, "Oak Street inspection passed for footings. Excavator left a rut in the neighbor's lawn along the north side, need to get it seeded before they call.", [4], 45],
  [3, "labor", 0, "Cabinets delivered. Two of the base boxes are crushed on the corner (B24 and the sink base). Photos taken. Set the rest of the uppers.", [1, 2], 30],
  [3, "subcontractor", 1, "Panel location settled. Ran homeruns for unit B. Unit A still blocked because framers haven't set the stair wall.", [0], 15],
  [2, "lead", 2, "Dental fit-up: client changed operatory 3 to a sterilization room. Need revised drawings before we can frame. Pushes framing at least a week.", [], 30],
  [2, "labor", 0, "Leveled the island base. Ladder on site has a cracked rail, tagged it and set it aside. We're down to one 8' ladder.", [5], 30],
  [1, "labor", 0, "Set the replacement sink base. Drywall delivery came short by 12 sheets of 1/2, so we stopped hanging at the hallway.", [3], 30],
  [1, "subcontractor", 1, "Unit A stair wall is up, started rough-in. Homeowner on the other side complained about the noise before 8, we'll start at 8 from now on.", [0], 20],
  [1, "lead", 0, "Countertop templating moved to Friday; fabricator had a truck down. Homeowner OK with it.", [], 30],
  [0, "lead", 0, "Whitaker: island set, countertop template Friday. Still waiting on 12 sheets of drywall. Ordered a second 8' ladder.", [5], 30],
  [0, "subcontractor", 1, "Finished unit A rough-in. Inspection requested for Thursday. Need someone to unlock the garage for the inspector.", [0], 20],
];

async function seedReports(sql: Sql, ids: Record<DebugRole, string>, jobIds: string[]) {
  const reg = await sql<{ t: string | null }>`select to_regclass('daily_reports')::text as t`;
  if (!reg[0]?.t) return;
  const base = new Date();
  base.setHours(12, 0, 0, 0);
  for (const [ago, who, job, narrative, photos, lunch] of WEEK) {
    const day = new Date(base.getTime() - ago * 86_400_000);
    const dayStr = day.toISOString().slice(0, 10);
    const at = (h: number, m: number) => {
      const d = new Date(`${dayStr}T00:00:00`);
      d.setHours(h, m, 0, 0);
      return d.toISOString();
    };
    const id = randomUUID();
    const first = at(7, 5 + ((ago * 7) % 25));
    const last = at(15, 20 + ((ago * 11) % 35));
    await sql`
      insert into daily_reports (id, company_id, user_id, day, project_id, narrative, lunch_minutes, first_edit_at, last_edit_at, submitted_at)
      values (${id}, ${DEMO_COMPANY_ID}, ${ids[who]}, ${dayStr}, ${job >= 0 ? jobIds[job] : null}, ${narrative},
              ${lunch}, ${first}, ${last}, ${last})
    `;
    for (const [n, idx] of photos.entries()) {
      const photo = DEMO_PHOTOS[idx];
      if (!photo) continue;
      const full = Buffer.from(photo.full, "base64");
      await sql`
        insert into daily_report_photos (id, report_id, company_id, user_id, mime, bytes, thumb, size_bytes, width, height, taken_at, created_at)
        values (${randomUUID()}, ${id}, ${DEMO_COMPANY_ID}, ${ids[who]}, ${"image/jpeg"}, ${full},
                ${Buffer.from(photo.thumb, "base64")}, ${full.length}, ${480}, ${360}, ${at(7, 2 + n)}, ${at(7, 3 + n)})
      `;
    }
  }
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
