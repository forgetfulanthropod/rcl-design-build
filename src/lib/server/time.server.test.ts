import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import type { Sql } from "../db.ts";
import { freshDb } from "./pglite-test-db.ts";
import * as time from "./time.server.ts";
import { ensureTradeAndCertCatalog } from "./crew.server.ts";
import { insertProject } from "./sharing.server.ts";
import { PAYROLL_HEADER } from "../time.ts";

let pg: PGlite;
let sql: Sql;

before(async () => {
  ({ pg, sql } = await freshDb());
});
after(async () => {
  await pg.close();
});

const ROLES = ["owner", "admin", "superadmin", "lead", "labor", "sub"] as const;
type Role = (typeof ROLES)[number];
type Co = { companyId: string; u: Record<Role, string>; whitaker: string; oak: string; other: string; codes: Record<string, string> };

/** A company: Lena (lead) leads Whitaker and Oak Street, not "Other"; Luis (labor) is Drywall. */
async function company(): Promise<Co> {
  const companyId = randomUUID();
  await sql`insert into companies (id, name) values (${companyId}, ${"Co " + companyId.slice(0, 4)})`;
  const u = {} as Record<Role, string>;
  const names: Record<Role, string> = {
    owner: "Olivia Grant",
    admin: "Adam Price",
    superadmin: "Elvira",
    lead: "Lena Ortiz",
    labor: "Luis Moreno",
    sub: "Sam Whitfield",
  };
  for (const role of ROLES) {
    u[role] = randomUUID();
    await sql`
      insert into profiles (user_id, company_id, name, role, email, phone, sub_company, employee_number)
      values (${u[role]}, ${companyId}, ${names[role]}, ${role}, ${role + "@t.test"}, ${role === "labor" ? "+15555550100" : null},
              ${role === "sub" ? "Bluegrass Electric" : null}, ${role === "labor" ? "E-1042" : null})
    `;
  }
  const job = (name: string) =>
    insertProject(sql, { companyId, name, clientName: "C", address: "1 Main", phase: "Build", contractValue: 1000, summary: "" }, u.owner);
  const whitaker = await job("Whitaker kitchen remodel");
  const oak = await job("Oak Street duplex addition");
  const other = await job("Chevy Chase dental fit-up");
  await sql`insert into job_leads (project_id, user_id) values (${whitaker}, ${u.lead}), (${oak}, ${u.lead})`;
  await ensureTradeAndCertCatalog(sql, companyId);
  await time.ensureCostCodes(sql, companyId);
  const drywall = await sql<{ id: string }>`select id from trades where company_id = ${companyId} and name = ${"Drywall"}`;
  await sql`insert into person_trades (company_id, user_id, trade_id) values (${companyId}, ${u.labor}, ${drywall[0].id})`;
  const codes = Object.fromEntries(
    (await sql<{ id: string; code: string }>`select id, code from cost_codes where company_id = ${companyId}`).map((c) => [c.code, c.id]),
  );
  return { companyId, u, whitaker, oak, other, codes };
}

/** A written (not yet submitted) report, first edit at `firstEdit` (ISO). */
async function report(co: Co, user: string, day: string, projectId: string | null, firstEdit: string): Promise<string> {
  const id = randomUUID();
  await sql`
    insert into daily_reports (id, company_id, user_id, day, project_id, narrative, first_edit_at, last_edit_at)
    values (${id}, ${co.companyId}, ${user}, ${day}, ${projectId}, ${"Hung drywall in the hallway."}, ${firstEdit}, ${firstEdit})
  `;
  return id;
}

/** Writes and submits a day: start/end are New York wall clock. */
async function submitDay(co: Co, user: string, day: string, projectId: string | null, hours: { start: string; end: string; lunch?: number; lines?: { projectId: string | null; costCodeId: string | null; minutes: number }[] }) {
  await report(co, user, day, projectId, `${day}T11:00:00.000Z`);
  return time.submitDayTime(user, { day, lunchMinutes: hours.lunch ?? 0, start: hours.start, end: hours.end, lines: hours.lines }, sql);
}

async function dayEntries(co: Co, user: string, day: string) {
  return sql<{ id: string; minutes: number; status: string; source: string; project_id: string | null; cost_code_id: string | null; edited_by: string | null }>`
    select id, minutes, status, source, project_id, cost_code_id, edited_by from time_entries
    where company_id = ${co.companyId} and user_id = ${user} and day = ${day} order by minutes desc
  `;
}

