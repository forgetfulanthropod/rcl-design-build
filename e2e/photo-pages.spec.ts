import { expect, test } from "@playwright/test";

// Activity-log photos show four at a time. Notes stay on the page. Prev/Next stay
// in range, and deleting the only photo on the last page returns to the previous page
// after the 5-second undo commits.
const PHONE = { width: 390, height: 844 };
const DAY = "2026-11-03";

function logWithPhotos(count: number) {
  const photos = Array.from({ length: count }, (_, i) => ({
    id: `p${i + 1}`,
    ts: `${DAY}T1${i}:00:00.000Z`,
    kind: "photo",
    body: `Caption ${i + 1}`,
    dataUrl: `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><rect width="80" height="80" fill="#3d4a3a"/></svg>')}`,
    takenAt: `${DAY}T1${i}:00:00.000Z`,
    takenSource: "exif",
  }));
  return JSON.stringify({ [DAY]: photos });
}

test("activity log photos page four at a time, including the last-page delete", async ({ browser }) => {
  test.setTimeout(90_000);
  const ctx = await browser.newContext({ viewport: PHONE, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  await page.clock.install();
  await page.addInitScript((stored) => {
    if (!localStorage.getItem("rcl-tracking-log")) localStorage.setItem("rcl-tracking-log", stored as string);
  }, logWithPhotos(5));
  await page.goto(`/tracking?day=${DAY}`);
  await expect(page.getByRole("heading", { name: "Activity log" })).toBeVisible();

  const photos = page.getByTestId("photo-caption");
  const label = page.getByTestId("photo-page-label");
  const prev = page.getByTestId("photo-page-prev");
  const next = page.getByTestId("photo-page-next");
  await expect(label).toHaveText("Page 1 of 2");
  await expect(prev).toBeDisabled();
  await expect(next).toBeEnabled();
  const captions = page.getByRole("textbox", { name: "Caption" });
  await expect(photos).toHaveCount(4);
  await expect(captions).toHaveCount(4);
  await expect(captions.nth(0)).toHaveValue("Caption 1");
  await expect(captions.nth(3)).toHaveValue("Caption 4");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  expect(overflow).toBe(false);
  const prevBox = await prev.boundingBox();
  expect(prevBox?.height ?? 0).toBeGreaterThanOrEqual(44);

  await next.click();
  await expect(label).toHaveText("Page 2 of 2");
  await expect(next).toBeDisabled();
  await expect(prev).toBeEnabled();
  await expect(photos).toHaveCount(1);
  await expect(captions).toHaveValue("Caption 5");

  await prev.click();
  await expect(label).toHaveText("Page 1 of 2");
  await expect(captions.nth(0)).toHaveValue("Caption 1");
  await next.click();

  await photos.getByRole("button", { name: "Remove photo" }).click();
  await expect(page.getByTestId("photo-undo")).toBeVisible();
  await expect(photos).toHaveCount(0);
  await page.getByTestId("photo-undo").getByRole("button", { name: "Undo" }).click();
  await expect(photos).toHaveCount(1);
  await expect(captions).toHaveValue("Caption 5");

  await photos.getByRole("button", { name: "Remove photo" }).click();
  await page.clock.fastForward(5_000);
  await expect(page.getByTestId("photo-undo")).toHaveCount(0);
  await expect(label).toHaveText("Page 1 of 1");
  await expect(photos).toHaveCount(4);
  await expect(captions).toHaveCount(4);
  await expect(next).toBeDisabled();
  await expect(prev).toBeDisabled();
  await page.reload();
  await expect(label).toHaveText("Page 1 of 1");
  await expect(photos).toHaveCount(4);
  await ctx.close();
});
