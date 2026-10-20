import { expect, test, type Browser, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";

// Spec 02 · Timesheets — the Hours step, My hours, approvals, payroll export, per role.
// Runs serially on fresh demo data: Luis (labor) submits today, Lena (lead) rejects then approves,
// Adam (admin) exports today's payroll, Olivia (owner) voids it.
const LABEL: Record<string, string> = { owner: "Owner", admin: "Admin", lead: "Lead", labor: "Labor", subcontractor: "Subcontractor" };
const DESKTOP = { width: 1440, height: 900 };
const PHONE = { width: 390, height: 844 };

async function as(browser: Browser, role: string, viewport = DESKTOP) {
  const phone = viewport.width < 768;
  const ctx = await browser.newContext({ viewport, isMobile: phone, hasTouch: phone, acceptDownloads: true });
  const page = await ctx.newPage();
  await page.goto("/login");
  await page.getByTestId("debug-login").getByRole("button", { name: LABEL[role], exact: true }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login") && !u.pathname.startsWith("/m/"), { timeout: 30_000 });
  await expect(page.getByRole("button", { name: /^(Sign out|Account: )/ }).locator("visible=true").first()).toBeVisible({ timeout: 30_000 });
  return { ctx, page };
}

const nav = (page: Page, label: string) => page.getByRole("button", { name: label, exact: true }).locator("visible=true").first();

/** Calls a server fn from the signed-in page, the same RPC the UI uses. */
async function call(page: Page, fn: string, data?: unknown): Promise<{ ok: boolean; value?: unknown; error?: string }> {
  return page.evaluate(
    async ([name, payload]) => {
      const fns = (await import("/src/lib/server/fns.ts")) as unknown as Record<string, (a: { data: unknown }) => Promise<unknown>>;
      try {
        return { ok: true, value: await fns[name as string]({ data: payload }) };
      } catch (e) {
        return { ok: false, error: (e as Error).message };
      }
    },
    [fn, data] as const,
  );
}

const localDay = (page: Page) =>
  page.evaluate(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  });

type Board = { people: { userId: string; name: string }[]; jobs: { projectId: string; name: string }[]; assignments: { id: string; userId: string; day: string }[] };
let luisId = "";
let lenaId = "";
let today = "";

async function openTime(page: Page) {
  await nav(page, "Time").click();
  await expect(page.getByTestId("time-view")).toBeVisible({ timeout: 30_000 });
}

test.describe.configure({ mode: "serial" });

test.beforeAll(async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto("/login");
  page.once("dialog", (d) => void d.accept());
  await page.getByRole("button", { name: "Reset demo data" }).click();
  await expect(page.getByText("Demo data reset.")).toBeVisible({ timeout: 60_000 });
  await ctx.close();
  // Put Luis on Whitaker today, with no report yet, so the approvals table has a "No report" row.
  const owner = await as(browser, "owner");
  today = await localDay(owner.page);
  const board = (await call(owner.page, "getCrewBoard", { week: today })).value as Board;
  luisId = board.people.find((p) => p.name === "Luis Moreno")!.userId;
  lenaId = board.people.find((p) => p.name === "Lena Ortiz")!.userId;
  const whitaker = board.jobs.find((j) => j.name.startsWith("Whitaker"))!;
  for (const a of board.assignments.filter((x) => x.userId === luisId && x.day === today)) {
    await call(owner.page, "removeCrewAssignment", { id: a.id });
  }
  const assigned = await call(owner.page, "assignCrew", { userId: luisId, projectId: whitaker.projectId, day: today, part: "full" });
  expect(assigned.ok, assigned.error).toBe(true);
  await owner.ctx.close();
});

