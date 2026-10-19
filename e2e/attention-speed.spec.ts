import { expect, test, type Browser } from "@playwright/test";

// Regression for "Attention takes 10–25 s even when the summary is cached". The cached answer
// must show without waiting on the AI, and fresh work shows a progress bar while it runs.
// Needs a server with XAI_API_KEY pointing at e2e/fake-xai.mjs (CI does this).
const LABEL: Record<string, string> = { owner: "Owner", admin: "Admin", lead: "Lead", labor: "Labor", subcontractor: "Subcontractor" };

async function as(browser: Browser, role: string) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  const page = await ctx.newPage();
  await page.goto("/login");
  await page.getByTestId("debug-login").getByRole("button", { name: LABEL[role], exact: true }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login") && !u.pathname.startsWith("/m/"), { timeout: 30_000 });
  await expect(page.locator("header").first()).toBeVisible({ timeout: 30_000 });
  return { ctx, page };
}

const nav = (page: import("@playwright/test").Page, label: string) =>
  page.getByRole("button", { name: label, exact: true }).locator("visible=true").first();

/** Slow down only the fresh (non-cache) attention call, as a real model call would be. */
async function slowFreshCalls(page: import("@playwright/test").Page, ms: number) {
  const seen = { fresh: 0, quick: 0 };
  await page.route("**/_serverFn/**", async (route) => {
    const body = route.request().postData() ?? "";
    if (body.includes("cachedOnly")) {
      if (/"cachedOnly":true/.test(body)) seen.quick += 1;
      else {
        seen.fresh += 1;
        await new Promise((r) => setTimeout(r, ms));
      }
    }
    await route.continue();
  });
  return seen;
}

test.describe.configure({ mode: "serial" });

test.beforeAll(async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto("/login");
  page.once("dialog", (d) => void d.accept());
  await page.getByRole("button", { name: "Reset demo data" }).click();
  await expect(page.getByText("Demo data reset.")).toBeVisible({ timeout: 30_000 });
  await ctx.close();
});

// Each role uses its own range so neither starts from the other's cached summary.
for (const [role, range] of [["owner", "7 days"], ["admin", "Yesterday"]] as const) {
  test(`attention (${role}, ${range}): first read shows progress, a cached read is instant and skips the AI`, async ({ browser }) => {
    const { ctx, page } = await as(browser, role);
    const seen = await slowFreshCalls(page, 3_000);
    await nav(page, "Attention").click();
    await page.getByRole("button", { name: range, exact: true }).click();
    // Fresh work: a progress bar while it runs, then the generated summary.
    await expect(page.getByRole("progressbar", { name: "Writing a fresh summary" })).toBeVisible();
    await expect(page.getByText(/^Read \d+ reports? · (generated|cached) /)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("progressbar")).toHaveCount(0);

    // Leave and come back: the cached summary shows well under the slow AI delay, with no fresh call.
    await nav(page, "Reports").click();
    const freshBefore = seen.fresh;
    await nav(page, "Attention").click();
    const started = Date.now();
    await page.getByRole("button", { name: range, exact: true }).click();
    await expect(page.getByText(/^Read \d+ reports? · cached /)).toBeVisible({ timeout: 2_500 });
    expect(Date.now() - started).toBeLessThan(2_500);
    await expect(page.getByRole("progressbar")).toHaveCount(0);
    expect(seen.fresh).toBe(freshBefore);
    await ctx.close();
  });
}

test("attention: new report text shows the last summary at once, then refreshes with progress", async ({ browser }) => {
  // Labor writes something new today, so the 7-day summary is stale.
  const labor = await as(browser, "labor");
  await labor.page.locator("#narrative").fill("Found a gas smell near the meter. Shut the valve and called the utility.");
  await labor.page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(labor.page.getByRole("button", { name: "Saved", exact: true })).toBeVisible();
  await labor.ctx.close();

  const { ctx, page } = await as(browser, "owner");
  await slowFreshCalls(page, 3_000);
  await nav(page, "Attention").click();
  await page.getByRole("button", { name: "7 days", exact: true }).click();
  await expect(page.getByText(/· last summary /)).toBeVisible({ timeout: 2_500 });
  await expect(page.getByTestId("attention-list")).toBeVisible();
  await expect(page.getByRole("progressbar", { name: "Writing a fresh summary" })).toBeVisible();
  await expect(page.getByText(/^Read \d+ reports · generated /)).toBeVisible({ timeout: 30_000 });
  await ctx.close();
});

test("attention stays principal-only (labor and sub are refused by the server)", async ({ browser }) => {
  for (const role of ["labor", "subcontractor", "lead"] as const) {
    const { ctx, page } = await as(browser, role);
    const message = await page.evaluate(async () => {
      const fns = await import("/src/lib/server/fns.ts");
      const day = new Date().toISOString().slice(0, 10);
      try {
        await fns.getAttention({ data: { from: day, to: day, cachedOnly: true } });
        return "allowed";
      } catch (e) {
        return (e as Error).message;
      }
    });
    expect(message, role).toContain("report.review");
    await ctx.close();
  }
});
