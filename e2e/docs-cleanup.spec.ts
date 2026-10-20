import { expect, test, type Browser, type Page } from "@playwright/test";

// Spec 05 · F4: one row of underline tabs (role=tab, counts inside), the form collapsed behind
// "+ New document", a single labelled Type select, visible labels on every field, and after
// create the new document opens with "RFI 00N created".
const LABEL: Record<string, string> = { owner: "Owner", admin: "Admin", lead: "Lead", labor: "Labor", subcontractor: "Subcontractor" };
const DESKTOP = { width: 1280, height: 860 };
const PHONE = { width: 390, height: 844 };

async function as(browser: Browser, role: string, viewport = DESKTOP) {
  const phone = viewport === PHONE;
  const ctx = await browser.newContext({ viewport, isMobile: phone, hasTouch: phone });
  const page = await ctx.newPage();
  await page.goto("/login");
  await page.getByTestId("debug-login").getByRole("button", { name: LABEL[role], exact: true }).click();
  await page.waitForURL((u) => u.pathname !== "/" && u.pathname !== "/login" && !u.pathname.startsWith("/m/"), { timeout: 30_000 }); // F1: "/" → first view
  await expect(page.locator("header").first()).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "Docs", exact: true }).locator("visible=true").first().click();
  await expect(page.getByTestId("documents")).toBeVisible();
  return { ctx, page };
}
const tabs = (page: Page) => page.getByRole("tablist", { name: "Document sections" }).getByRole("tab");
const tab = (page: Page, name: string) => page.getByRole("tab", { name: new RegExp(`^${name}`) });

/** Every input, select and textarea in the form has an accessible name. */
async function unlabeled(page: Page) {
  return page.getByTestId("new-document").evaluate((root) =>
    [...root.querySelectorAll("input, select, textarea")]
      .filter((el) => {
        const id = el.getAttribute("id");
        const label = id ? root.ownerDocument.querySelector(`label[for="${id}"]`)?.textContent?.trim() : "";
        return !label && !el.getAttribute("aria-label");
      })
      .map((el) => el.outerHTML.slice(0, 80)),
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
  test(`${role} desktop: tabs, collapsed form, one Type select, labels, and the new RFI opens`, async ({ browser }) => {
    const { ctx, page } = await as(browser, role);
    // One row of real tabs with counts inside; the counts sentence is gone.
    await expect(tabs(page).first()).toBeVisible();
    await expect(page.getByTestId("doc-counts")).toHaveCount(0);
    await expect(page.locator('[role=tab][aria-selected="true"]')).toHaveCount(1);
    await tab(page, "Change management").click();
    await expect(tab(page, "Change management")).toHaveAttribute("aria-selected", "true");
    await expect(tab(page, "Change management")).toHaveText(/Change management\s*\d+/);
    // No form until "+ New document".
    await expect(page.locator("#doc-title")).toHaveCount(0);
    await page.getByRole("button", { name: "+ New document" }).click();
    const form = page.getByTestId("new-document");
    await expect(form).toBeVisible();
    await expect(page.locator("#doc-type")).toBeFocused();
    // Only one type control: no kind-picker buttons.
    for (const kind of ["RFI", "Submittal", "Change order"]) await expect(form.getByRole("button", { name: kind, exact: true })).toHaveCount(0);
    expect(await unlabeled(page)).toEqual([]);
    for (const text of ["Type", "Job", "Subject", "Details", "Recipient name", "Recipient email"]) {
      await expect(form.locator("label", { hasText: new RegExp(`^${text}`) })).toHaveCount(1);
    }
    await page.locator("#doc-type").selectOption({ label: "Change order" });
    await expect(form.getByText("Amount (USD)")).toBeVisible();
    await expect(form.getByRole("heading", { name: "New Change order" })).toBeVisible();
    // Esc closes.
    await page.locator("#doc-title").press("Escape");
    await expect(form).toHaveCount(0);

    await page.getByRole("button", { name: "+ New document" }).click();
    await page.locator("#doc-type").selectOption({ label: "RFI" });
    await page.locator("#doc-job").selectOption({ index: 1 });
    await page.locator("#doc-title").fill(`Which grout color? (${role})`);
    await page.getByRole("button", { name: "Add RFI", exact: true }).click();
    await expect(page.getByTestId("doc-created")).toHaveText(/^RFI \d{3} created$/);
    await expect(page.getByText(`Which grout color? (${role})`).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "+ New document" })).toHaveCount(0); // we're on the document now
    await ctx.close();
  });
}

test("owner: a policy has no recipient fields", async ({ browser }) => {
  const { ctx, page } = await as(browser, "owner");
  await tab(page, "Policy").click();
  await page.getByRole("button", { name: "+ New document" }).click();
  await expect(page.locator("#doc-type")).toHaveValue("policy");
  await expect(page.locator("#doc-who")).toHaveCount(0);
  await expect(page.locator("#doc-email")).toHaveCount(0);
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByTestId("new-document")).toHaveCount(0);
  await ctx.close();
});

test("owner: submit buttons keep acronyms uppercase (Add RFI, Add submittal, Add change order)", async ({ browser }) => {
  const { ctx, page } = await as(browser, "owner");
  await tab(page, "Change management").click();
  await page.getByRole("button", { name: "+ New document" }).click();
  const form = page.getByTestId("new-document");
  for (const [type, label] of [["RFI", "Add RFI"], ["Submittal", "Add submittal"], ["Change order", "Add change order"]]) {
    await page.locator("#doc-type").selectOption({ label: type });
    await expect(form.getByRole("button", { name: label, exact: true })).toBeVisible();
  }
  await expect(form.getByRole("button", { name: /Add (rfi|change Order)/ })).toHaveCount(0);
  await ctx.close();
});

test("owner phone: + New document opens a drawer with focus on Type", async ({ browser }) => {
  const { ctx, page } = await as(browser, "owner", PHONE);
  await tab(page, "Change management").click();
  await page.getByRole("button", { name: "+ New document" }).click();
  const drawer = page.getByRole("dialog");
  await expect(drawer).toBeVisible();
  await expect(drawer.getByTestId("new-document").or(drawer)).toContainText("New RFI");
  await expect(page.locator("#doc-type")).toBeFocused();
  expect(await unlabeled(page)).toEqual([]);
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("new-document")).toHaveCount(0);
  await ctx.close();
});

test("lead: can open the New document form", async ({ browser }) => {
  const { ctx, page } = await as(browser, "lead");
  await tab(page, "Change management").click();
  await expect(page.getByRole("button", { name: "+ New document" })).toBeVisible();
  await ctx.close();
});

for (const role of ["labor", "subcontractor"] as const) {
  test(`${role}: no "+ New document" where they can't create (Policy)`, async ({ browser }) => {
    const { ctx, page } = await as(browser, role);
    await tab(page, "Policy").click();
    await expect(page.getByRole("button", { name: "+ New document" })).toHaveCount(0);
    await ctx.close();
  });
}

test("a new company sees the section empty states", async ({ browser }) => {
  const { newAdmin, openView } = await import("./helpers");
  const { context, page } = await newAdmin(browser, { viewport: DESKTOP });
  await openView(page, "Docs");
  await tab(page, "Policy").click();
  await expect(page.getByText("No policies yet.", { exact: true })).toBeVisible();
  await tab(page, "Change management").click();
  await expect(page.getByText("No RFIs, submittals or change orders yet.", { exact: true })).toBeVisible();
  await context.close();
});