test("migration 0016 applied: time tables, company time zone and Monday weeks, trade → cost code defaults", async () => {
  const co = await company();
  for (const t of ["cost_codes", "time_entries", "pay_rates", "payroll_exports"]) {
    const r = await sql<{ t: string }>`select to_regclass(${t})::text as t`;
    assert.equal(r[0].t, t);
  }
  const c = await sql<{ timezone: string; week_starts: number }>`select timezone, week_starts from companies where id = ${co.companyId}`;
  assert.deepEqual({ ...c[0] }, { timezone: "America/New_York", week_starts: 1 });
  assert.equal(Object.keys(co.codes).length, 12);
  const t = await sql<{ code: string }>`select cc.code from trades t join cost_codes cc on cc.id = t.default_cost_code_id where t.company_id = ${co.companyId} and t.name = ${"Drywall"}`;
  assert.equal(t[0].code, "09-200");
  await time.ensureCostCodes(sql, co.companyId); // idempotent
  assert.equal((await sql`select id from cost_codes where company_id = ${co.companyId}`).length, 12);
});

test("acceptance 1: Luis 07:02 → 15:41, lunch 30 → 8h 15m; derived when untouched, edited when start moves to 06:45 (8h 30m)", async () => {
  const co = await company();
  // 07:02 EDT = 11:02Z; "now" at submit is 15:41 EDT.
  await report(co, co.u.labor, "2026-10-19", co.whitaker, "2026-10-19T11:02:00.000Z");
  const defaults = await time.getSubmitDefaults(co.u.labor, { day: "2026-10-19" }, sql);
  assert.equal(defaults.start, "07:02");
  assert.equal(defaults.startHint, "first-edit");
  assert.equal(defaults.lines[0].projectId, co.whitaker);
  assert.equal(defaults.lines[0].costCodeId, co.codes["09-200"]); // Drywall → 09-200
  const derived = await time.submitDayTime(co.u.labor, { day: "2026-10-19", lunchMinutes: 30, start: "07:02", end: "15:41" }, sql, new Date("2026-10-19T19:41:00.000Z"));
  assert.deepEqual(derived, { minutes: 495, source: "derived" });
  const [row] = await dayEntries(co, co.u.labor, "2026-10-19");
  assert.equal(row.minutes, 495);
  assert.equal(row.cost_code_id, co.codes["09-200"]);
  const r = await sql<{ start_at: Date; submitted_at: Date | null; lunch_minutes: number }>`select start_at, submitted_at, lunch_minutes from daily_reports where user_id = ${co.u.labor}`;
  assert.equal(new Date(r[0].start_at).toISOString(), "2026-10-19T11:02:00.000Z");
  assert.ok(r[0].submitted_at);
  assert.equal(r[0].lunch_minutes, 30);

  await report(co, co.u.labor, "2026-10-20", co.whitaker, "2026-10-20T11:02:00.000Z");
  const edited = await time.submitDayTime(co.u.labor, { day: "2026-10-20", lunchMinutes: 30, start: "06:45", end: "15:41" }, sql, new Date("2026-10-20T19:41:00.000Z"));
  assert.deepEqual(edited, { minutes: 510, source: "edited" });
});

test("acceptance 2: split 5h Whitaker / 3h15 Oak Street → two rows; lines that don't add up are refused", async () => {
  const co = await company();
  await report(co, co.u.labor, "2026-10-19", co.whitaker, "2026-10-19T11:02:00.000Z");
  const bad = { day: "2026-10-19", lunchMinutes: 30, start: "07:02", end: "15:41" };
  await assert.rejects(
    time.submitDayTime(co.u.labor, { ...bad, lines: [{ projectId: co.whitaker, costCodeId: null, minutes: 300 }, { projectId: co.oak, costCodeId: null, minutes: 180 }] }, sql),
    /0h 15m still to assign/,
  );
  assert.equal((await dayEntries(co, co.u.labor, "2026-10-19")).length, 0); // nothing written
  await time.submitDayTime(co.u.labor, { ...bad, lines: [{ projectId: co.whitaker, costCodeId: co.codes["09-200"], minutes: 300 }, { projectId: co.oak, costCodeId: co.codes["06-100"], minutes: 195 }] }, sql);
  const rows = await dayEntries(co, co.u.labor, "2026-10-19");
  assert.deepEqual(rows.map((r) => [r.project_id, r.minutes]), [[co.whitaker, 300], [co.oak, 195]]);
});

