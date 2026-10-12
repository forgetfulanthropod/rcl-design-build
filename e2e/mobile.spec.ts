import { expect, test, type Page } from "@playwright/test";
import { inviteByEmail, newAdmin, openView } from "./helpers";
import { mkdirSync, writeFileSync } from "node:fs";

// Mobile audit of the employee (field role) views. Screenshots go to $MOBILE_SHOT_DIR
// (default test-results/mobile). Hard assertions: no horizontal page overflow, nav reachable.
const OUT = process.env.MOBILE_SHOT_DIR ?? "test-results/mobile";
const VIEWPORTS = [
  { width: 375, height: 812 },
  { width: 414, height: 896 },
];

async function audit(page: Page) {
  return page.evaluate(() => {
    const doc = document.documentElement;
    const small: string[] = [];
    for (const el of Array.from(document.querySelectorAll("button, a, input, select, textarea, [role=button]"))) {
      const r = (el as HTMLElement).getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (r.height < 44 || r.width < 44) {
        const label = ((el as HTMLElement).textContent || (el as HTMLInputElement).placeholder || el.getAttribute("aria-label") || el.tagName).trim().slice(0, 40);
        small.push(`${el.tagName.toLowerCase()} "${label}" ${Math.round(r.width)}x${Math.round(r.height)}`);
      }
    }
    const tinyText = new Set<string>();
    for (const el of Array.from(document.querySelectorAll("body *"))) {
      const h = el as HTMLElement;
      if (!h.childNodes.length || ![...h.childNodes].some((n) => n.nodeType === 3 && n.textContent!.trim())) continue;
      const fs = parseFloat(getComputedStyle(h).fontSize);
      if (fs < 13 && h.getBoundingClientRect().width > 0) tinyText.add(`${fs}px "${(h.textContent ?? "").trim().slice(0, 30)}"`);
    }
    const inputsUnder16 = Array.from(document.querySelectorAll("input, select, textarea"))
      .filter((el) => (el as HTMLElement).getBoundingClientRect().width > 0 && parseFloat(getComputedStyle(el).fontSize) < 16).length;
    return {
      overflowX: doc.scrollWidth - doc.clientWidth,
      smallTargets: small,
      tinyText: [...tinyText].slice(0, 15),
      inputsUnder16px: inputsUnder16,
    };
  });
}

for (const vp of VIEWPORTS) {
  test(`employee mobile views ${vp.width}x${vp.height}`, async ({ browser }) => {
    mkdirSync(OUT, { recursive: true });
    const tag = `${vp.width}x${vp.height}`;
    const report: Record<string, unknown> = {};
    const { page, context, id } = await newAdmin(browser);
    const link = await inviteByEmail(page, `Tech ${id}`, `tech-${id}@example.test`);

    const emp = await browser.newContext({ viewport: vp, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    const ep = await emp.newPage();
    await ep.goto("/login");
    await ep.screenshot({ path: `${OUT}/${tag}-01-login.png`, fullPage: true });
    report.login = await audit(ep);

    // Loading state: delay the first desk load so the placeholder is captured.
    await ep.route("**/_serverFn/**", async (route) => {
      await new Promise((r) => setTimeout(r, 1500));
      await route.continue().catch(() => undefined);
    });
    await ep.goto(link);
    await ep.waitForURL((u) => !u.pathname.startsWith("/m/"), { timeout: 30_000 });
    await ep.waitForTimeout(300);
    await ep.screenshot({ path: `${OUT}/${tag}-02-loading.png` });
    await ep.unrouteAll({ behavior: "ignoreErrors" });
    await expect(ep.getByRole("button", { name: "Site" }).first()).toBeVisible();

    await ep.screenshot({ path: `${OUT}/${tag}-03-desk.png`, fullPage: true });
    report.desk = await audit(ep);

    await openView(ep, "Site");
    await ep.screenshot({ path: `${OUT}/${tag}-04-field-empty.png`, fullPage: true });
    report.fieldEmpty = await audit(ep);

    // Admin dispatches two work orders, one assigned to the employee.
    await page.reload();
    await openView(page, "Site");
    for (const t of [`Replace RTU belt on the north roof unit ${id}`, `No-heat call ${id}`]) {
      await page.getByPlaceholder("Customer").fill("Acme Property Management LLC");
      await page.getByPlaceholder("Site", { exact: true }).fill("1200 Long Industrial Parkway, Building C");
      await page.getByPlaceholder("Site task").fill(t);
      await page.getByRole("button", { name: "Add to the board" }).click();
      await expect(page.getByRole("button", { name: new RegExp(t) })).toBeVisible();
    }
    // Labor only sees calls assigned to them: assign both.
    for (const t of [`Replace RTU belt on the north roof unit ${id}`, `No-heat call ${id}`]) {
      await page.getByRole("button", { name: new RegExp(t) }).click();
      const editor = page.locator("form", { has: page.getByRole("heading", { name: new RegExp(t) }) });
      await editor.getByLabel("Assigned to").selectOption({ label: `Tech ${id}` });
      await editor.getByRole("button", { name: "Update call" }).click();
      await expect(editor.getByLabel("Assigned to")).toHaveValue(/.+/);
    }

    await ep.reload();
    await openView(ep, "Site");
    await ep.screenshot({ path: `${OUT}/${tag}-05-field-orders.png`, fullPage: true });
    report.fieldOrders = await audit(ep);
    await ep.getByRole("button", { name: /No-heat call/ }).click();
    await ep.screenshot({ path: `${OUT}/${tag}-06-field-order-open.png`, fullPage: true });
    report.fieldOrderOpen = await audit(ep);

    for (const [i, v] of (["Log"] as const).entries()) {
      await openView(ep, v);
      await ep.screenshot({ path: `${OUT}/${tag}-0${7 + i}-${v.toLowerCase()}.png`, fullPage: true });
      report[v.toLowerCase()] = await audit(ep);
    }

    writeFileSync(`${OUT}/${tag}-audit.json`, JSON.stringify(report, null, 2));
    for (const [view, r] of Object.entries(report)) {
      expect.soft((r as { overflowX: number }).overflowX, `horizontal overflow on ${view}`).toBeLessThanOrEqual(0);
    }
    await emp.close();
    await context.close();
  });
}
