import { expect, test, type Browser, type Page } from "@playwright/test";
import { mkdirSync, readFileSync } from "node:fs";
import { extractPdfText } from "../src/lib/pdf";

const SHOTS = "/opt/cursor/artifacts/screenshots";

// Activity log (no sign-in): the 24-hour bar, adding a session, and the PDF caption.
// Daily-report sessions: who may create, view and edit, per role.
const LABEL: Record<string, string> = { owner: "Owner", admin: "Admin", lead: "Lead", labor: "Labor", subcontractor: "Subcontractor" };

async function as(browser: Browser, role: string) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto("/login");
  await page.getByTestId("debug-login").getByRole("button", { name: LABEL[role], exact: true }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login") && !u.pathname.startsWith("/m/"), { timeout: 30_000 });
  await expect(page.getByRole("button", { name: /^(Sign out|Account: )/ }).locator("visible=true").first()).toBeVisible({ timeout: 30_000 });
  return { ctx, page };
}

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

const today = (page: Page) =>
  page.evaluate(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  });

test("activity log shows the day bar, adds a session, and the PDF captions it", async ({ page }) => {
  await page.goto("/tracking");
  await expect(page.getByRole("heading", { name: "Activity log" })).toBeVisible();
  const bar = page.getByTestId("day-bar");
  await expect(bar).toBeVisible();
  await expect(bar.getByRole("img")).toContainText("a");
  await expect(bar.getByRole("img")).toContainText("b");
  await expect(page.getByTestId("session-row").filter({ hasText: "Project A" })).toContainText("demolish fence");

  await page.getByTestId("add-session").click();
  const form = page.getByTestId("session-form");
  await expect(form).toBeVisible();
  await form.locator("input[type=time]").nth(0).fill("18:00");
  await form.locator("input[type=time]").nth(1).fill("19:30");
  await form.getByLabel("Project / job").fill("Project C");
  await form.getByLabel("Notes").fill("set the posts");
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: `${SHOTS}/activity-log-bar-and-session.png`, fullPage: true });
  await form.getByRole("button", { name: "Add to the day" }).click();
  await expect(page.getByTestId("session-row").filter({ hasText: "Project C" })).toContainText("set the posts");
  await expect(bar.getByRole("img")).toContainText("c");

  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: /Share day as PDF/ }).click();
  const download = await downloading;
  const saved = `${SHOTS}/activity-log.pdf`;
  await download.saveAs(saved);
  const text = extractPdfText(new Uint8Array(readFileSync(saved))).join("");
  expect(text).toContain("a  Project A demolish fence   b  Project B drywall takeoffs");
  expect(text).toContain("Project C");
  expect(text).toContain("set the posts");

  const pdf = await page.context().newPage();
  await pdf.goto(`file://${saved}`);
  await pdf.waitForTimeout(800);
  await pdf.screenshot({ path: `${SHOTS}/activity-log-pdf-caption.png`, fullPage: true });
  await pdf.close();
});

test("work sessions: labor logs their own, cannot see the crew; a lead can view but not edit someone else's; an owner can", async ({ browser }) => {
  const labor = await as(browser, "labor");
  const day = await today(labor.page);
  const jobs = (await call(labor.page, "getMyReport", { day })).value as { jobs: { id: string; name: string }[] };
  expect(jobs.jobs.length).toBeGreaterThan(0);
  const projectId = jobs.jobs[0].id;
  const created = await call(labor.page, "createWorkSession", { day, projectId, startMin: 8 * 60, endMin: 11 * 60, notes: "demolish fence" });
  expect(created.ok, created.error).toBe(true);
  const id = (created.value as { id: string }).id;
  const mine = await call(labor.page, "listWorkSessions", { day, scope: "mine" });
  expect(mine.ok).toBe(true);
  expect((mine.value as { id: string }[]).some((row) => row.id === id)).toBe(true);
  const crew = await call(labor.page, "listWorkSessions", { day, scope: "company" });
  expect(crew.ok).toBe(false);
  expect(crew.error).toMatch(/can't do that \(session\.review\)/);

  const lead = await as(browser, "lead");
  const seen = await call(lead.page, "listWorkSessions", { day, scope: "company" });
  expect(seen.ok, seen.error).toBe(true);
  expect((seen.value as { id: string }[]).some((row) => row.id === id)).toBe(true);
  const leadEdit = await call(lead.page, "updateWorkSession", { id, day, projectId, startMin: 8 * 60, endMin: 12 * 60, notes: "changed by lead" });
  expect(leadEdit.ok).toBe(false);
  expect(leadEdit.error).toMatch(/can't do that \(session\.manage\)/);

  const sub = await as(browser, "subcontractor");
  expect((await call(sub.page, "listWorkSessions", { day, scope: "company" })).ok).toBe(false);
  const subOwn = await call(sub.page, "createWorkSession", { day, projectId, startMin: 13 * 60, endMin: 15 * 60, notes: "sub hours" });
  expect(subOwn.ok, subOwn.error).toBe(true);

  const owner = await as(browser, "owner");
  const fixed = await call(owner.page, "updateWorkSession", { id, day, projectId, startMin: 8 * 60, endMin: 12 * 60, notes: "demolish fence" });
  expect(fixed.ok, fixed.error).toBe(true);
  expect((fixed.value as { notes: string }).notes).toBe("demolish fence");
  expect((await call(owner.page, "deleteWorkSession", { id })).ok).toBe(true);
  if (subOwn.ok) expect((await call(owner.page, "deleteWorkSession", { id: (subOwn.value as { id: string }).id })).ok).toBe(true);

  await owner.ctx.close();
  await sub.ctx.close();
  await lead.ctx.close();
  await labor.ctx.close();
});
