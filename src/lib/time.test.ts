import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DAILY_OT_MINUTES,
  PAYROLL_CSV_INCLUDE_RATES,
  PAYROLL_HEADER,
  ROUND_MINUTES,
  ROUND_MODE,
  START_MY_DAY_ENABLED,
  WEEKLY_OT_MINUTES,
  allocateOvertime,
  clock12,
  computeHours,
  csvCell,
  dayFlags,
  decimalHours,
  formatMinutes,
  laborCents,
  lastFullWeek,
  lineErrors,
  payWeekStart,
  payrollCsv,
  payrollFilename,
  roundMinutes,
  zonedClock,
  zonedToIso,
  type PayrollRow,
} from "./time.ts";
import { parseHoursInput } from "./time-input.ts";
import { dayStatusOf, flagsOf, shortHours, weekdayLabel } from "./time-cells.ts";

test("[DECIDE] defaults are the spec's: 15-min nearest rounding, weekly OT over 40 h, no daily OT, no Start my day, generic CSV", () => {
  assert.equal(ROUND_MINUTES, 15);
  assert.equal(ROUND_MODE, "nearest");
  assert.equal(WEEKLY_OT_MINUTES, 2400);
  assert.equal(DAILY_OT_MINUTES, null);
  assert.equal(START_MY_DAY_ENABLED, false);
  assert.equal(PAYROLL_CSV_INCLUDE_RATES, false);
});

test("acceptance 1: first edit 07:02, submit 15:41, lunch 30 → 8h 09m, rounds to 8h 15m; start 06:45 → 8h 30m", () => {
  const a = computeHours({ start: "07:02", end: "15:41", lunch: 30 });
  assert.deepEqual(a, { rawMinutes: 489, minutes: 495, errors: [] });
  assert.equal(formatMinutes(a.rawMinutes), "8h 09m");
  assert.equal(formatMinutes(a.minutes), "8h 15m");
  assert.equal(formatMinutes(computeHours({ start: "06:45", end: "15:41", lunch: 30 }).minutes), "8h 30m");
});

test("rounding modes", () => {
  assert.equal(roundMinutes(487), 480); // 8h07 → 8h00 (nearest)
  assert.equal(roundMinutes(488), 495); // 8h08 → 8h15
  assert.equal(roundMinutes(481, 15, "up"), 495);
  assert.equal(roundMinutes(494, 15, "down"), 480);
  assert.equal(roundMinutes(Number.NaN), 0);
});

test("hours validation: start required, end after start, lunch not longer than the day, ≤ 14 h", () => {
  assert.deepEqual(computeHours({ start: "", end: "15:00", lunch: 0 }).errors, ["Enter your start time."]);
  assert.deepEqual(computeHours({ start: "09:00", end: "09:00", lunch: 0 }).errors, ["End must be after start."]);
  assert.deepEqual(computeHours({ start: "09:00", end: "09:20", lunch: 30 }).errors, ["Lunch is longer than the day."]);
  assert.match(computeHours({ start: "04:00", end: "19:00", lunch: 0 }).errors[0], /over 14 hours/);
  assert.deepEqual(computeHours({ start: "05:00", end: "19:00", lunch: 0 }).errors, []); // exactly 14 h is fine
  assert.deepEqual(computeHours({ start: "7:00", end: "15:00", lunch: 0 }).errors, ["Enter your start time."]); // HH:MM only
});

test("acceptance 2: split lines must add up to the total", () => {
  const total = 495;
  assert.deepEqual(lineErrors(total, [
    { projectId: "w", costCodeId: null, minutes: 300 },
    { projectId: "o", costCodeId: null, minutes: 195 },
  ]), []);
  assert.deepEqual(lineErrors(total, [
    { projectId: "w", costCodeId: null, minutes: 300 },
    { projectId: "o", costCodeId: null, minutes: 180 },
  ]), ["0h 15m still to assign."]);
  assert.deepEqual(lineErrors(total, [{ projectId: "w", costCodeId: null, minutes: 510 }]), ["Lines are 0h 15m over the total."]);
  assert.deepEqual(lineErrors(total, []), ["Add a line."]);
  assert.equal(lineErrors(60, [{ projectId: null, costCodeId: null, minutes: -1 }, { projectId: null, costCodeId: null, minutes: 61 }])[0], "Each line needs hours.");
});

