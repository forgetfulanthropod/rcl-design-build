import { expect, test } from "@playwright/test";
import { mkdirSync } from "node:fs";

// Debug login is ON by default. To test the off switch, run against a server started with
// DEBUG_LOGIN=false and set DEBUG_LOGIN=false for this process too.
const ON = process.env.DEBUG_LOGIN !== "false";
const OUT = process.env.ROLE_SHOT_DIR ?? "test-results/roles";
const ROLES: [string, string][] = [
  ["owner", "Olivia Grant"],
  ["admin", "Adam Price"],
  ["lead", "Lena Ortiz"],
  ["labor", "Luis Moreno"],
  ["subcontractor", "Sam Whitfield"],
];
const LABEL: Record<string, string> = { owner: "Owner", admin: "Admin", lead: "Lead", labor: "Labor", subcontractor: "Subcontractor" };

test("root shows the login screen when signed out (no marketing page)", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("button", { name: /Email me a link/ })).toBeVisible();
  await expect(page.getByText("Building smart.", { exact: true })).toHaveCount(0);
});

test("debug sign-in is hidden and refused when DEBUG_LOGIN=false", async ({ page }) => {
  test.skip(ON, "flag is on for this run");
  await page.goto("/login");
  await expect(page.getByRole("button", { name: /Email me a link/ })).toBeVisible();
  await expect(page.getByTestId("debug-login")).toHaveCount(0);
  const refused = await page.evaluate(async () => {
    const mod = await import("/src/lib/server/fns.ts");
    try {
      await mod.debugSignIn({ data: { role: "admin" } });
      return false;
    } catch {
      return true;
    }
  });
  expect(refused).toBe(true);
});

for (const [role, name] of ROLES) {
  test(`debug sign-in as ${role}`, async ({ browser }) => {
    test.skip(!ON, "DEBUG_LOGIN is off");
    mkdirSync(OUT, { recursive: true });
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    const page = await ctx.newPage();
    await page.goto("/");
    await page.getByTestId("debug-login").getByRole("button", { name: LABEL[role], exact: true }).click();
    await page.waitForURL((u) => u.pathname === "/", { timeout: 30_000 });
    // Phones show a 44px account button with the signed-in name; Sign out lives in its menu (F8).
    await expect(page.getByRole("button", { name: `Account: ${name}` })).toBeVisible({ timeout: 30_000 });
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${OUT}/390x844-${role}.png`, fullPage: true });
    await ctx.close();
  });
}

async function signInAs(browser: import("@playwright/test").Browser, role: string) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto("/login");
  await page.getByTestId("debug-login").getByRole("button", { name: LABEL[role], exact: true }).click();
  await page.waitForURL((u) => u.pathname === "/", { timeout: 30_000 });
  // Phones show an account menu (Sign out inside); md+ shows Sign out inline (F8).
  await expect(page.getByRole("button", { name: /^(Sign out|Account: )/ }).locator("visible=true").first()).toBeVisible({ timeout: 30_000 });
  return { ctx, page };
}

test("demo edits are saved, reset re-seeds, and the demo is isolated from real companies", async ({ browser }) => {
  test.skip(!ON, "DEBUG_LOGIN is off");
  const note = `Demo edit ${Date.now().toString(36)}`;
  const { ctx, page } = await signInAs(browser, "labor");
  await page.locator("#narrative").fill(note);
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("button", { name: "Saved", exact: true })).toBeVisible();
  await page.reload();
  await expect(page.locator("#narrative")).toHaveValue(note); // persisted

  const anon = await browser.newContext();
  const lp = await anon.newPage();
  await lp.goto("/login");
  lp.once("dialog", (d) => void d.accept());
  await lp.getByRole("button", { name: "Reset demo data" }).click();
  await expect(lp.getByText("Demo data reset.")).toBeVisible({ timeout: 30_000 });
  await anon.close();
  await ctx.close();

  const again = await signInAs(browser, "labor");
  await expect(again.page.locator("#narrative")).toHaveValue("");
  await again.page.getByRole("button", { name: "My reports", exact: true }).locator("visible=true").first().click();
  await expect(again.page.getByTestId("report-card").first()).toBeVisible();
  await again.ctx.close();
});

test("a real company never sees demo data", async ({ browser }) => {
  test.skip(!ON, "DEBUG_LOGIN is off");
  const { newAdmin, openView } = await import("./helpers");
  const { page, context } = await newAdmin(browser);
  await page.getByRole("button", { name: "7 days" }).click();
  await expect(page.getByText(/No reports for this filter/)).toBeVisible();
  await expect(page.getByText("Whitaker")).toHaveCount(0);
  await openView(page, "Team");
  await expect(page.getByText("Luis Moreno")).toHaveCount(0);
  await context.close();
});
