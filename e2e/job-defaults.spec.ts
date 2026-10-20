import { expect, test, type Browser, type Page } from "@playwright/test";

// Spec 05 · F3: forms start on the user's current job instead of "No job". Job-only forms
// (activities, JSA, RFI/submittal/CO/invoice) require a job in the UI and on the server;
// "Company-wide (no job)" is offered only for policy/bid docs and owner/admin activities.
const LABEL: Record<string, string> = { owner: "Owner", admin: "Admin", lead: "Lead", labor: "Labor", subcontractor: "Subcontractor" };

async function as(browser: Browser, role: string) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  const page = await ctx.newPage();
  await page.goto("/login");
  await page.getByTestId("debug-login").getByRole("button", { name: LABEL[role], exact: true }).click();
  // F1: "/" redirects to the role's first view.
  await page.waitForURL((u) => u.pathname !== "/" && u.pathname !== "/login" && !u.pathname.startsWith("/m/"), { timeout: 30_000 });
  await expect(page.locator("header").first()).toBeVisible({ timeout: 30_000 });
  await page.evaluate(() => window.localStorage.removeItem("rcl.lastJob"));
  return { ctx, page };
}
const nav = (page: Page, label: string) => page.getByRole("button", { name: label, exact: true }).locator("visible=true").first();
const selected = (page: Page, id: string) => page.locator(`#${id} option:checked`);

async function call(page: Page, fn: string, data: unknown): Promise<string> {
  return page.evaluate(
    async ([name, payload]) => {
      const fns = (await import("/src/lib/server/fns.ts")) as unknown as Record<string, (a: { data: unknown }) => Promise<unknown>>;
      try {
        await fns[name as string]({ data: payload });
        return "ok";
      } catch (e) {
        return (e as Error).message;
      }
    },
    [fn, data] as const,
  );
}
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

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

test("labor (Luis, latest report on Whitaker): Activities starts on Whitaker; no job is refused", async ({ browser }) => {
  const { ctx, page } = await as(browser, "labor");
  await nav(page, "Activities").click();
  await expect(selected(page, "act-job")).toHaveText("Whitaker kitchen remodel");
  await expect(page.locator('label[for="act-job"]')).toContainText("(your job today)");
  await expect(page.locator("#act-job option", { hasText: "No job" })).toHaveCount(0);
  await expect(page.locator("#act-job option", { hasText: "Company-wide (no job)" })).toHaveCount(0);
  expect(await call(page, "createActivity", { day: today(), title: "Sweep", detail: "", projectId: "" })).toBe("Pick a job.");
  await ctx.close();
});

test("lead: JSA and RFI start on the lead's job; an RFI or JSA without a job is refused", async ({ browser }) => {
  const { ctx, page } = await as(browser, "lead");
  await nav(page, "Safety").click();
  await expect(selected(page, "jsa-job")).toHaveText("Whitaker kitchen remodel");
  expect(await call(page, "saveJsa", { day: today(), projectId: "", hazards: "Ladder", controls: "Footing" })).toBe("Pick a job.");
  await nav(page, "Docs").click();
  await page.getByRole("tablist", { name: "Document sections" }).getByRole("tab", { name: "Change management" }).click();
  await page.getByRole("button", { name: "+ New document" }).click();
  await expect(selected(page, "doc-job")).toHaveText("Whitaker kitchen remodel");
  await expect(page.locator("#doc-job option", { hasText: "Company-wide (no job)" })).toHaveCount(0);
  const rfi = { kind: "rfi", projectId: "", title: "Which grout?", body: "", counterparty: "", counterpartyEmail: "", amount: null };
  expect(await call(page, "createDocument", rfi)).toBe("Pick a job.");
  await ctx.close();
});

test("subcontractor (Sam, today's report on Oak Street): Today starts on Oak Street; Docs is read-only (F2c)", async ({ browser }) => {
  const { ctx, page } = await as(browser, "subcontractor");
  await expect(selected(page, "report-job")).toHaveText("Oak Street duplex addition");
  await nav(page, "Docs").click();
  await expect(page.getByRole("button", { name: "+ New document" })).toHaveCount(0);
  await expect(page.locator("#doc-job")).toHaveCount(0);
  await ctx.close();
});

for (const role of ["owner", "admin"] as const) {
  test(`${role}: a policy can still be company-wide; an RFI needs a job; office activities may be company-wide`, async ({ browser }) => {
    const { ctx, page } = await as(browser, role);
    await nav(page, "Docs").click();
    await page.getByRole("tablist", { name: "Document sections" }).getByRole("tab", { name: "Policy" }).click();
    await page.getByRole("button", { name: "+ New document" }).click();
    const options = page.locator("#doc-job option");
    await expect(options.last()).toHaveText("Company-wide (no job)");
    const policy = { kind: "policy", projectId: "", title: `Ladder policy (${role})`, body: "Three points of contact.", counterparty: "", counterpartyEmail: "", amount: null };
    expect(await call(page, "createDocument", policy)).toBe("ok");
    const rfi = { ...policy, kind: "rfi", title: "Which grout?" };
    expect(await call(page, "createDocument", rfi)).toBe("Pick a job.");
    expect(await call(page, "createActivity", { day: today(), title: `Order dumpsters (${role})`, detail: "", projectId: "" })).toBe("ok");
    await ctx.close();
  });
}

test("the last job picked in a form is remembered when there's no report to go on", async ({ browser }) => {
  const { ctx, page } = await as(browser, "owner");
  await nav(page, "Docs").click();
  await page.getByRole("tablist", { name: "Document sections" }).getByRole("tab", { name: "Change management" }).click();
  await page.getByRole("button", { name: "+ New document" }).click();
  await page.locator("#doc-job").selectOption({ label: "Chevy Chase dental fit-up" });
  await page.reload();
  await nav(page, "Docs").click();
  await page.getByRole("tablist", { name: "Document sections" }).getByRole("tab", { name: "Change management" }).click();
  await page.getByRole("button", { name: "+ New document" }).click();
  await expect(selected(page, "doc-job")).toHaveText("Chevy Chase dental fit-up");
  await ctx.close();
});
