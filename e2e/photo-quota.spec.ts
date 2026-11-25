import { expect, test } from "@playwright/test";
import { mkdirSync } from "node:fs";

// Charlie, Android Chrome: a full browser store used to leave "Adding photos…" up forever,
// and the quota failure showed up like a permission error. Each photo now fails on its own.
const PHONE = { width: 412, height: 915 };
const SHOTS = "/opt/cursor/artifacts/screenshots";

test("a full phone store clears Adding photos and offers retry and remove", async ({ browser }) => {
  const ctx = await browser.newContext({
    viewport: PHONE,
    isMobile: true,
    hasTouch: true,
    userAgent:
      "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36",
  });
  const page = await ctx.newPage();
  await page.addInitScript(() => {
    const open = indexedDB.open.bind(indexedDB);
    indexedDB.open = function (name: string, version?: number) {
      if (name !== "rcl-activity-log") return open(name, version);
      throw new DOMException("The quota has been exceeded.", "QuotaExceededError");
    };
    const setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key: string, value: string) {
      if (key === "rcl-tracking-log" && value.includes("data:image/jpeg")) {
        throw new DOMException(
          "Setting the value of 'rcl-tracking-log' exceeded the quota.",
          "QuotaExceededError",
        );
      }
      return setItem.call(this, key, value);
    };
  });
  await page.goto("/tracking");
  await expect(page.getByRole("heading", { name: "Activity log" })).toBeVisible();
  await expect(page.getByText("Everything stays in this browser.")).toBeVisible();
  // Wait until the client has the sample day. Setting the file before hydration drops the change event.
  await expect(page.getByTestId("photo-caption")).toHaveCount(2);
  const choose = page.getByRole("button", { name: "Choose photos" });
  await expect(choose).toBeEnabled();

  await page.getByTestId("photo-input").setInputFiles("e2e/fixtures/site-photo.jpg");
  const failed = page.getByTestId("photo-failed");
  await expect(failed).toBeVisible({ timeout: 20_000 });
  await expect(failed).toContainText("Phone storage full");
  await expect(choose).toBeEnabled();
  await expect(page.getByRole("button", { name: "Adding photos…" })).toHaveCount(0);
  await expect(failed.getByTestId("photo-retry")).toBeVisible();
  await expect(failed.getByTestId("photo-failed-remove")).toBeVisible();
  await expect(page.getByText(/permission/i)).toHaveCount(0);
  await expect(page.getByText(/can't do that/i)).toHaveCount(0);
  await expect(page.getByTestId("photo-caption").first().getByTestId("photo-remove")).toBeVisible();

  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: `${SHOTS}/activity-log-storage-full.png`, fullPage: true });

  await failed.getByTestId("photo-retry").click();
  await expect(failed).toContainText("Phone storage full");
  await expect(choose).toBeEnabled({ timeout: 20_000 });
  await expect(page.getByRole("button", { name: "Adding photos…" })).toHaveCount(0);

  await page.getByTestId("photo-failed-remove").click();
  await expect(page.getByTestId("photo-failed")).toHaveCount(0);
  await expect(choose).toBeEnabled();
  await ctx.close();
});

test("an iPhone HEIC photo is added on the activity log", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: PHONE, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  await page.goto("/tracking");
  await expect(page.getByTestId("photo-caption")).toHaveCount(2);
  await page.getByTestId("photo-input").setInputFiles("e2e/fixtures/site-photo.heic");
  await expect(page.getByTestId("photo-caption")).toHaveCount(3, { timeout: 30_000 });
  await expect(page.getByRole("button", { name: "Choose photos" })).toBeEnabled();
  await expect(page.getByTestId("photo-failed")).toHaveCount(0);
  const added = page.getByTestId("photo-caption").nth(2);
  await expect(added.locator("img")).toBeVisible();
  await expect(added.getByTestId("photo-remove")).toBeVisible();
  mkdirSync(SHOTS, { recursive: true });
  await added.screenshot({ path: `${SHOTS}/activity-log-heic.png` });
  await ctx.close();
});
