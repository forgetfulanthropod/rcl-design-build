import { expect, test, type Browser, type Page } from "@playwright/test";

// MGMT phone/tablet layout for sharing (#19): Attention Review buttons and Settings pages
// must not hang off the right edge. Owner and Admin at 390, 768, and 1440.

const LABEL: Record<string, string> = { owner: "Owner", admin: "Admin" };
const WIDTHS = [
  { name: "phone", width: 390, height: 844 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "desktop", width: 1440, height: 900 },
] as const;

async function asAt(browser: Browser, role: string, width: number, height: number) {
  const ctx = await browser.newContext({
    viewport: { width, height },
    isMobile: width < 768,
    hasTouch: width < 768,
  });
  const page = await ctx.newPage();
  await page.goto("/login");
  await page.getByTestId("debug-login").getByRole("button", { name: LABEL[role], exact: true }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login") && !u.pathname.startsWith("/m/"), { timeout: 30_000 });
  await expect(page.getByRole("button", { name: "Sign out" }).first()).toBeVisible({ timeout: 30_000 });
  return { ctx, page };
}

const nav = (page: Page, label: string) =>
  page.getByRole("button", { name: label, exact: true }).locator("visible=true").first();
const settings = (page: Page) => page.getByRole("button", { name: /^Settings/ });

function docFits(page: Page) {
  return page.evaluate(() => {
    const el = document.documentElement;
    return { scrollWidth: el.scrollWidth, clientWidth: el.clientWidth };
  });
}

function listFits(locator: ReturnType<Page["locator"]>) {
  return locator.evaluate((el) => ({ scrollWidth: el.scrollWidth, clientWidth: el.clientWidth }));
}

test.beforeAll(async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto("/login");
  page.once("dialog", (d) => void d.accept());
  await page.getByRole("button", { name: "Reset demo data" }).click();
  await expect(page.getByText("Demo data reset.")).toBeVisible({ timeout: 30_000 });
  await ctx.close();
});

for (const role of ["owner", "admin"] as const) {
  for (const { name, width, height } of WIDTHS) {
    test(`${role} @ ${name} (${width}): Attention Sharing review Review buttons stay in viewport; list does not overflow`, async ({
      browser,
    }) => {
      const { ctx, page } = await asAt(browser, role, width, height);
      await nav(page, "Attention").click();
      const section = page.getByTestId("sharing-review-section");
      await expect(section.getByRole("heading", { name: /Sharing review needed/ })).toBeVisible();
      const list = section.locator("ul");
      const fit = await listFits(list);
      expect(
        fit.scrollWidth,
        `ul scrollWidth ${fit.scrollWidth} > clientWidth ${fit.clientWidth}`,
      ).toBeLessThanOrEqual(fit.clientWidth);

      const buttons = section.getByRole("button", { name: /^Review / });
      const count = await buttons.count();
      expect(count).toBeGreaterThan(0);
      const viewport = page.viewportSize()!;
      for (let i = 0; i < count; i += 1) {
        const box = await buttons.nth(i).boundingBox();
        expect(box, `Review button ${i} missing box`).toBeTruthy();
        expect(box!.x, `Review button ${i} x=${box!.x}`).toBeGreaterThanOrEqual(0);
        expect(box!.x + box!.width, `Review button ${i} right edge past viewport`).toBeLessThanOrEqual(
          viewport.width + 0.5,
        );
      }
      await ctx.close();
    });

    test(`${role} @ ${name} (${width}): Settings tabs and per-job page do not widen the document`, async ({ browser }) => {
      const { ctx, page } = await asAt(browser, role, width, height);
      await settings(page).click();
      await expect(page.getByTestId("sharing-settings")).toBeVisible();

      for (const tab of ["Company defaults", "Projects", "Change log"] as const) {
        await page.getByRole("tab", { name: tab }).click();
        if (tab === "Company defaults") {
          await expect(page.getByRole("switch", { name: "Leads see dollars" })).toBeVisible();
        } else if (tab === "Projects") {
          await expect(page.getByTestId("review-queue")).toBeVisible();
          await expect(page.getByTestId("project-row").locator("visible=true").first()).toBeVisible();
        } else {
          await expect(page.getByRole("region", { name: "Change log" })).toBeVisible();
        }
        const fit = await docFits(page);
        expect(
          fit.scrollWidth,
          `${tab}: scrollWidth ${fit.scrollWidth} > clientWidth ${fit.clientWidth}`,
        ).toBeLessThanOrEqual(fit.clientWidth);
      }

      await page.getByRole("tab", { name: "Projects" }).click();
      await page.getByTestId("review-queue").getByRole("button", { name: /^Review / }).first().click();
      await expect(page.getByTestId("sharing-project")).toBeVisible();
      const jobFit = await docFits(page);
      expect(
        jobFit.scrollWidth,
        `per-job: scrollWidth ${jobFit.scrollWidth} > clientWidth ${jobFit.clientWidth}`,
      ).toBeLessThanOrEqual(jobFit.clientWidth);
      await ctx.close();
    });
  }
}