test("check flags: under 1 h, over 14 h, no start", () => {
  assert.deepEqual(dayFlags(45), ["under"]);
  assert.deepEqual(dayFlags(900), ["over"]);
  assert.deepEqual(dayFlags(480, false), ["noStart"]);
  assert.deepEqual(dayFlags(480), []);
  assert.deepEqual(flagsOf([{ minutes: 30, start: "07:00" }, { minutes: 30, start: "07:00" }]), []);
  assert.deepEqual(flagsOf([]), []);
});

test("time zones: America/New_York wall clock ↔ instants, both sides of DST", () => {
  const tz = "America/New_York";
  assert.equal(zonedToIso("2026-10-19", "07:02", tz), "2026-10-19T11:02:00.000Z"); // EDT −4
  assert.equal(zonedToIso("2026-12-01", "07:02", tz), "2026-12-01T12:02:00.000Z"); // EST −5
  assert.deepEqual(zonedClock("2026-10-19T19:41:00.000Z", tz), { day: "2026-10-19", hhmm: "15:41" });
  // Late evening UTC is still the previous day in Kentucky.
  assert.deepEqual(zonedClock("2026-10-20T02:30:00.000Z", tz), { day: "2026-10-19", hhmm: "22:30" });
  // DST fall-back day (Nov 1 2026): 07:00 is after the change, EST.
  assert.equal(zonedToIso("2026-11-01", "07:00", tz), "2026-11-01T12:00:00.000Z");
  assert.equal(zonedClock(null, tz), null);
});

test("pay weeks start Monday; the export defaults to the last full week", () => {
  assert.equal(payWeekStart("2026-10-19"), "2026-10-19"); // Monday
  assert.equal(payWeekStart("2026-10-25"), "2026-10-19"); // Sunday
  assert.equal(payWeekStart("2026-10-25", 0), "2026-10-25");
  assert.deepEqual(lastFullWeek("2026-10-19"), { start: "2026-10-12", end: "2026-10-18" });
  assert.deepEqual(lastFullWeek("2026-10-21"), { start: "2026-10-12", end: "2026-10-18" });
});

test("acceptance 5: weekly 42 h → 40 regular + 2 OT, allocated to the latest days", () => {
  const days = ["2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16"];
  const rows = [...days.map((day, i) => ({ key: `d${i}`, userId: "luis", day, minutes: 8 * 60 })), { key: "sat", userId: "luis", day: "2026-10-17", minutes: 120 }];
  const out = allocateOvertime(rows);
  assert.deepEqual(out.get("d0"), { regular: 480, overtime: 0 });
  assert.deepEqual(out.get("d4"), { regular: 480, overtime: 0 });
  assert.deepEqual(out.get("sat"), { regular: 0, overtime: 120 });
  const total = [...out.values()].reduce((a, v) => ({ r: a.r + v.regular, o: a.o + v.overtime }), { r: 0, o: 0 });
  assert.deepEqual(total, { r: 2400, o: 120 });
  // OT straddling a day; another person is independent; next week starts fresh.
  const two = allocateOvertime([
    { key: "a", userId: "u", day: "2026-10-12", minutes: 39 * 60 },
    { key: "b", userId: "u", day: "2026-10-13", minutes: 180 },
    { key: "c", userId: "v", day: "2026-10-13", minutes: 180 },
    { key: "d", userId: "u", day: "2026-10-19", minutes: 600 },
  ]);
  assert.deepEqual(two.get("b"), { regular: 60, overtime: 120 });
  assert.deepEqual(two.get("c"), { regular: 180, overtime: 0 });
  assert.deepEqual(two.get("d"), { regular: 600, overtime: 0 });
});

test("[DECIDE] daily OT, when turned on, comes before weekly", () => {
  const out = allocateOvertime([{ key: "a", userId: "u", day: "2026-10-12", minutes: 600 }], { dailyMinutes: 480 });
  assert.deepEqual(out.get("a"), { regular: 480, overtime: 120 });
});

