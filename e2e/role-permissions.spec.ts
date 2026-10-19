import { expect, test, type Browser, type Page } from "@playwright/test";

// Spec 05 · F2, per role, in the UI and on the server:
//  F2a Owner/Admin add, edit and approve from Activities; Lead unchanged.
//  F2b Only lead and up record the daily JSA; Labor reads it; a direct saveJsa call is refused.
//  F2c Labor and Subs read Docs but can't create (no form; createDocument refused).
const LABEL: Record<string, string> = { owner: "Owner", admin: "Admin", lead: "Lead", labor: "Labor", subcontractor: "Subcontractor" };
const DESKTOP = { width: 1280, height: 860 };

async function as(browser: Browser, role: string) {
  const ctx = await browser.newContext({ viewport: DESKTOP });
  const page = await ctx.newPage();
  await page.goto("/login");
  await page.getByTestId("debug-login").getByRole("button", { name: LABEL[role], exact: true }).click();
  await page.waitForURL((u) => u.pathname === "/", { timeout: 30_000 });
  await expect(page.locator("header").first()).toBeVisible({ timeout: 30_000 });
  return { ctx, page };
}
const nav = (page: Page, label: string) => page.getByRole("button", { name: label, exact: true }).locator("visible=true").first();

/** Call a server function from the signed-in page; returns "ok" or the error message. */
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

for (const role of ["owner", "admin"] as const) {
  test(`F2a (${role}): add, edit and approve from the Activities overview`, async ({ browser }) => {
    const { ctx, page } = await as(browser, role);
    await nav(page, "Activities").click();
    const overview = page.getByTestId("activity-overview");
    await expect(overview).toBeVisible();
    await overview.getByRole("button", { name: "+ Add activity" }).click();
    const add = page.getByTestId("overview-add");
    const title = `Set temp rail on the stairs (${role})`;
    await add.locator("#ov-add-title").fill(title);
    await add.locator("#ov-add-detail").fill("Before the inspector walks it.");
    await add.locator("#ov-add-job").selectOption({ index: 1 });
    await add.getByRole("button", { name: "Add activity" }).click();
    const item = page.getByTestId("overview-activity").filter({ hasText: title });
    await expect(item).toBeVisible();

    await item.getByRole("button", { name: `Edit ${title}` }).click();
    const edited = `${title}, both sides`;
    const editForm = page.getByRole("form", { name: "Save" });
    await editForm.getByRole("textbox", { name: "Activity", exact: true }).fill(edited);
    await editForm.getByRole("button", { name: "Save", exact: true }).click();
    const after = page.getByTestId("overview-activity").filter({ hasText: edited });
    await expect(after).toBeVisible();

    await after.getByRole("button", { name: "Approve" }).click();
    await expect(after.getByText("Approved", { exact: true })).toBeVisible();
    await ctx.close();
  });
}

test("F2a (lead): Activities is unchanged — add form and approve on the day board", async ({ browser }) => {
  const { ctx, page } = await as(browser, "lead");
  await nav(page, "Activities").click();
  await expect(page.getByTestId("activities")).toBeVisible();
  await expect(page.locator("#act-title")).toBeVisible();
  await expect(page.getByTestId("activity-overview")).toHaveCount(0);
  await ctx.close();
});

test("F2b (labor): the JSA is read-only, and saveJsa is refused by the server", async ({ browser }) => {
  const { ctx, page } = await as(browser, "labor");
  await nav(page, "Safety").click();
  await expect(page.getByText("2. Daily job safety analysis")).toBeVisible();
  await expect(page.getByTestId("jsa-readonly")).toHaveText("Your lead records today's job safety analysis.");
  await expect(page.locator("#jsa-hazards")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Save analysis" })).toHaveCount(0);
  const refused = await call(page, "saveJsa", { day: today(), projectId: "", hazards: "Ladder", controls: "Three points" });
  expect(refused).toContain("jsa.write");
  await ctx.close();
});

test("F2b (subcontractor): no Safety tab, and saveJsa is refused", async ({ browser }) => {
  const { ctx, page } = await as(browser, "subcontractor");
  await expect(nav(page, "Safety")).toHaveCount(0);
  expect(await call(page, "saveJsa", { day: today(), projectId: "", hazards: "Ladder", controls: "Three points" })).not.toBe("ok");
  await ctx.close();
});

test("F2b (lead saves; owner saves and approves): the JSA still works for lead and up", async ({ browser }) => {
  const lead = await as(browser, "lead");
  await nav(lead.page, "Safety").click();
  await lead.page.locator("#jsa-job").selectOption({ index: 1 });
  await lead.page.locator("#jsa-hazards").fill("Open floor edge on the second floor.");
  await lead.page.locator("#jsa-controls").fill("Guardrail up before work starts.");
  await lead.page.getByRole("button", { name: "Save analysis" }).click();
  await expect(lead.page.getByTestId("jsa-card").filter({ hasText: "Open floor edge" })).toBeVisible();
  await lead.ctx.close();

  const owner = await as(browser, "owner");
  await nav(owner.page, "Safety").click();
  await owner.page.locator("#jsa-job").selectOption({ index: 1 });
  await owner.page.locator("#jsa-hazards").fill("Saw dust in the garage.");
  await owner.page.locator("#jsa-controls").fill("Masks and the shop vac.");
  await owner.page.getByRole("button", { name: "Save analysis" }).click();
  const card = owner.page.getByTestId("jsa-card").filter({ hasText: "Saw dust" });
  await expect(card).toBeVisible();
  await card.getByRole("button", { name: "Approve" }).click();
  await expect(card.getByText("Approved", { exact: true })).toBeVisible();
  await owner.ctx.close();
});

for (const role of ["labor", "subcontractor"] as const) {
  test(`F2c (${role}): Docs is read-only in every section, and createDocument is refused`, async ({ browser }) => {
    const { ctx, page } = await as(browser, role);
    await nav(page, "Docs").click();
    const tabs = page.getByRole("tablist", { name: "Document sections" }).getByRole("button");
    await expect(tabs.first()).toBeVisible();
    for (let i = 0; i < (await tabs.count()); i++) {
      await tabs.nth(i).click();
      await expect(page.locator("#doc-title")).toHaveCount(0);
    }
    const refused = await call(page, "createDocument", {
      kind: "rfi", projectId: "", title: "Which tile?", body: "", counterparty: "", counterpartyEmail: "", amount: null,
    });
    expect(refused).toContain("doc.create");
    await ctx.close();
  });
}

test("F2c (lead): can still open an RFI from Docs", async ({ browser }) => {
  const { ctx, page } = await as(browser, "lead");
  await nav(page, "Docs").click();
  await page.getByRole("tablist", { name: "Document sections" }).getByRole("button", { name: "Change management" }).click();
  await expect(page.locator("#doc-title")).toBeVisible();
  expect(await call(page, "createDocument", { kind: "rfi", projectId: "", title: "Which grout color?", body: "", counterparty: "", counterpartyEmail: "", amount: null })).toBe("ok");
  await ctx.close();
});
