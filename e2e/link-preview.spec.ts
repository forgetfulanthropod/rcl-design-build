import { expect, test } from "@playwright/test";

// Run against a dev server started WITHOUT DEV_LINK_PREVIEW (and no mail/SMS keys):
//   DEV_LINK_PREVIEW=false npx playwright test e2e/link-preview.spec.ts
const OFF = process.env.DEV_LINK_PREVIEW === "false";

test("no on-screen magic link unless DEV_LINK_PREVIEW=true", async ({ page }) => {
  test.skip(!OFF, "run with DEV_LINK_PREVIEW=false");
  await page.goto("/login");
  await page.getByRole("button", { name: "Email", exact: true }).click();
  await page.locator("#dest").fill("someone@example.test");
  await page.getByRole("button", { name: /Email me a link/ }).click();
  await expect(page.getByText(/isn't set up on this desk/)).toBeVisible();
  await expect(page.getByRole("link", { name: "Open the magic link" })).toHaveCount(0);
  await expect(page.locator('a[href^="/m/"]')).toHaveCount(0);

  await page.getByRole("button", { name: "Text", exact: true }).click();
  await page.locator("#dest").fill("8595550140");
  await page.getByRole("button", { name: /Text me a link/ }).click();
  await expect(page.getByText(/Text sign-in isn't set up/)).toBeVisible();
  await expect(page.locator('a[href^="/m/"]')).toHaveCount(0);
});