test("acceptance 5: the CSV has the exact header, decimal hours, and opens in Excel (BOM, CRLF, quoting)", () => {
  const row: PayrollRow = {
    employeeNumber: "E-1042",
    employeeName: "Luis Moreno",
    email: "labor@demo.rcl.test",
    workDate: "2026-10-16",
    jobName: "Whitaker kitchen remodel, phase 2",
    jobId: "p1",
    costCode: "09-200",
    costCodeName: "Drywall",
    regularMinutes: 480,
    overtimeMinutes: 120,
    approvedBy: "Lena Ortiz",
    approvedAt: "2026-10-17T12:00:00.000Z",
    notes: 'Said "late start"',
  };
  const csv = payrollCsv([row], { start: "2026-10-12", end: "2026-10-18" });
  assert.ok(csv.startsWith("\uFEFF"));
  const lines = csv.slice(1).split("\r\n");
  assert.equal(
    lines[0],
    "employee_number,employee_name,email,period_start,period_end,work_date,job_name,job_id,cost_code,cost_code_name,regular_hours,overtime_hours,approved_by,approved_at,notes",
  );
  assert.deepEqual(lines[0].split(","), [...PAYROLL_HEADER]);
  assert.equal(
    lines[1],
    'E-1042,Luis Moreno,labor@demo.rcl.test,2026-10-12,2026-10-18,2026-10-16,"Whitaker kitchen remodel, phase 2",p1,09-200,Drywall,8.00,2.00,Lena Ortiz,2026-10-17T12:00:00.000Z,"Said ""late start"""',
  );
  assert.equal(lines[2], "");
  // Sub hours: same columns plus sub_company, never rates.
  const sub = payrollCsv([{ ...row, subCompany: "Bluegrass Electric" }], { start: "2026-10-12", end: "2026-10-18" }, { kind: "sub_hours", includeRates: true });
  assert.equal(sub.slice(1).split("\r\n")[0], `${PAYROLL_HEADER.join(",")},sub_company`);
  assert.ok(sub.includes(",Bluegrass Electric\r\n"));
  // [DECIDE] the rate/amount toggle.
  const rated = payrollCsv([{ ...row, rateCents: 2800, amountCents: 28000 }], { start: "2026-10-12", end: "2026-10-18" }, { includeRates: true });
  assert.equal(rated.slice(1).split("\r\n")[0], `${PAYROLL_HEADER.join(",")},rate,amount`);
  assert.ok(rated.includes(",28.00,280.00\r\n"));
  assert.equal(payrollFilename("payroll", { start: "2026-10-12", end: "2026-10-18" }), "rcl-payroll-2026-10-12_2026-10-18.csv");
  assert.equal(payrollFilename("sub_hours", { start: "2026-10-12", end: "2026-10-18" }), "rcl-sub-hours-2026-10-12_2026-10-18.csv");
});

test("CSV cells: a value a spreadsheet would run as a formula is neutralised", () => {
  assert.equal(csvCell("=HYPERLINK(1)"), "'=HYPERLINK(1)");
  assert.equal(csvCell("@sum"), "'@sum");
  assert.equal(csvCell("plain"), "plain");
  assert.equal(csvCell("a\nb"), '"a\nb"');
});

test("formatting, parsing and money", () => {
  assert.equal(formatMinutes(495), "8h 15m");
  assert.equal(formatMinutes(-5), "0h 00m");
  assert.equal(decimalHours(495), "8.25");
  assert.equal(decimalHours(20), "0.33");
  assert.equal(clock12("07:02"), "7:02 AM");
  assert.equal(clock12("15:41"), "3:41 PM");
  assert.equal(clock12("00:05"), "12:05 AM");
  assert.equal(clock12(""), "—");
  assert.equal(parseHoursInput("5"), 300);
  assert.equal(parseHoursInput("3:15"), 195);
  assert.equal(parseHoursInput("3.25"), 195);
  assert.equal(parseHoursInput("3h 15m"), 195);
  assert.equal(parseHoursInput("45m"), 45);
  assert.equal(parseHoursInput("3:75"), null);
  assert.equal(parseHoursInput("abc"), null);
  assert.equal(parseHoursInput(""), null);
  assert.equal(laborCents(480, 2800, 18), 26432); // 8 h × $28 × 1.18
  assert.equal(shortHours(480), "8h");
  assert.equal(shortHours(495), "8h15");
  assert.deepEqual(weekdayLabel("2026-10-19"), { dow: "Mon", date: "Oct 19" });
});

test("a day's status: rejected, then submitted, then approved, then exported", () => {
  assert.equal(dayStatusOf([]), null);
  assert.equal(dayStatusOf(["approved", "rejected"]), "rejected");
  assert.equal(dayStatusOf(["approved", "submitted"]), "submitted");
  assert.equal(dayStatusOf(["approved", "exported"]), "approved");
  assert.equal(dayStatusOf(["exported"]), "exported");
});
