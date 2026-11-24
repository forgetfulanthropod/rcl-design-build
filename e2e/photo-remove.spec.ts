import { expect, test, type Browser, type Page } from "@playwright/test";

// Trash on a logging photo. A photo still uploading or failed is only in the pending list.
// A photo already stored on the report or the activity log stays for 5 seconds, then leaves
// the entry and storage. Undo in that window puts it back. No confirm dialog.
const PHONE = { width: 390, height: 844 };
const DESKTOP = { width: 1280, height: 860 };
const LABEL: Record<string, string> = {
  owner: "Owner",
  admin: "Admin",
  lead: "Lead",
  labor: "Labor",
  subcontractor: "Subcontractor",
};

async function as(browser: Browser, role: string, viewport = PHONE) {
  const phone = viewport === PHONE;
  const ctx = await browser.newContext({ viewport, isMobile: phone, hasTouch: phone });
  const page = await ctx.newPage();
  await page.goto("/login");
  await page.getByTestId("debug-login").getByRole("button", { name: LABEL[role], exact: true }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login") && !url.pathname.startsWith("/m/"), { timeout: 30_000 });
  await expect(page.getByRole("button", { name: /^(Sign out|Account: )/ }).locator("visible=true").first()).toBeVisible({ timeout: 30_000 });
  return { ctx, page };
}

async function call(page: Page, fn: string, data?: unknown): Promise<{ ok: boolean; value?: unknown; error?: string }> {
  return page.evaluate(
    async ([name, payload]) => {
      const fns = (await import("/src/lib/server/fns.ts")) as unknown as Record<string, (a: { data: unknown }) => Promise<unknown>>;
      try {
        return { ok: true, value: await fns[name as string]({ data: payload }) };
      } catch (error) {
        return { ok: false, error: (error as Error).message };
      }
    },
    [fn, data] as const,
  );
}

const savedPhotos = (page: Page) => page.getByTestId("entries").locator('[data-testid="entry"][data-kind="photo"]:not([data-pending])');

test("pending photo drops immediately; a saved photo undoes for 5 seconds", async ({ browser }) => {
  test.setTimeout(120_000);
  const { ctx, page } = await as(browser, "labor");
  await expect(page.getByTestId("today-report")).toBeVisible();
  await page.getByTestId("photo-input").setInputFiles({
    name: "notes.jpg",
    mimeType: "image/jpeg",
    buffer: Buffer.from("not a photo"),
  });
  const pending = page.getByTestId("entries").locator("[data-pending]");
  await expect(pending).toHaveCount(1, { timeout: 20_000 });
  await pending.getByRole("button", { name: "Remove photo" }).click();
  await expect(pending).toHaveCount(0);
  await expect(page.getByTestId("photo-undo")).toHaveCount(0);

  const before = await savedPhotos(page).count();
  await page.getByTestId("photo-input").setInputFiles("e2e/fixtures/site-photo.jpg");
  await expect(savedPhotos(page)).toHaveCount(before + 1, { timeout: 30_000 });
  const entry = savedPhotos(page).last();
  const photoId = await entry.locator("[data-photo-id]").getAttribute("data-photo-id");
  expect(photoId).toBeTruthy();

  await entry.getByRole("button", { name: "Remove photo" }).click();
  await expect(page.getByTestId("photo-undo")).toContainText("Photo removed");
  await expect(savedPhotos(page)).toHaveCount(before);
  await page.getByTestId("photo-undo").getByRole("button", { name: "Undo" }).click();
  await expect(page.getByTestId("photo-undo")).toHaveCount(0);
  await expect(savedPhotos(page)).toHaveCount(before + 1);

  for (const role of ["owner", "admin", "lead", "subcontractor"]) {
    const other = await as(browser, role, role === "owner" || role === "admin" ? DESKTOP : PHONE);
    const denied = await call(other.page, "removeMyPhoto", { id: photoId });
    expect(denied.ok, role).toBe(false);
    expect(denied.error ?? "", role).toMatch(/own report/);
    if (role === "owner") {
      await expect(other.page.getByTestId("report-card").first()).toBeVisible({ timeout: 30_000 });
      await expect(other.page.getByRole("button", { name: "Remove photo" })).toHaveCount(0);
    }
    await other.ctx.close();
  }

  await page.clock.install();
  await savedPhotos(page).last().getByRole("button", { name: "Remove photo" }).click();
  await expect(page.getByTestId("photo-undo")).toBeVisible();
  await page.clock.fastForward(5_000);
  await expect(page.getByTestId("photo-undo")).toHaveCount(0);
  await expect(savedPhotos(page)).toHaveCount(before);
  await page.reload();
  await expect(page.getByTestId("today-report")).toBeVisible();
  await expect(savedPhotos(page)).toHaveCount(before);
  await ctx.close();
});

test("activity log photo trash undoes, then removes the saved photo", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: DESKTOP });
  const page = await ctx.newPage();
  await page.clock.install();
  await page.goto("/tracking?day=2026-11-02");
  const photos = page.getByTestId("photo-caption");
  await expect(photos).toHaveCount(2);
  await photos.first().getByRole("button", { name: "Remove photo" }).click();
  await expect(photos).toHaveCount(1);
  await expect(page.getByTestId("photo-undo")).toBeVisible();
  await page.getByTestId("photo-undo").getByRole("button", { name: "Undo" }).click();
  await expect(photos).toHaveCount(2);
  await photos.first().getByRole("button", { name: "Remove photo" }).click();
  await page.clock.fastForward(5_000);
  await expect(page.getByTestId("photo-undo")).toHaveCount(0);
  await expect(photos).toHaveCount(1);
  await page.reload();
  await expect(photos).toHaveCount(1);
  await ctx.close();
});