for (const role of ["labor", "subcontractor"] as const) {
  test(`${role}: no Time nav on desktop or phone; every review, approve, export and rate call is refused`, async ({ browser }) => {
    for (const viewport of [DESKTOP, PHONE]) {
      const { ctx, page } = await as(browser, role, viewport);
      await expect(page.getByRole("button", { name: "Time", exact: true })).toHaveCount(0);
      if (viewport === PHONE) await expect(page.getByRole("navigation", { name: "Main" }).getByRole("button")).toHaveCount(role === "labor" ? 5 : 3);
      if (viewport === DESKTOP) {
        for (const [fn, data, action] of [
          ["getTimeWeek", {}, "time.review"],
          ["approveTime", { ids: ["x"] }, "time.approve"],
          ["rejectTime", { ids: ["x"], reason: "x" }, "time.approve"],
          ["editTime", { id: "x", projectId: null, costCodeId: null, minutes: 60 }, "time.approve"],
          ["unlockTime", { ids: ["x"] }, "time.unlock"],
          ["nudgeTime", { userId: luisId, day: today }, "time.approve"],
          ["previewPayroll", {}, "time.export"],
          ["runPayroll", { start: today, end: today }, "time.export"],
          ["listPayrollExports", undefined, "time.export"],
          ["voidPayroll", { id: "x" }, "time.export.void"],
          ["listPayRates", undefined, "rate.view"],
          ["setPayRate", { userId: luisId, effectiveOn: today, rateCents: 9900, burdenPct: 0 }, "rate.edit"],
        ] as const) {
          const r = await call(page, fn, data);
          expect(r.ok, fn).toBe(false);
          expect(r.error, fn).toContain(action);
        }
        // The URL doesn't open it either.
        await page.goto(`/time?week=${today}`);
        await expect(page.getByTestId("desk-notice")).toHaveText("That page isn't on your desk.");
        await expect(page).toHaveURL(/\/today$/);
        // Their own hours are theirs.
        const mine = await call(page, "getMyHours", { week: today });
        expect(mine.ok, mine.error).toBe(true);
      }
      await ctx.close();
    }
  });
}

