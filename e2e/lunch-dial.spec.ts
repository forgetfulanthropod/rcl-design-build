import { expect, test, type Browser, type Page } from "@playwright/test";

// Regression for spec 05 · F7: on desktop, "Submit my day" opened the lunch step below the
// fold and nothing scrolled or moved focus. The dial and the Submit button must now be fully
// in the viewport, with keyboard focus on the dial. The demo seeds Lead's and Sub's day as
// already submitted, so the lunch step only exists for Labor's day; Owner/Admin don't write reports.
const LABEL: Record<string, string> = { lead: "Lead", labor: "Labor", subcontractor: "Subcontractor" };
const LONG = Array.from({ length: 40 }, (_, i) => `Line ${i + 1}: hung drywall in the hallway, taped and mudded the seams.`).join("\n");

async function as(browser: Browser, role: string, viewport: { width: number; height: number }) {
  const phone = viewport.width < 768;
  const ctx = await browser.newContext({ viewport, isMobile: phone, hasTouch: phone });
  const page = await ctx.newPage();
  await page.goto("/login");
  await page.getByTestId("debug-login").getByRole("button", { name: LABEL[role], exact: true }).click();
  await page.waitForURL((u) => u.pathname === "/", { timeout: 30_000 });
  await expect(page.locator("#narrative")).toBeVisible({ timeout: 30_000 });
  return { ctx, page };
}

async function fullyInView(page: Page, name: string, box: { y: number; height: number } | null) {
  const vh = page.viewportSize()!.height;
  expect(box, name).not.toBeNull();
  expect(box!.y, `${name} top`).toBeGreaterThanOrEqual(0);
  expect(box!.y + box!.height, `${name} bottom`).toBeLessThanOrEqual(vh);
}

async function openLunchStep(page: Page) {
  await page.locator("#narrative").fill(LONG);
  await page.getByRole("button", { name: "Submit my day", exact: true }).click();
  const dial = page.getByRole("slider", { name: /lunch/i });
  const submit = page.getByRole("button", { name: /^Submit \d+h \d{2}m$/ });
  await expect(dial).toBeFocused();
  // Allow the smooth scroll to settle.
  await expect.poll(async () => (await submit.boundingBox())?.y ?? 1e6).toBeLessThan(page.viewportSize()!.height);
  await page.waitForTimeout(400);
  await fullyInView(page, "lunch dial", await dial.boundingBox());
  await fullyInView(page, "Submit button", await submit.boundingBox());
  return { dial, submit };
}

test.describe.configure({ mode: "serial" });

test.beforeAll(async ({ browser }) => {
  // Other specs submit Labor's day; start from fresh demo data so the lunch step is reachable.
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto("/login");
  page.once("dialog", (d) => void d.accept());
  await page.getByRole("button", { name: "Reset demo data" }).click();
  await expect(page.getByText("Demo data reset.")).toBeVisible({ timeout: 30_000 });
  await ctx.close();
});

for (const [w, h] of [[1440, 900], [1280, 720]] as const) {
  const role = "labor";
  test(`desktop ${w}x${h} (${role}): Submit my day brings the lunch dial and Submit into view, focus on the dial`, async ({ browser }) => {
    const { ctx, page } = await as(browser, role, { width: w, height: h });
    const { dial } = await openLunchStep(page);
    // The keyboard works on the dial straight away.
    const before = Number(await dial.getAttribute("aria-valuenow"));
    await page.keyboard.press("ArrowUp");
    await expect(dial).not.toHaveAttribute("aria-valuenow", String(before));
    await page.getByRole("button", { name: "Not yet", exact: true }).click();
    await ctx.close();
  });
}

test("phone 390x844 (labor): the lunch step is in view too", async ({ browser }) => {
  const { ctx, page } = await as(browser, "labor", { width: 390, height: 844 });
  await openLunchStep(page);
  await ctx.close();
});
