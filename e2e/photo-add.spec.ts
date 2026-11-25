import { expect, test, type Browser, type Page } from "@playwright/test";

// Adding a photo to the browser-local activity log must finish even when a file
// fails, the browser store is full, or the file is an iPhone HEIC. The person
// using the log never sees a role permission error. A failed photo can be retried
// or removed, and the button returns to "Choose photos".
const LABEL: Record<string, string> = {
  owner: "Owner",
  admin: "Admin",
  lead: "Lead",
  labor: "Labor",
  subcontractor: "Subcontractor",
};

async function as(browser: Browser, role: string) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  await page.goto("/login");
  await page.getByTestId("debug-login").getByRole("button", { name: LABEL[role], exact: true }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login") && !url.pathname.startsWith("/m/"), { timeout: 30_000 });
  await expect(page.getByRole("button", { name: /^(Sign out|Account: )/ }).locator("visible=true").first()).toBeVisible({ timeout: 30_000 });
  return { ctx, page };
}

async function openLog(page: Page) {
  await page.goto("/tracking");
  await expect(page.getByRole("heading", { name: "Activity log" })).toBeVisible();
  await expect(page.getByText("Everything stays in this browser.")).toBeVisible();
  // The sample captions arrive after hydration. Setting a file before that misses the handler.
  await expect(page.getByTestId("photo-caption").first()).toBeVisible();
}

const choose = (page: Page) => page.getByRole("button", { name: "Choose photos" });

test("a failed photo and a full browser never leave Adding photos stuck", async ({ page }) => {
  await page.addInitScript(() => {
    const original = localStorage.setItem.bind(localStorage);
    localStorage.setItem = (key: string, value: string) => {
      if (key === "rcl-tracking-log" && value.includes("data:image/jpeg")) {
        const error = new DOMException("The quota has been exceeded.", "QuotaExceededError");
        (window as unknown as { __quota?: string }).__quota = "threw";
        throw error;
      }
      original(key, value);
    };
  });
  await openLog(page);
  await page.getByTestId("photo-input").setInputFiles("e2e/fixtures/site-photo.jpg");
  const failed = page.getByTestId("photo-add-failed");
  await expect(failed).toBeVisible({ timeout: 20_000 });
  await expect(failed).toContainText("browser is full");
  await expect(failed).not.toContainText(/role can't|own report|permission/i);
  await expect(choose(page)).toBeEnabled();
  await expect(choose(page)).toHaveText("Choose photos");
  await failed.getByRole("button", { name: "Retry" }).click();
  await expect(failed).toContainText("browser is full");
  await expect(choose(page)).toBeEnabled({ timeout: 20_000 });
  await failed.getByRole("button", { name: "Remove" }).click();
  await expect(failed).toHaveCount(0);
});

test("a HEIC that cannot be read shows its own error and can be removed", async ({ page }) => {
  await openLog(page);
  await page.getByTestId("photo-input").setInputFiles({
    name: "notes.heic",
    mimeType: "image/heic",
    buffer: Buffer.from("not a heic photo"),
  });
  await expect(choose(page)).toBeEnabled({ timeout: 30_000 });
  const failed = page.getByTestId("photo-add-failed");
  await expect(failed).toContainText(/iPhone|HEIC|isn't a photo|too long/i);
  await expect(failed).not.toContainText(/role can't|permission/i);
  await failed.getByRole("button", { name: "Remove" }).click();
  await expect(failed).toHaveCount(0);
  await expect(choose(page)).toHaveText("Choose photos");
});

test("the person using the log can add a photo in every role", async ({ browser }) => {
  test.setTimeout(120_000);
  for (const role of ["owner", "admin", "lead", "labor", "subcontractor"] as const) {
    const { ctx, page } = await as(browser, role);
    await openLog(page);
    await expect(page.getByTestId("photo-caption").first()).toBeVisible();
    const before = await page.getByTestId("photo-caption").count();
    await page.getByTestId("photo-input").setInputFiles("e2e/fixtures/site-photo.jpg");
    await expect(choose(page)).toBeEnabled({ timeout: 30_000 });
    await expect(page.getByText(/role can't|own report|doc\.send/)).toHaveCount(0);
    await expect(page.getByTestId("photo-add-failed")).toHaveCount(0);
    await expect(page.getByTestId("photo-caption")).toHaveCount(before + 1);
    await ctx.close();
  }
});
