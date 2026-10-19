import { expect, test, type Browser } from "@playwright/test";

// Regression for "Sign out is too small on phones" (spec 05 · F8): the sign-out target is at
// least 44×44 CSS px at 390 px wide and on desktop, has full contrast, and still signs out.
const LABEL: Record<string, string> = { owner: "Owner", admin: "Admin", lead: "Lead", labor: "Labor", subcontractor: "Subcontractor" };
const PHONE = { width: 390, height: 844 };
const DESKTOP = { width: 1440, height: 900 };

async function as(browser: Browser, role: string, viewport: { width: number; height: number }) {
  const phone = viewport.width < 768;
  const ctx = await browser.newContext({ viewport, isMobile: phone, hasTouch: phone });
  const page = await ctx.newPage();
  await page.goto("/login");
  await page.getByTestId("debug-login").getByRole("button", { name: LABEL[role], exact: true }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login") && !u.pathname.startsWith("/m/"), { timeout: 30_000 });
  await expect(page.locator("header").first()).toBeVisible({ timeout: 30_000 });
  return { ctx, page };
}

/** WCAG contrast ratio between an element's text colour and the nearest opaque background. */
async function contrast(locator: import("@playwright/test").Locator) {
  return locator.evaluate((el) => {
    const parse = (c: string) => (c.match(/[\d.]+/g) ?? []).map(Number);
    const lum = ([r, g, b]: number[]) => {
      const f = (v: number) => {
        const s = v / 255;
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    };
    const style = getComputedStyle(el);
    const fg = parse(style.color);
    let node: Element | null = el;
    let bg = [0, 0, 0];
    while (node) {
      const c = parse(getComputedStyle(node).backgroundColor);
      if (c.length >= 3 && (c.length < 4 || c[3] > 0.9)) {
        bg = c;
        break;
      }
      node = node.parentElement;
    }
    if (!node) bg = parse(getComputedStyle(document.body).backgroundColor);
    const alpha = Number(style.opacity);
    const mixed = fg.slice(0, 3).map((v, i) => v * alpha + bg[i] * (1 - alpha));
    const [a, b] = [lum(mixed), lum(bg)].sort((x, y) => y - x);
    return (a + 0.05) / (b + 0.05);
  });
}

for (const role of ["owner", "labor", "subcontractor"] as const) {
  test(`phone (${role}): account menu and Sign out are ≥44 px, readable, and sign out works`, async ({ browser }) => {
    const { ctx, page } = await as(browser, role, PHONE);
    const trigger = page.getByTestId("account-menu");
    const t = (await trigger.boundingBox())!;
    expect(t.width).toBeGreaterThanOrEqual(44);
    expect(t.height).toBeGreaterThanOrEqual(44);
    await trigger.click();
    const item = page.getByRole("menuitem", { name: "Sign out" });
    await expect(item).toBeVisible();
    const box = (await item.boundingBox())!;
    expect(box.width).toBeGreaterThanOrEqual(44);
    expect(box.height).toBeGreaterThanOrEqual(44);
    expect(await contrast(item)).toBeGreaterThanOrEqual(4.5);
    await expect(page.getByRole("menu").getByText(LABEL[role === "subcontractor" ? "subcontractor" : role])).toBeVisible();
    await item.click();
    await page.waitForURL((u) => u.pathname.startsWith("/login") || u.pathname === "/", { timeout: 30_000 });
    await expect(page.getByTestId("debug-login")).toBeVisible({ timeout: 30_000 });
    await ctx.close();
  });
}

test("desktop: inline Sign out is ≥44×44, full contrast, and signs out", async ({ browser }) => {
  const { ctx, page } = await as(browser, "owner", DESKTOP);
  await expect(page.getByTestId("account-menu")).toBeHidden();
  const button = page.getByRole("button", { name: "Sign out" });
  const box = (await button.boundingBox())!;
  expect(box.width).toBeGreaterThanOrEqual(44);
  expect(box.height).toBeGreaterThanOrEqual(44);
  expect(await contrast(button)).toBeGreaterThanOrEqual(4.5);
  await button.click();
  await expect(page.getByTestId("debug-login")).toBeVisible({ timeout: 30_000 });
  await ctx.close();
});
