import { expect, test, type Browser, type Page } from "@playwright/test";

// Spec 06 rev 3 · sharing settings and the per-job sharing review, per role, in the UI and on
// the server. The demo has 4 jobs; after "Reset demo data" every one of them is flagged.
const LABEL: Record<string, string> = { owner: "Owner", admin: "Admin", lead: "Lead", labor: "Labor", subcontractor: "Subcontractor" };
const DESKTOP = { width: 1280, height: 860 };
const DEMO_JOBS = ["Lexington kitchen", "Whitaker kitchen remodel", "Oak Street duplex addition", "Chevy Chase dental fit-up"];

async function as(browser: Browser, role: string) {
  const ctx = await browser.newContext({ viewport: DESKTOP });
  const page = await ctx.newPage();
  await page.goto("/login");
  await page.getByTestId("debug-login").getByRole("button", { name: LABEL[role], exact: true }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login") && !u.pathname.startsWith("/m/"), { timeout: 30_000 });
  await expect(page.getByRole("button", { name: "Sign out" }).first()).toBeVisible({ timeout: 30_000 });
  return { ctx, page };
}
const nav = (page: Page, label: string) => page.getByRole("button", { name: label, exact: true }).locator("visible=true").first();
const settings = (page: Page) => page.getByRole("button", { name: /^Settings/ });

/** Call a server function from the signed-in page; returns { ok, value } or { ok: false, error }. */
async function call(page: Page, fn: string, data?: unknown): Promise<{ ok: boolean; value?: unknown; error?: string }> {
  return page.evaluate(
    async ([name, payload]) => {
      const fns = (await import("/src/lib/server/fns.ts")) as unknown as Record<string, (a: { data: unknown }) => Promise<unknown>>;
      try {
        return { ok: true, value: await fns[name as string]({ data: payload }) };
      } catch (e) {
        return { ok: false, error: (e as Error).message };
      }
    },
    [fn, data] as const,
  );
}

test.describe.configure({ mode: "serial" });

test.beforeAll(async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto("/login");
  page.once("dialog", (d) => void d.accept());
  await page.getByRole("button", { name: "Reset demo data" }).click();
  await expect(page.getByText("Demo data reset.")).toBeVisible({ timeout: 30_000 });
  await ctx.close();
});

for (const role of ["owner", "admin"] as const) {
  test(`${role}: every demo job is flagged — Settings badge 4, Attention section, a per-row Review and no bulk action`, async ({ browser }) => {
    const { ctx, page } = await as(browser, role);
    await expect(page.getByTestId("settings-badge")).toHaveText("4");
    await nav(page, "Attention").click();
    const pinned = page.getByTestId("sharing-review-section");
    await expect(pinned.getByRole("heading", { name: "Sharing review needed (4)" })).toBeVisible();
    for (const job of DEMO_JOBS) await expect(pinned.getByRole("button", { name: `Review ${job}` })).toBeVisible();
    await settings(page).click();
    await page.getByRole("tab", { name: "Projects" }).click();
    const queue = page.getByTestId("review-queue");
    await expect(queue.getByTestId("queue-row")).toHaveCount(4);
    await expect(queue.getByText("Using company defaults").first()).toBeVisible();
    await expect(page.getByTestId("sharing-settings").getByRole("checkbox")).toHaveCount(0);
    await expect(page.getByRole("button", { name: /all|selected|bulk/i })).toHaveCount(0);
    // the company defaults are both Off on a fresh demo
    await page.getByRole("tab", { name: "Company defaults" }).click();
    await expect(page.getByRole("switch", { name: "Leads see dollars" })).toHaveAttribute("aria-checked", "false");
    await expect(page.getByRole("switch", { name: "Labor can send documents" })).toHaveAttribute("aria-checked", "false");
    await ctx.close();
  });
}

for (const role of ["lead", "labor", "subcontractor"] as const) {
  test(`${role}: no Settings entry, no Attention section, and every sharing function is refused`, async ({ browser }) => {
    const { ctx, page } = await as(browser, role);
    await expect(settings(page)).toHaveCount(0);
    await expect(page.getByTestId("settings-badge")).toHaveCount(0);
    const jobs = (await call(page, "listDocuments")).value as { jobs: { id: string }[] };
    const projectId = jobs.jobs[0].id;
    for (const [fn, data, action] of [
      ["getSharingOverview", undefined, "settings.sharing.view"],
      ["listSharingAudit", {}, "settings.sharing.view"],
      ["listSharingReviewQueue", undefined, "settings.sharing.view"],
      ["setCompanySharing", { key: "labor_doc_send", value: true }, "settings.sharing.edit"],
      ["setProjectSharing", { projectId, key: "labor_doc_send", value: true }, "settings.sharing.edit"],
      ["getReviewPreview", { projectId }, "project.sharingReview"],
      ["markProjectReviewed", { projectId }, "project.sharingReview"],
      ["requestSharingReview", { projectId }, "project.sharingReview"],
    ] as const) {
      const result = await call(page, fn, data);
      expect(result.ok, fn).toBe(false);
      expect(result.error, fn).toContain(action);
    }
    expect((await call(page, "getSharingReviewCount")).value).toBe(0);
    await ctx.close();
  });
}