test("submit validation on the server: start required, end after start, ≤ 14 h, company jobs and codes only, needs a narrative, once only", async () => {
  const co = await company();
  const day = { day: "2026-10-19", lunchMinutes: 0 };
  await assert.rejects(time.submitDayTime(co.u.labor, { ...day, start: "", end: "15:00" }, sql), /Write a few words/);
  await report(co, co.u.labor, "2026-10-19", null, "2026-10-19T11:02:00.000Z");
  await assert.rejects(time.submitDayTime(co.u.labor, { ...day, start: "", end: "15:00" }, sql), /Enter your start time/);
  await assert.rejects(time.submitDayTime(co.u.labor, { ...day, start: "15:00", end: "07:00" }, sql), /End must be after start/);
  await assert.rejects(time.submitDayTime(co.u.labor, { ...day, start: "04:00", end: "19:00" }, sql), /over 14 hours/);
  await assert.rejects(time.submitDayTime(co.u.labor, { ...day, lunchMinutes: 61, start: "07:00", end: "15:00" }, sql), /Lunch must be 0 to 60/);
  const other = await company();
  await assert.rejects(
    time.submitDayTime(co.u.labor, { ...day, start: "07:00", end: "15:00", lines: [{ projectId: other.whitaker, costCodeId: null, minutes: 480 }] }, sql),
    /Pick one of your company's jobs/,
  );
  await assert.rejects(
    time.submitDayTime(co.u.labor, { ...day, start: "07:00", end: "15:00", lines: [{ projectId: null, costCodeId: other.codes["09-200"], minutes: 480 }] }, sql),
    /Pick a cost code/,
  );
  await time.submitDayTime(co.u.labor, { ...day, start: "07:00", end: "15:00" }, sql);
  await assert.rejects(time.submitDayTime(co.u.labor, { ...day, start: "07:00", end: "15:00" }, sql), /already submitted/);
});

test("acceptance 3: Lena sees only her jobs, approves Luis, can't approve her own hours, and never sees rates", async () => {
  const co = await company();
  await time.setPayRate(co.u.admin, { userId: co.u.labor, effectiveOn: "2026-01-01", rateCents: 2800, burdenPct: 18 }, sql);
  await time.setPayRate(co.u.admin, { userId: co.u.lead, effectiveOn: "2026-01-01", rateCents: 3600, burdenPct: 18 }, sql);
  await submitDay(co, co.u.labor, "2026-10-19", co.whitaker, { start: "07:00", end: "15:00" });
  await submitDay(co, co.u.lead, "2026-10-19", co.whitaker, { start: "07:00", end: "15:00" });
  await submitDay(co, co.u.labor, "2026-10-20", co.other, { start: "07:00", end: "15:00" }); // not Lena's job

  const week = await time.getTimeWeek(co.u.lead, { week: "2026-10-19" }, sql);
  assert.equal(week.scope, "lead");
  assert.deepEqual(new Set(week.entries.map((e) => e.projectId)), new Set([co.whitaker]));
  assert.deepEqual(week.jobs.map((j) => j.id).sort(), [co.whitaker, co.oak].sort());
  // No rate or labor-$ keys anywhere in a Lead's payload.
  const json = JSON.stringify(week);
  for (const key of ["rate_cents", "rateCents", "laborCents", "burden"]) assert.ok(!json.includes(key), key);
  assert.equal("laborCents" in week, false);
  assert.equal(week.can.rates, false);

  const luis = week.entries.find((e) => e.userId === co.u.labor)!;
  const lena = week.entries.find((e) => e.userId === co.u.lead)!;
  assert.deepEqual(await time.approveEntries(co.u.lead, { ids: [luis.id] }, sql), { approved: 1 });
  await assert.rejects(time.approveEntries(co.u.lead, { ids: [lena.id] }, sql), /Your own hours go to an admin or owner/);
  const otherJob = (await dayEntries(co, co.u.labor, "2026-10-20"))[0];
  await assert.rejects(time.approveEntries(co.u.lead, { ids: [otherJob.id] }, sql), { name: "ForbiddenError" });
  await assert.rejects(time.rejectEntries(co.u.lead, { ids: [otherJob.id], reason: "no" }, sql), { name: "ForbiddenError" });
  await assert.rejects(time.listPayRates(co.u.lead, sql), { name: "ForbiddenError" });
  await assert.rejects(time.setPayRate(co.u.lead, { userId: co.u.labor, effectiveOn: "2026-01-01", rateCents: 1, burdenPct: 0 }, sql), { name: "ForbiddenError" });

  // Admin sees every job and labor $ (approved hours × rate × (1 + burden)), and approves Lena.
  const admin = await time.getTimeWeek(co.u.admin, { week: "2026-10-19" }, sql);
  assert.equal(admin.scope, "all");
  assert.equal(admin.entries.length, 3);
  assert.equal(admin.laborCents?.[co.u.labor], 26432); // 8 h × $28 × 1.18, only the approved day
  await time.approveEntries(co.u.admin, { ids: [lena.id] }, sql);
  // An admin's own hours also go to someone else ([DECIDE] SELF_APPROVE_ROLES); an owner may approve their own.
  await submitDay(co, co.u.admin, "2026-10-19", co.whitaker, { start: "07:00", end: "15:00" });
  const mine = (await dayEntries(co, co.u.admin, "2026-10-19"))[0];
  await assert.rejects(time.approveEntries(co.u.admin, { ids: [mine.id] }, sql), /Your own hours/);
  await submitDay(co, co.u.owner, "2026-10-19", co.whitaker, { start: "07:00", end: "15:00" });
  const ownerOwn = (await dayEntries(co, co.u.owner, "2026-10-19"))[0];
  assert.deepEqual(await time.approveEntries(co.u.owner, { ids: [ownerOwn.id] }, sql), { approved: 1 });
});

