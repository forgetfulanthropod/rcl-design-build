import { expect, test } from "@playwright/test";

// Regression for the flaky "labor writes today's report" Save click (CI #21, #14): closing the
// photo viewer returned focus to the thumbnail a tick later, even if the user had already moved
// to "Your day". That stolen blur fired the report autosave, so the Save button read "Saved".
// This drives the exact sequence in one tick, so it fails every time on the old behaviour.
const PHONE = { width: 390, height: 844 };

test.beforeAll(async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto("/login");
  page.once("dialog", (d) => void d.accept());
  await page.getByRole("button", { name: "Reset demo data" }).click();
  await expect(page.getByText("Demo data reset.")).toBeVisible({ timeout: 30_000 });
  await ctx.close();
});

test("closing the photo viewer doesn't steal focus from Your day (no surprise autosave)", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: PHONE, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  await page.goto("/login");
  await page.getByTestId("debug-login").getByRole("button", { name: "Labor", exact: true }).click();
  // F1: "/" redirects to the role's first view.
  await page.waitForURL((u) => u.pathname !== "/" && u.pathname !== "/login" && !u.pathname.startsWith("/m/"), { timeout: 30_000 });
  await page.getByTestId("photo-input").setInputFiles("e2e/fixtures/site-photo.jpg");
  await expect(page.getByText("1 photo saved.")).toBeVisible({ timeout: 20_000 });
  await page.locator("[data-photo-id]").first().click();
  await expect(page.getByTestId("photo-full")).toBeVisible();

  // Close and move to the text field in the same tick, then let every pending timer and frame run.
  const active = await page.evaluate(async () => {
    const close = [...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Close")!;
    close.click();
    document.getElementById("narrative")!.focus();
    for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    return document.activeElement?.id || document.activeElement?.tagName;
  });
  expect(active).toBe("narrative");
  await expect(page.getByTestId("photo-viewer")).toHaveCount(0);

  // Typing keeps the keyboard; manual Save is there and saves.
  await page.keyboard.type("Taped the hallway.");
  await expect(page.locator("#narrative")).toBeFocused();
  const save = page.getByRole("button", { name: "Save", exact: true });
  await expect(save).toBeEnabled();
  await save.click();
  await expect(page.getByRole("button", { name: "Saved", exact: true })).toBeDisabled();
  await page.reload();
  await expect(page.locator("#narrative")).toHaveValue("Taped the hallway.");
  await ctx.close();
});