test("owner: an override waits for review; Mark reviewed shows the job's settings, clears only that job, and logs a snapshot", async ({ browser }) => {
  const { ctx, page } = await as(browser, "owner");
  await settings(page).click();
  await page.getByRole("tab", { name: "Projects" }).click();
  await page.getByTestId("review-queue").getByRole("button", { name: "Review Whitaker kitchen remodel" }).click();
  const job = page.getByTestId("sharing-project");
  await expect(job.getByTestId("review-banner")).toContainText("Sharing review needed. This job is using company defaults until you mark it reviewed.");
  const send = job.getByTestId("project-labor_doc_send");
  await send.getByRole("radio", { name: "On" }).click();
  await expect(send.getByRole("radio", { name: "On" })).toHaveAttribute("aria-checked", "true");
  await expect(send).toContainText("Now: Off · company · Applies after review");

  await job.getByRole("button", { name: "Mark reviewed" }).click();
  const dialog = page.getByRole("dialog", { name: "Mark Whitaker kitchen remodel reviewed?" });
  await expect(dialog.getByTestId("snapshot")).toContainText("Labor can send documents: On (this job)");
  await expect(dialog.getByTestId("snapshot")).toContainText("Leads see dollars: Off (company default)");
  await expect(dialog).toContainText("This is recorded in the change log.");
  await dialog.getByRole("button", { name: "Mark reviewed" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(job.getByTestId("reviewed-line")).toContainText(/Reviewed by Olivia Grant · /);
  await expect(send).toContainText("Now: On · this job");
  await expect(page.getByTestId("settings-badge")).toHaveText("3");

  await page.getByRole("tab", { name: "Projects" }).click();
  await expect(page.getByTestId("review-queue").getByTestId("queue-row")).toHaveCount(3);
  await expect(page.getByTestId("review-queue").getByText("Whitaker kitchen remodel")).toHaveCount(0);

  await page.getByRole("tab", { name: "Change log" }).click();
  const review = page.getByTestId("audit-row").filter({ hasText: "Sharing review: Review needed → Reviewed" });
  await expect(review).toHaveCount(1);
  await expect(review).toContainText("Olivia Grant (owner) · Whitaker kitchen remodel");
  await review.getByText("Settings at review").click();
  await expect(review.getByTestId("snapshot")).toContainText("Labor can send documents: On (this job)");
  await expect(page.getByTestId("audit-row").filter({ hasText: "Labor can send documents: Company default → On" })).toHaveCount(1);

  // a repeat on the server is idempotent and writes nothing
  const before = ((await call(page, "listSharingAudit", {})).value as unknown[]).length;
  const whitaker = ((await call(page, "getSharingOverview")).value as { projects: { id: string; name: string }[] }).projects.find((p) => p.name === "Whitaker kitchen remodel")!;
  const again = (await call(page, "markProjectReviewed", { projectId: whitaker.id })).value as { alreadyReviewed: boolean };
  expect(again.alreadyReviewed).toBe(true);
  expect(((await call(page, "listSharingAudit", {})).value as unknown[]).length).toBe(before);
  // another company's id (or a made-up one) is Not found
  expect((await call(page, "markProjectReviewed", { projectId: "not-a-real-job" })).error).toBe("Not found");
  await ctx.close();
});

test("admin: changing a company default names its effect, saves with a note, and lands in the change log", async ({ browser }) => {
  const { ctx, page } = await as(browser, "admin");
  await settings(page).click();
  await page.getByRole("switch", { name: "Leads see dollars" }).click();
  const dialog = page.getByRole("dialog", { name: "Turn Leads see dollars on?" });
  await expect(dialog.getByTestId("impact")).toHaveText("Leads on 4 jobs will start seeing dollars.");
  await dialog.getByLabel("Note (optional)").fill("Trial with Lena");
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(page.getByTestId("sharing-status")).toHaveText("Leads see dollars is On for the company.");
  await expect(page.getByRole("switch", { name: "Leads see dollars" })).toHaveAttribute("aria-checked", "true");
  await page.getByRole("tab", { name: "Change log" }).click();
  const row = page.getByTestId("audit-row").filter({ hasText: "Leads see dollars: Off → On" });
  await expect(row).toContainText("Adam Price (admin) · Company");
  await expect(row).toContainText("Trial with Lena");
  // Cancel writes nothing; switch it back off for the next specs.
  await page.getByRole("tab", { name: "Company defaults" }).click();
  await page.getByRole("switch", { name: "Leads see dollars" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByRole("switch", { name: "Leads see dollars" })).toHaveAttribute("aria-checked", "true");
  await page.getByRole("switch", { name: "Leads see dollars" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("switch", { name: "Leads see dollars" })).toHaveAttribute("aria-checked", "false");
  await ctx.close();
});