for (const role of ["labor", "sub"] as const) {
  test(`${role}: no review, approval, unlock, export, void or rates — every call is ForbiddenError`, async () => {
    const co = await company();
    await submitDay(co, co.u.labor, "2026-10-19", co.whitaker, { start: "07:00", end: "15:00" });
    const [e] = await dayEntries(co, co.u.labor, "2026-10-19");
    const me = co.u[role];
    const forbidden = { name: "ForbiddenError" };
    await assert.rejects(time.getTimeWeek(me, {}, sql), forbidden);
    await assert.rejects(time.approveEntries(me, { ids: [e.id] }, sql), forbidden);
    await assert.rejects(time.rejectEntries(me, { ids: [e.id], reason: "x" }, sql), forbidden);
    await assert.rejects(time.editEntry(me, { id: e.id, projectId: null, costCodeId: null, minutes: 60 }, sql), forbidden);
    await assert.rejects(time.unlockEntries(me, { ids: [e.id] }, sql), forbidden);
    await assert.rejects(time.nudgeMissing(me, { userId: co.u.labor, day: "2026-10-19" }, sql), forbidden);
    await assert.rejects(time.previewPayrollExport(me, {}, sql), forbidden);
    await assert.rejects(time.runPayrollExport(me, { start: "2026-10-19", end: "2026-10-25" }, sql), forbidden);
    await assert.rejects(time.listPayrollExports(me, sql), forbidden);
    await assert.rejects(time.voidPayrollExport(me, { id: "x" }, sql), forbidden);
    await assert.rejects(time.listPayRates(me, sql), forbidden);
    await assert.rejects(time.setPayRate(me, { userId: me, effectiveOn: "2026-01-01", rateCents: 9999, burdenPct: 0 }, sql), forbidden);
    // Their own hours are theirs.
    const mine = await time.getMyHours(co.u.labor, { week: "2026-10-19" }, sql);
    assert.equal(mine.totalMinutes, 480);
    assert.equal(mine.days[0].status, "submitted");
  });
}

