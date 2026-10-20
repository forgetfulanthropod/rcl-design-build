import { expect, test, type Browser, type Page } from "@playwright/test";

// Regression (spec 05 · F1): a nav click right after debug sign-in must stick. On a cold dev
// server the clicked view's route chunk is still compiling, so the old view stayed on screen
// while the navigation was pending; a click there (Reports' own "7 days" filter) or a redirect
// to the role's first view replaced the URL back. The chunk delay below makes that window
// deterministic instead of depending on how cold the server is.
const LABEL: Record<string, string> = { owner: "Owner", admin: "Admin", lead: "Lead", labor: "Labor", subcontractor: "Subcontractor" };
const COLD_MS = 1_500;

async function signIn(browser: Browser, role: string, coldRoute: string) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  const page = await ctx.newPage();
  // Dev server only: hold the clicked view's route module like a cold on-demand compile.
  await page.route(new RegExp(`/src/routes/_desk\\.${coldRoute.replace(".", "\\.")}\\.tsx`), async (route) => {
    await new Promise((resolve) => setTimeout(resolve, COLD_MS));
    await route.continue();
  });
  await page.goto("/login");
  await page.getByTestId("debug-login").getByRole("button", { name: LABEL[role], exact: true }).click();
  return { ctx, page };
}

const nav = (page: Page, label: string) => page.getByRole("button", { name: label, exact: true }).locator("visible=true").first();

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

for (const { role, first, tab, path, routeFile, next } of [
  // Owner: Attention, then its "7 days" range (Reports has a "7 days" filter too).
  { role: "owner", first: /\/reports\/?$/, tab: "Attention", path: "/attention", routeFile: "attention", next: "7 days" },
  { role: "lead", first: /\/today\/?$/, tab: "Activities", path: "/activities", routeFile: "activities", next: "" },
  { role: "lead", first: /\/today\/?$/, tab: "My reports", path: "/mine", routeFile: "mine", next: "" },
] as const) {
  test(`nav right after sign-in sticks (${role} → ${tab})`, async ({ browser }) => {
    const { ctx, page } = await signIn(browser, role, routeFile);
    // Click the moment the tab exists: the "/" redirect may still be in flight.
    await nav(page, tab).click({ timeout: 30_000 });
    if (next) await page.getByRole("button", { name: next, exact: true }).click();
    // Loading finished: the view is on screen and nothing is still opening.
    await expect(page.getByRole("status", { name: /^Opening/ })).toHaveCount(0, { timeout: 30_000 });
    await expect(nav(page, tab)).toHaveAttribute("aria-current", "page");
    await expect(page).toHaveURL((u) => u.pathname === path);
    // And it stays there once the router is idle (no late redirect or replace).
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(500);
    expect(new URL(page.url()).pathname).toBe(path);
    await expect(page).not.toHaveURL(first);
    await expect(page.locator("header").first()).toContainText(tab);
    if (next) {
      // The range click reached Attention, not the Reports filter.
      await expect(page).toHaveURL((u) => u.pathname === "/attention" && u.searchParams.has("from"));
      await expect(page.getByRole("progressbar", { name: "Writing a fresh summary" }).or(page.getByText(/^Read \d+ reports? · /))).toBeVisible({ timeout: 30_000 });
    }
    await ctx.close();
  });
}
