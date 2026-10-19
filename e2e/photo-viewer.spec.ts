import { expect, test, type Browser } from "@playwright/test";

// Regression for "Escape doesn't close the photo viewer" (spec 05 · F9).
// Runs against a server with debug login ON. Uses the seeded demo reports, which have photos.
const LABEL: Record<string, string> = { owner: "Owner", admin: "Admin", lead: "Lead", labor: "Labor", subcontractor: "Subcontractor" };

async function as(browser: Browser, role: string) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  const page = await ctx.newPage();
  await page.goto("/login");
  await page.getByTestId("debug-login").getByRole("button", { name: LABEL[role], exact: true }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login") && !u.pathname.startsWith("/m/"), { timeout: 30_000 });
  await expect(page.getByRole("button", { name: "Sign out" }).first()).toBeVisible({ timeout: 30_000 });
  return { ctx, page };
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

for (const role of ["owner", "labor"] as const) {
  test(`photo viewer (${role}): Escape closes it, focus returns, image click keeps it open, backdrop closes`, async ({ browser }) => {
    const { ctx, page } = await as(browser, role);
    if (role === "owner") {
      await page.getByRole("button", { name: "7 days", exact: true }).locator("visible=true").first().click();
    } else {
      await page.getByRole("button", { name: "My reports", exact: true }).locator("visible=true").first().click();
    }
    const thumb = page.locator("[data-photo-id]").first();
    await expect(thumb).toBeVisible({ timeout: 20_000 });

    // Escape closes, and focus goes back to the thumbnail that opened it.
    await thumb.click();
    const viewer = page.getByTestId("photo-viewer");
    await expect(page.getByTestId("photo-full")).toBeVisible();
    await expect(page.getByRole("button", { name: "Close" })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(viewer).toHaveCount(0);
    await expect(thumb).toBeFocused();

    // Tab stays inside the viewer (focus trap).
    await thumb.click();
    await expect(page.getByTestId("photo-full")).toBeVisible();
    for (let i = 0; i < 3; i += 1) {
      await page.keyboard.press("Tab");
      expect(await viewer.evaluate((el) => el.contains(document.activeElement))).toBe(true);
    }

    // Clicking the photo itself doesn't close it; clicking the backdrop does.
    await page.getByTestId("photo-full").click();
    await expect(viewer).toBeVisible();
    await page.mouse.click(8, 850);
    await expect(viewer).toHaveCount(0);

    // The Close button still works.
    await thumb.click();
    await page.getByRole("button", { name: "Close" }).click();
    await expect(viewer).toHaveCount(0);
    await ctx.close();
  });
}