test("Lead can't unlock, export or void; Admin can't void (owner only)", async () => {
  const co = await company();
  await submitDay(co, co.u.labor, "2026-10-12", co.whitaker, { start: "07:00", end: "15:00" });
  const [e] = await dayEntries(co, co.u.labor, "2026-10-12");
  await time.approveEntries(co.u.lead, { ids: [e.id] }, sql);
  await assert.rejects(time.unlockEntries(co.u.lead, { ids: [e.id] }, sql), { name: "ForbiddenError" });
  await assert.rejects(time.previewPayrollExport(co.u.lead, {}, sql), { name: "ForbiddenError" });
  const x = await time.runPayrollExport(co.u.admin, { start: "2026-10-12", end: "2026-10-18" }, sql);
  await assert.rejects(time.voidPayrollExport(co.u.lead, { id: x.id }, sql), { name: "ForbiddenError" });
  await assert.rejects(time.voidPayrollExport(co.u.admin, { id: x.id }, sql), { name: "ForbiddenError" });
  assert.deepEqual(await time.voidPayrollExport(co.u.owner, { id: x.id }, sql), { restored: 1 });
});

test("reject needs a reason, reopens the report, and the worker re-sends; approved or exported days can't be re-sent", async () => {
  const co = await company();
  await submitDay(co, co.u.labor, "2026-10-14", co.whitaker, { start: "07:00", end: "15:00" });
  const [e] = await dayEntries(co, co.u.labor, "2026-10-14");
  await assert.rejects(time.rejectEntries(co.u.lead, { ids: [e.id], reason: "  " }, sql), /Say why/);
  await time.rejectEntries(co.u.lead, { ids: [e.id], reason: "You left at 2, not 3." }, sql);
  assert.equal(await time.isReopenedDay(co.u.labor, "2026-10-14", sql), true);
  const hours = await time.getMyHours(co.u.labor, { week: "2026-10-14" }, sql);
  const day = hours.days.find((d) => d.day === "2026-10-14")!;
  assert.equal(day.status, "rejected");
  assert.equal(day.rejectReason, "You left at 2, not 3.");
  const defaults = await time.getSubmitDefaults(co.u.labor, { day: "2026-10-14" }, sql);
  assert.equal(defaults.rejectReason, "You left at 2, not 3.");
  assert.equal(defaults.start, "07:00");
  assert.equal(defaults.end, "15:00");
  // Rejected hours can't be approved until re-sent.
  await assert.rejects(time.approveEntries(co.u.lead, { ids: [e.id] }, sql), /Only submitted hours/);
  await time.submitDayTime(co.u.labor, { day: "2026-10-14", lunchMinutes: 0, start: "07:00", end: "14:00" }, sql);
  const again = await dayEntries(co, co.u.labor, "2026-10-14");
  assert.deepEqual(again.map((r) => [r.minutes, r.status]), [[420, "submitted"]]);
  assert.equal(await time.isReopenedDay(co.u.labor, "2026-10-14", sql), false);

  await time.approveEntries(co.u.lead, { ids: [again[0].id] }, sql);
  // Simulate an edit to the report after approval: the server refuses with who approved it.
  await sql`update daily_reports set submitted_at = null where user_id = ${co.u.labor} and day = ${"2026-10-14"}`;
  await assert.rejects(
    time.submitDayTime(co.u.labor, { day: "2026-10-14", lunchMinutes: 0, start: "07:00", end: "15:00" }, sql),
    /Approved by Lena Ortiz\. Ask Lena to reopen it\./,
  );
  assert.equal((await time.getSubmitDefaults(co.u.labor, { day: "2026-10-14" }, sql)).locked, "Approved by Lena Ortiz. Ask Lena to reopen it.");
});

test("reject is refused while another line of the same day is approved (the worker could never re-send it)", async () => {
  const co = await company();
  await report(co, co.u.labor, "2026-10-16", co.whitaker, "2026-10-16T11:00:00.000Z");
  await time.submitDayTime(co.u.labor, {
    day: "2026-10-16", lunchMinutes: 0, start: "07:00", end: "15:00",
    lines: [{ projectId: co.whitaker, costCodeId: null, minutes: 300 }, { projectId: co.other, costCodeId: null, minutes: 180 }],
  }, sql);
  const [whitaker, other] = await dayEntries(co, co.u.labor, "2026-10-16");
  await time.approveEntries(co.u.admin, { ids: [other.id] }, sql);
  await assert.rejects(time.rejectEntries(co.u.lead, { ids: [whitaker.id], reason: "Check it" }, sql), /Part of this day is already approved/);
  await time.unlockEntries(co.u.admin, { ids: [other.id] }, sql);
  assert.deepEqual(await time.rejectEntries(co.u.lead, { ids: [whitaker.id], reason: "Check it" }, sql), { rejected: 1 });
});

