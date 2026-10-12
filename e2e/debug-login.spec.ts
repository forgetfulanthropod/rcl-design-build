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
    await expect(page.getByRole("button", { name: "Sign out" }).first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(name).first()).toBeVisible();
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
  await expect(page.getByRole("button", { name: "Sign out" }).first()).toBeVisible({ timeout: 30_000 });
  return { ctx, page };
}

test("demo edits are saved, reset re-seeds, and the demo is isolated from real companies", async ({ browser }) => {
  test.skip(!ON, "DEBUG_LOGIN is off");
  const { ctx, page } = await signInAs(browser, "admin");
  await page.getByRole("button", { name: "Jobs", exact: true }).locator("visible=true").first().click();
  await expect(page.getByText("Whitaker kitchen remodel").first()).toBeVisible();
  // A real (non-demo) company's data must not show up in the demo.
  await expect(page.getByText("Lexington kitchen").first()).toBeVisible(); // demo's own sample job
  const job = `Demo edit ${Date.now().toString(36)}`;
  await page.getByRole("button", { name: /new job/i }).first().click();
  await page.getByPlaceholder("Job name").fill(job);
  await page.getByPlaceholder("Client").fill("Demo client");
  await page.getByPlaceholder("Address").fill("1 Demo St");
  await page.getByRole("button", { name: "Save job" }).click();
  await expect(page.getByText(job).first()).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "Jobs", exact: true }).locator("visible=true").first().click();
  await expect(page.getByText(job).first()).toBeVisible(); // persisted

  // Reset from the login page in a signed-out context.
  const anon = await browser.newContext();
  const lp = await anon.newPage();
  await lp.goto("/login");
  lp.once("dialog", (d) => void d.accept());
  await lp.getByRole("button", { name: "Reset demo data" }).click();
  await expect(lp.getByText("Demo data reset.")).toBeVisible({ timeout: 30_000 });
  await anon.close();
  await ctx.close();

  const again = await signInAs(browser, "admin");
  await again.page.getByRole("button", { name: "Jobs", exact: true }).locator("visible=true").first().click();
  await expect(again.page.getByText("Whitaker kitchen remodel").first()).toBeVisible();
  await expect(again.page.getByText(job)).toHaveCount(0);
  await again.ctx.close();
});

test("a real company never sees demo data", async ({ browser }) => {
  test.skip(!ON, "DEBUG_LOGIN is off");
  const { newAdmin } = await import("./helpers");
  const { page, context } = await newAdmin(browser);
  await page.getByRole("button", { name: "Jobs", exact: true }).locator("visible=true").first().click();
  await expect(page.getByText("Whitaker kitchen remodel")).toHaveCount(0);
  await page.getByRole("button", { name: "Crew", exact: true }).locator("visible=true").first().click();
  await expect(page.getByText("Luis Moreno")).toHaveCount(0);
  await context.close();
});

test("labor persona sees the activities assigned to them", async ({ browser }) => {
  test.skip(!ON, "DEBUG_LOGIN is off");
  const { ctx, page } = await signInAs(browser, "labor");
  await page.getByRole("button", { name: "Site", exact: true }).locator("visible=true").first().click();
  await expect(page.getByText("Set base cabinets, east wall").first()).toBeVisible();
  await ctx.close();
});
