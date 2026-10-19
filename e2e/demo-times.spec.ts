import { expect, test } from "@playwright/test";

// Regression: right after "Reset demo data", today's seeded reports showed submit times later
// than the current time (e.g. "Submitted 3:20 PM" at 9 AM). Every seeded time must be <= now.
// Checked through the server as each principal (owner, admin) and through each field role's own
// report list, so no role sees a future time.
const LABEL: Record<string, string> = { owner: "Owner", admin: "Admin", lead: "Lead", labor: "Labor", subcontractor: "Subcontractor" };

test.beforeAll(async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto("/login");
  page.once("dialog", (d) => void d.accept());
  await page.getByRole("button", { name: "Reset demo data" }).click();
  await expect(page.getByText("Demo data reset.")).toBeVisible({ timeout: 30_000 });
  await ctx.close();
});

async function signIn(browser: import("@playwright/test").Browser, role: string) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto("/login");
  await page.getByTestId("debug-login").getByRole("button", { name: LABEL[role], exact: true }).click();
  await expect(page.locator("header").first()).toBeVisible({ timeout: 30_000 });
  return { ctx, page };
}

type Times = { day: string; firstEditAt: string | null; lastEditAt: string | null; submittedAt: string | null; photos: { takenAt: string | null; createdAt: string }[] };
const stamps = (r: Times) => [r.firstEditAt, r.lastEditAt, r.submittedAt, ...r.photos.flatMap((p) => [p.takenAt, p.createdAt])].filter((v): v is string => !!v);

for (const role of ["owner", "admin"] as const) {
  test(`demo seed (${role}): no report or photo time in the last week is after now`, async ({ browser }) => {
    const { ctx, page } = await signIn(browser, role);
    const { reports, now } = await page.evaluate(async () => {
      const fns = await import("/src/lib/server/fns.ts");
      const to = new Date();
      const from = new Date(to.getTime() - 7 * 86_400_000);
      const res = await fns.reviewReports({ data: { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10), projectId: "", personId: "" } });
      return { reports: (res as { reports: Times[] }).reports, now: Date.now() };
    });
    expect(reports.length).toBeGreaterThan(5);
    const late = reports.flatMap((r) => stamps(r).filter((s) => new Date(s).getTime() > now + 5_000).map((s) => `${r.day} ${s}`));
    expect(late).toEqual([]);
    await ctx.close();
  });
}

for (const role of ["lead", "labor", "subcontractor"] as const) {
  test(`demo seed (${role}): my own reports show no future times`, async ({ browser }) => {
    const { ctx, page } = await signIn(browser, role);
    const { reports, now } = await page.evaluate(async () => {
      const fns = await import("/src/lib/server/fns.ts");
      const res = await fns.listMyReports();
      return { reports: (Array.isArray(res) ? res : (res as { reports: Times[] }).reports) as Times[], now: Date.now() };
    });
    const late = reports.flatMap((r) => stamps(r).filter((s) => new Date(s).getTime() > now + 5_000).map((s) => `${r.day} ${s}`));
    expect(late).toEqual([]);
    await ctx.close();
  });
}