test("inline edit records edited_by and source = edited; approved hours need unlocking first (Owner/Admin)", async () => {
  const co = await company();
  await submitDay(co, co.u.labor, "2026-10-15", co.whitaker, { start: "07:00", end: "15:00" });
  const [e] = await dayEntries(co, co.u.labor, "2026-10-15");
  await time.editEntry(co.u.lead, { id: e.id, projectId: co.whitaker, costCodeId: co.codes["06-200"], minutes: 465 }, sql);
  const [edited] = await dayEntries(co, co.u.labor, "2026-10-15");
  assert.deepEqual([edited.source, edited.edited_by, edited.cost_code_id, edited.minutes, edited.status], ["edited", co.u.lead, co.codes["06-200"], 465, "submitted"]);
  // Moving it to a job Lena doesn't lead is refused.
  await assert.rejects(time.editEntry(co.u.lead, { id: e.id, projectId: co.other, costCodeId: null, minutes: 465 }, sql), { name: "ForbiddenError" });
  await assert.rejects(time.editEntry(co.u.lead, { id: e.id, projectId: co.whitaker, costCodeId: null, minutes: 900 }, sql), /Hours must be 0 to 14/);
  await time.approveEntries(co.u.lead, { ids: [e.id] }, sql);
  await assert.rejects(time.editEntry(co.u.lead, { id: e.id, projectId: co.whitaker, costCodeId: null, minutes: 60 }, sql), /reopen approved hours first/);
  assert.deepEqual(await time.unlockEntries(co.u.admin, { ids: [e.id] }, sql), { unlocked: 1 });
  assert.equal((await dayEntries(co, co.u.labor, "2026-10-15"))[0].status, "submitted");
});

