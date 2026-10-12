import { expect, test } from "@playwright/test";
import { mkdirSync } from "node:fs";

// Run with a dev server started with DEBUG_LOGIN=true and set DEBUG_LOGIN=true for this process too.
// With the flag off, only the "refused" test runs.
const ON = process.env.DEBUG_LOGIN === "true";
const OUT = process.env.ROLE_SHOT_DIR ?? "test-results/roles";
const ROLES: [string, string][] = [
  ["owner", "Olivia Owner"],
  ["admin", "Adam Admin"],
  ["lead", "Lena Lead"],
  ["labor", "Luis Labor"],
  ["subcontractor", "Sam Subcontractor"],
];
const LABEL: Record<string, string> = { owner: "Owner", admin: "Admin", lead: "Lead", labor: "Labor", subcontractor: "Subcontractor" };

test("root shows the login screen when signed out (no marketing page)", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("button", { name: /Email me a link/ })).toBeVisible();
  await expect(page.getByText("Building smart.", { exact: true })).toHaveCount(0);
});

test("debug sign-in is hidden and refused when DEBUG_LOGIN is off", async ({ page }) => {
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
    await expect(page.getByRole("button", { name: "Crew" }).first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(name).first()).toBeVisible();
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${OUT}/390x844-${role}.png`, fullPage: true });
    await ctx.close();
  });
}