test("lead: Time shows a No report row for Luis; Nudge asks first, then sends one text", async ({ browser }) => {
  const { ctx, page } = await as(browser, "lead");
  await openTime(page);
  const row = page.getByTestId(`row-${luisId}`).first();
  await expect(row.getByText("No report")).toBeVisible();
  await row.getByRole("button", { name: /^Nudge Luis Moreno/ }).click();
  const dialog = page.getByRole("dialog", { name: "Text Luis a reminder?" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("This sends a text");
  await dialog.getByRole("button", { name: "Send text" }).click();
  await expect(page.getByText("Reminder sent to Luis Moreno.")).toBeVisible();
  await expect(row.getByText("Nudged")).toBeVisible();
  // The server refuses a second one for the same day.
  const again = await call(page, "nudgeTime", { userId: luisId, day: today });
  expect(again.error).toMatch(/Already nudged/);
  await ctx.close();
});

test("labor (phone): Hours card prefills, 07:02–15:41 with 30 lunch is 8h 15m, 06:45 is 8h 30m; split must add up; Submit 8h 30m", async ({ browser }) => {
  const { ctx, page } = await as(browser, "labor", PHONE);
  await page.locator("#narrative").fill("Hung the rest of the hallway drywall, then framed the Oak Street closet.");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("button", { name: "Saved", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Submit my day", exact: true }).click();
  const card = page.getByTestId("hours-card");
  await expect(card).toBeVisible();
  const start = card.getByLabel("Start", { exact: true });
  const end = card.getByLabel("End", { exact: true });
  await expect(start).not.toHaveValue(""); // from the first edit
  await expect(card.getByText(/Start is from your first edit/)).toBeVisible();
  await expect(page.getByRole("slider", { name: "Lunch duration" })).toHaveAttribute("aria-valuenow", "30");

  await start.fill("07:02");
  await end.fill("15:41");
  await expect(page.getByTestId("hours-total")).toHaveText("8h 15m");
  await expect(page.getByTestId("hours-raw")).toHaveText("8h 09m before rounding to 15 min");
  await expect(page.getByRole("button", { name: "Submit 8h 15m" })).toBeEnabled();
  await start.fill("06:45");
  await expect(page.getByTestId("hours-total")).toHaveText("8h 30m");
  await expect(card.getByText(/Start is from your first edit/)).toHaveCount(0);

  // End before start is blocked inline.
  await end.fill("06:00");
  await expect(page.getByTestId("hours-errors")).toContainText("End must be after start.");
  await expect(page.getByRole("button", { name: /^Submit \d+h \d{2}m$/ })).toBeDisabled();
  await end.fill("15:41");

  // Split across jobs: 5h Whitaker + 3h Oak doesn't add up; 3:30 does.
  await card.getByRole("button", { name: "+ Split across jobs" }).click();
  await card.getByLabel("Job, line 1").selectOption({ label: "Whitaker kitchen remodel" });
  await card.getByLabel("Hours, line 1").fill("5");
  await card.getByLabel("Job, line 2").selectOption({ label: "Oak Street duplex addition" });
  await card.getByLabel("Cost code, line 2").selectOption({ label: "06-100 Rough carpentry/framing" });
  await card.getByLabel("Hours, line 2").fill("3");
  await expect(page.getByTestId("hours-errors")).toContainText("0h 30m still to assign.");
  await expect(page.getByTestId("hours-remaining")).toHaveText("Remaining 0h 30m");
  await expect(page.getByRole("button", { name: "Submit 8h 30m" })).toBeDisabled();
  await card.getByLabel("Hours, line 2").fill("3:30");
  await expect(page.getByTestId("hours-remaining")).toHaveText("Remaining 0h 00m");
  await page.getByRole("button", { name: "Submit 8h 30m" }).click();
  await expect(page.getByText(/✓ Submitted at/)).toBeVisible();

  // My hours: today shows 8h30, Submitted.
  await nav(page, "My reports").click();
  const strip = page.getByTestId("my-hours");
  await expect(strip).toBeVisible();
  await expect(page.getByTestId(`my-hours-${today}`)).toContainText("8h30");
  await expect(page.getByTestId(`my-hours-${today}`).getByLabel("Submitted")).toBeVisible();
  await ctx.close();
});

test("lead (desktop): sees only her jobs, no rates or export; opens Luis's day, sees two edited lines and his report; rejects with a reason; can't approve her own day", async ({ browser }) => {
  const { ctx, page } = await as(browser, "lead");
  await openTime(page);
  await expect(page.getByRole("button", { name: "Pay rates" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Export payroll" })).toHaveCount(0);
  await expect(page.getByRole("columnheader", { name: "Labor $" })).toHaveCount(0);
  await expect(page.getByTestId("time-table").getByRole("rowheader", { name: "Whitaker kitchen remodel" }).or(page.getByTestId("time-table").getByText("Whitaker kitchen remodel").first())).toBeVisible();
  const week = (await call(page, "getTimeWeek", { week: today, today })).value as Record<string, unknown>;
  expect(JSON.stringify(week)).not.toMatch(/rate_?[cC]ents|laborCents|burden/);
  expect((week.entries as { projectName: string }[]).every((e) => /Whitaker|Oak Street/.test(e.projectName))).toBe(true);

  // Luis's day is on both of Lena's jobs, so it shows in each job group.
  const cell = page.getByTestId(`cell-${luisId}-${today}`).first();
  await expect(cell).toHaveAttribute("data-status", "submitted");
  // Keyboard: the cell is a button; Enter opens the drawer.
  await cell.focus();
  await page.keyboard.press("Enter");
  const drawer = page.getByRole("dialog", { name: /^Luis Moreno · / });
  await expect(drawer).toBeVisible();
  // The drawer holds the whole day: both of Luis's lines, on Whitaker and Oak Street.
  await expect(drawer.getByTestId("drawer-lines").getByRole("listitem")).toHaveCount(2);
  await expect(drawer.getByText("edited", { exact: true })).toHaveCount(2);
  await expect(drawer.getByText(/6:45 AM – 3:41 PM · Lunch 30 min/)).toBeVisible();
  await expect(drawer.getByTestId("report-card")).toContainText("Hung the rest of the hallway drywall");
  await drawer.getByRole("button", { name: "Reject" }).click();
  await expect(drawer.getByRole("button", { name: "Send back" })).toBeDisabled(); // reason required
  await drawer.getByLabel(/Why\?/).fill("Lunch was an hour on site.");
  await drawer.getByRole("button", { name: "Send back" }).click();
  await expect(drawer).toBeHidden();
  await expect(page.getByTestId(`cell-${luisId}-${today}`).first()).toHaveAttribute("data-status", "rejected");

  // Her own day: no Approve, and the server refuses it too.
  const own = page.getByTestId(`cell-${lenaId}-${today}`).first();
  await own.click();
  const mine = page.getByRole("dialog", { name: /^Lena Ortiz · / });
  await expect(mine.getByText("These are your own hours. An admin or owner approves them.")).toBeVisible();
  await expect(mine.getByRole("button", { name: "Approve" })).toHaveCount(0);
  await mine.getByRole("button", { name: "Close" }).click();
  const ownIds = (week.entries as { id: string; userId: string; day: string }[]).filter((e) => e.userId === lenaId && e.day === today).map((e) => e.id);
  const refused = await call(page, "approveTime", { ids: ownIds });
  expect(refused.error).toMatch(/Your own hours go to an admin or owner/);
  await ctx.close();
});

test("labor: the rejected day shows its reason; fixing it re-sends 8h 00m with an hour's lunch", async ({ browser }) => {
  const { ctx, page } = await as(browser, "labor", PHONE);
  await nav(page, "My reports").click();
  await expect(page.getByTestId(`my-hours-${today}`).getByLabel("Rejected")).toBeVisible();
  await expect(page.getByTestId("rejected-reason")).toHaveText("Sent back: Lunch was an hour on site.");
  await page.getByRole("button", { name: /^Fix / }).click();
  await expect(page).toHaveURL(new RegExp(`/today\\?day=${today}$`));
  await expect(page.locator("#narrative")).toBeEnabled();
  await page.getByRole("button", { name: "Submit my day", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Sent back: Lunch was an hour on site." })).toBeVisible();
  const card = page.getByTestId("hours-card");
  await expect(card.getByLabel("Start", { exact: true })).toHaveValue("06:45"); // as sent before
  await expect(card.getByLabel("Hours, line 2")).toHaveValue("3:30");
  const dial = page.getByRole("slider", { name: "Lunch duration" });
  await dial.focus();
  await page.keyboard.press("End");
  await expect(dial).toHaveAttribute("aria-valuenow", "60");
  await expect(page.getByTestId("hours-total")).toHaveText("8h 00m");
  await card.getByLabel("Hours, line 2").fill("3:00");
  await page.getByRole("button", { name: "Submit 8h 00m" }).click();
  await expect(page.getByText(/✓ Submitted at/)).toBeVisible();
  await ctx.close();
});

test("lead: approves Luis's re-sent day from the drawer; bulk approve leaves flagged days and her own out; the week is in the URL", async ({ browser }) => {
  const { ctx, page } = await as(browser, "lead");
  await openTime(page);
  const cell = page.getByTestId(`cell-${luisId}-${today}`).first();
  await expect(cell).toHaveAttribute("data-status", "submitted");
  await cell.click();
  const drawer = page.getByRole("dialog", { name: /^Luis Moreno · / });
  await drawer.getByRole("button", { name: "Approve" }).click();
  await expect(drawer).toBeHidden();
  await expect(page.getByTestId(`cell-${luisId}-${today}`).first()).toHaveAttribute("data-status", "approved");
  await expect(page.getByTestId(`cell-${luisId}-${today}`).last()).toHaveAttribute("data-status", "approved");
  await expect(page.getByTestId("bulk-bar")).toContainText("Flagged days and your own hours are left out.");
  // The week is in the URL: last week, reload, still last week; back to this week.
  await expect(page).toHaveURL(/\/time\?week=\d{4}-\d{2}-\d{2}$/);
  const thisWeek = new URL(page.url()).searchParams.get("week")!;
  await page.getByRole("button", { name: "Previous week" }).click();
  await expect.poll(() => new URL(page.url()).searchParams.get("week")).not.toBe(thisWeek);
  const lastWeek = new URL(page.url()).searchParams.get("week")!;
  expect(lastWeek).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  await expect(page.getByTestId(`cell-${luisId}-${today}`)).toHaveCount(0);
  await page.reload();
  await expect(page.getByTestId("time-view")).toBeVisible({ timeout: 30_000 });
  expect(new URL(page.url()).searchParams.get("week")).toBe(lastWeek);
  await expect(page.getByTestId(`cell-${luisId}-${today}`)).toHaveCount(0);
  await page.goto(`/time?week=${today}`);
  await expect(page.getByTestId(`cell-${luisId}-${today}`).first()).toHaveAttribute("data-status", "approved");
  await expect(page).toHaveTitle("Time · RCL");
  await ctx.close();
});

test("admin: every job, labor $ and pay rates; export is blocked by an unapproved day, then downloads the CSV and locks it", async ({ browser }) => {
  const { ctx, page } = await as(browser, "admin");
  await openTime(page);
  await expect(page.getByRole("columnheader", { name: "Labor $" })).toBeVisible();
  await page.getByRole("button", { name: "Pay rates" }).click();
  const rates = page.getByRole("dialog", { name: "Pay rates" });
  await expect(rates.getByTestId("pay-rates")).toContainText("Luis Moreno");
  await expect(rates.getByTestId("pay-rates")).toContainText("$28/h · +18% burden");
  await rates.getByRole("button", { name: "Close" }).click();

  await page.getByRole("button", { name: "Export payroll" }).click();
  const sheet = page.getByRole("dialog", { name: "Payroll export" });
  await sheet.getByLabel("From").fill(today);
  await sheet.getByLabel("To").fill(today);
  // Lena's seeded day today is still waiting; Sam's sub hours are left out of payroll.
  await expect(sheet.getByTestId("export-checks")).toContainText("1 entry not approved.");
  await expect(sheet.getByTestId("export-checks")).toContainText("Sub hours excluded");
  await expect(sheet.getByRole("button", { name: "Download CSV" })).toBeDisabled();
  await expect(sheet.getByRole("button", { name: "Show them" })).toBeVisible();
  await sheet.getByRole("button", { name: "Close" }).click();

  // Approve Lena's day (an admin may approve a Lead's hours).
  await page.getByTestId(`cell-${lenaId}-${today}`).first().click();
  const drawer = page.getByRole("dialog", { name: /^Lena Ortiz · / });
  await drawer.getByRole("button", { name: "Approve" }).click();
  await expect(drawer).toBeHidden();

  await page.getByRole("button", { name: "Export payroll" }).click();
  await sheet.getByLabel("From").fill(today);
  await sheet.getByLabel("To").fill(today);
  await expect(sheet.getByTestId("export-checks")).toContainText("Everything in the period is approved.");
  await expect(sheet.getByTestId("export-preview")).toContainText("Luis Moreno");
  const [download] = await Promise.all([page.waitForEvent("download"), sheet.getByRole("button", { name: "Download CSV" }).click()]);
  expect(download.suggestedFilename()).toBe(`rcl-payroll-${today}_${today}.csv`);
  const csv = readFileSync((await download.path())!, "utf8").replace(/^\uFEFF/, "");
  const lines = csv.trim().split("\r\n");
  expect(lines[0]).toBe(
    "employee_number,employee_name,email,period_start,period_end,work_date,job_name,job_id,cost_code,cost_code_name,regular_hours,overtime_hours,approved_by,approved_at,notes",
  );
  const luis = lines.filter((l) => l.includes("Luis Moreno"));
  expect(luis).toHaveLength(2);
  expect(luis.find((l) => l.includes("Whitaker kitchen remodel"))).toContain(",5.00,0.00,Lena Ortiz,");
  expect(luis.find((l) => l.includes("Oak Street duplex addition"))).toContain(",06-100,Rough carpentry/framing,3.00,0.00,Lena Ortiz,");
  expect(csv).not.toContain("Sam Whitfield");
  await expect(sheet.getByTestId("export-history")).toContainText(`Payroll · ${today} to ${today}`);
  await expect(sheet.getByRole("button", { name: "Void export" })).toHaveCount(0); // owner only
  await sheet.getByRole("button", { name: "Close" }).click();
  await expect(page.getByTestId(`cell-${luisId}-${today}`).first()).toHaveAttribute("data-status", "exported");
  // Locked: edits and reopening are refused on the server.
  const week = (await call(page, "getTimeWeek", { week: today, today })).value as { entries: { id: string; userId: string; day: string }[] };
  const id = week.entries.find((e) => e.userId === luisId && e.day === today)!.id;
  expect((await call(page, "editTime", { id, projectId: null, costCodeId: null, minutes: 60 })).error).toMatch(/payroll export/);
  expect((await call(page, "unlockTime", { ids: [id] })).error).toMatch(/payroll export/);
  await ctx.close();
});

test("owner: voids the export; Luis's hours are approved again", async ({ browser }) => {
  const { ctx, page } = await as(browser, "owner");
  await openTime(page);
  await page.getByRole("button", { name: "Export payroll" }).click();
  const sheet = page.getByRole("dialog", { name: "Payroll export" });
  const item = sheet.getByTestId("export-history").getByRole("listitem").filter({ hasText: `Payroll · ${today} to ${today}` });
  await item.getByRole("button", { name: "Void export" }).click();
  await item.getByRole("button", { name: "Yes, void it" }).click();
  await expect(item).toContainText("Void (Olivia Grant)");
  await sheet.getByRole("button", { name: "Close" }).click();
  await expect(page.getByTestId(`cell-${luisId}-${today}`).first()).toHaveAttribute("data-status", "approved");
  await ctx.close();
});

test("lead (phone): Time is a header icon, the six tabs stay, and the day list is grouped with tap-to-open", async ({ browser }) => {
  const { ctx, page } = await as(browser, "lead", PHONE);
  const tabs = page.getByRole("navigation", { name: "Main" }).getByRole("button");
  await expect(tabs).toHaveText(["Today", "My reports", "Crew", "Activities", "Docs", "Safety"]);
  await openTime(page);
  const list = page.getByTestId("time-phone-list");
  await expect(list).toBeVisible();
  await expect(page.getByTestId("time-table")).toBeHidden();
  await expect(list.getByText("Luis Moreno").first()).toBeVisible();
  const width = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(width).toBeLessThanOrEqual(390);
  await ctx.close();
});