test("acceptance 4–6: export blocked while hours aren't approved; success marks exported and locks; subs never in payroll; 42 h → 40 + 2 OT", async () => {
  const co = await company();
  const week = ["2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16"];
  for (const d of week) await submitDay(co, co.u.labor, d, co.whitaker, { start: "07:00", end: "15:00" });
  await submitDay(co, co.u.labor, "2026-10-17", co.oak, { start: "07:00", end: "09:00" }); // Saturday: 42 h
  await submitDay(co, co.u.sub, "2026-10-13", co.oak, { start: "08:00", end: "12:00" });
  const period = { start: "2026-10-12", end: "2026-10-18" };

  const before = await time.previewPayrollExport(co.u.admin, period, sql);
  assert.equal(before.notApproved.length, 6);
  assert.equal(before.subExcluded, 1);
  await assert.rejects(time.runPayrollExport(co.u.admin, period, sql), /6 entries aren't approved yet/);

  const ids = (await sql<{ id: string }>`select id from time_entries where company_id = ${co.companyId} and user_id = ${co.u.labor}`).map((r) => r.id);
  await time.approveEntries(co.u.lead, { ids }, sql);
  const ready = await time.previewPayrollExport(co.u.admin, period, sql);
  assert.equal(ready.notApproved.length, 0);
  assert.equal(ready.rowCount, 6);
  assert.equal(ready.preview.length, 5);

  const x = await time.runPayrollExport(co.u.admin, period, sql);
  assert.equal(x.filename, "rcl-payroll-2026-10-12_2026-10-18.csv");
  const lines = x.csv.replace(/^\uFEFF/, "").trim().split("\r\n");
  assert.equal(lines[0], PAYROLL_HEADER.join(","));
  assert.equal(lines.length, 7); // header + 6 person × day × job rows
  assert.ok(!x.csv.includes("Sam Whitfield"), "subs never in payroll");
  const regular = lines.slice(1).reduce((n, l) => n + Number(l.split(",")[10]), 0);
  const overtime = lines.slice(1).reduce((n, l) => n + Number(l.split(",")[11]), 0);
  assert.deepEqual([regular, overtime], [40, 2]);
  assert.ok(lines[6].includes(",2026-10-17,Oak Street duplex addition,") && lines[6].endsWith(",0.00,2.00,Lena Ortiz," + lines[6].split(",")[13] + ","), lines[6]);
  assert.ok(lines[1].startsWith("E-1042,Luis Moreno,labor@t.test,2026-10-12,2026-10-18,2026-10-12,Whitaker kitchen remodel,"));

  const exported = await sql<{ status: string; export_id: string }>`select status, export_id from time_entries where user_id = ${co.u.labor}`;
  assert.ok(exported.every((r) => r.status === "exported" && r.export_id === x.id));
  // Locked: nobody edits, reopens or re-approves exported hours.
  await assert.rejects(time.editEntry(co.u.owner, { id: ids[0], projectId: co.whitaker, costCodeId: null, minutes: 60 }, sql), /payroll export/);
  await assert.rejects(time.unlockEntries(co.u.owner, { ids: [ids[0]] }, sql), /payroll export/);
  await assert.rejects(time.approveEntries(co.u.owner, { ids: [ids[0]] }, sql), /payroll export/);
  await assert.rejects(time.runPayrollExport(co.u.admin, period, sql), /No approved hours/);

  // History, re-download, the sub-hours CSV, and void.
  const history = await time.listPayrollExports(co.u.admin, sql);
  assert.deepEqual(history.map((h) => [h.kind, h.rowCount, h.createdByName]), [["payroll", 6, "Adam Price"]]);
  assert.equal((await time.getPayrollExportCsv(co.u.admin, { id: x.id }, sql)).csv, x.csv);
  await assert.rejects(time.runPayrollExport(co.u.admin, { ...period, kind: "sub_hours" }, sql), /1 entry isn't approved yet/);
  const subIds = (await sql<{ id: string }>`select id from time_entries where user_id = ${co.u.sub}`).map((r) => r.id);
  await time.approveEntries(co.u.lead, { ids: subIds }, sql);
  const subCsv = await time.runPayrollExport(co.u.admin, { ...period, kind: "sub_hours" }, sql);
  assert.equal(subCsv.filename, "rcl-sub-hours-2026-10-12_2026-10-18.csv");
  assert.ok(subCsv.csv.includes(",sub_company\r\n") && subCsv.csv.includes("Sam Whitfield") && subCsv.csv.includes(",Bluegrass Electric\r\n"));
  assert.ok(!subCsv.csv.includes("Luis"));
  assert.deepEqual(await time.voidPayrollExport(co.u.owner, { id: x.id }, sql), { restored: 6 });
  await assert.rejects(time.voidPayrollExport(co.u.owner, { id: x.id }, sql), /already void/);
  const restored = await sql<{ status: string }>`select distinct status from time_entries where user_id = ${co.u.labor}`;
  assert.deepEqual(restored.map((r) => r.status), ["approved"]);
  assert.ok((await time.listPayrollExports(co.u.owner, sql)).find((h) => h.id === x.id)?.voidedAt);
  await assert.rejects(time.previewPayrollExport(co.u.admin, { start: "2026-01-01", end: "2026-03-01" }, sql), /up to 31 days/);
  await assert.rejects(time.previewPayrollExport(co.u.admin, { start: "2026-10-18", end: "2026-10-12" }, sql), /ends before it starts/);
});

test("missing reports: on the crew board with no report → No report; Nudge sends one text, confirm happens in the UI", async () => {
  const co = await company();
  const today = time.companyToday("America/New_York");
  for (const [user, job] of [[co.u.labor, co.whitaker], [co.u.sub, co.other]] as const) {
    await sql`
      insert into crew_assignments (id, company_id, user_id, project_id, day, part, status, assigned_by)
      values (${randomUUID()}, ${co.companyId}, ${user}, ${job}, ${today}, ${"full"}, ${"published"}, ${co.u.lead})
    `;
  }
  const lead = await time.getTimeWeek(co.u.lead, { week: today }, sql);
  assert.deepEqual(lead.missing.map((m) => [m.userId, m.day, m.nudged]), [[co.u.labor, today, false]]); // Sam is on a job Lena doesn't lead
  const admin = await time.getTimeWeek(co.u.admin, { week: today }, sql);
  assert.equal(admin.missing.length, 2);
  await assert.rejects(time.nudgeMissing(co.u.lead, { userId: co.u.sub, day: today }, sql), { name: "ForbiddenError" });
  assert.deepEqual(await time.nudgeMissing(co.u.lead, { userId: co.u.labor, day: today }, sql), { channel: "sms", to: "+15555550100" });
  const sent = await sql<{ kind: string; channel: string; status: string; body: string }>`select kind, channel, status, body from outbound_messages where recipient_user_id = ${co.u.labor}`;
  assert.equal(sent.length, 1);
  assert.equal(sent[0].kind, "time_nudge");
  assert.match(sent[0].body, /^Luis, your daily report for .* isn't in yet/);
  await assert.rejects(time.nudgeMissing(co.u.lead, { userId: co.u.labor, day: today }, sql), /Already nudged/);
  assert.equal((await time.getTimeWeek(co.u.lead, { week: today }, sql)).missing[0].nudged, true);
  // Once the report is in, the row is gone and nudging is refused.
  await submitDay(co, co.u.labor, today, co.whitaker, { start: "07:00", end: "15:00" });
  assert.equal((await time.getTimeWeek(co.u.lead, { week: today }, sql)).missing.length, 0);
});

test("pay rates: effective dating, validation, other companies stay out", async () => {
  const co = await company();
  await time.setPayRate(co.u.owner, { userId: co.u.labor, effectiveOn: "2026-01-01", rateCents: 2600, burdenPct: 18 }, sql);
  await time.setPayRate(co.u.owner, { userId: co.u.labor, effectiveOn: "2026-06-01", rateCents: 2800, burdenPct: 18 }, sql);
  const list = await time.listPayRates(co.u.admin, sql);
  const luis = list.find((p) => p.userId === co.u.labor)!;
  assert.equal(luis.history.length, 2);
  assert.equal(time.rateOn(luis.history, "2026-03-01")?.rateCents, 2600);
  assert.equal(time.rateOn(luis.history, "2026-07-01")?.rateCents, 2800);
  assert.equal(time.rateOn(luis.history, "2025-12-31"), null);
  assert.ok(!list.some((p) => p.role === "sub"), "subs have no pay rate");
  await assert.rejects(time.setPayRate(co.u.owner, { userId: co.u.labor, effectiveOn: "2026-01-01", rateCents: -1, burdenPct: 0 }, sql), /hourly rate/);
  const other = await company();
  await assert.rejects(time.setPayRate(co.u.owner, { userId: other.u.labor, effectiveOn: "2026-01-01", rateCents: 100, burdenPct: 0 }, sql), /Not found/);
  // Another company's entry ids are invisible.
  await submitDay(other, other.u.labor, "2026-10-19", other.whitaker, { start: "07:00", end: "15:00" });
  const [theirs] = await dayEntries(other, other.u.labor, "2026-10-19");
  await assert.rejects(time.approveEntries(co.u.owner, { ids: [theirs.id] }, sql), /Not found/);
});

test("demo seed: hours from the seeded week, older days approved, rates for Luis and Lena", async () => {
  const co = await company();
  const day = (ago: number) => new Date(Date.now() - ago * 86_400_000).toISOString().slice(0, 10);
  for (const ago of [6, 1]) {
    await sql`
      insert into daily_reports (id, company_id, user_id, day, project_id, narrative, lunch_minutes, first_edit_at, last_edit_at, submitted_at)
      values (${randomUUID()}, ${co.companyId}, ${co.u.labor}, ${day(ago)}, ${co.whitaker}, ${"x"}, ${30},
              ${day(ago) + "T07:05:00Z"}, ${day(ago) + "T15:20:00Z"}, ${day(ago) + "T15:20:00Z"})
    `;
  }
  await time.seedDemoTime(sql, co.companyId, { owner: co.u.owner, lead: co.u.lead, labor: co.u.labor, subcontractor: co.u.sub });
  const rows = await sql<{ day: string; minutes: number; status: string }>`select day::text as day, minutes, status from time_entries where user_id = ${co.u.labor} order by day`;
  assert.deepEqual(rows.map((r) => [r.minutes, r.status]), [[465, "approved"], [465, "submitted"]]); // 8h15 − 30 → 7h45
  const rates = await sql<{ rate_cents: number }>`select rate_cents from pay_rates where company_id = ${co.companyId} order by rate_cents`;
  assert.deepEqual(rates.map((r) => r.rate_cents), [2800, 3600]);
});
