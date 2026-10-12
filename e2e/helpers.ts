import { expect, type Browser, type Page } from "@playwright/test";

export const uid = () => Math.random().toString(36).slice(2, 8);

/** Sign in through the magic-link dev fallback (link shown on screen; nothing is sent). */
export async function magicSignIn(page: Page, email: string, name: string) {
  await page.goto("/login");
  await page.getByRole("button", { name: "Email", exact: true }).click();
  await page.locator("#who").fill(name);
  await page.locator("#dest").fill(email);
  await page.getByRole("button", { name: /Email me a link/ }).click();
  const link = page.getByRole("link", { name: "Open the magic link" });
  await expect(link).toBeVisible();
  await link.click();
  await page.waitForURL((url) => !url.pathname.startsWith("/m/") && !url.pathname.startsWith("/login"), {
    timeout: 30_000,
  });
}

/** New admin with a fresh company. */
export async function newAdmin(browser: Browser, opts: { viewport?: { width: number; height: number } } = {}) {
  const context = await browser.newContext({ viewport: opts.viewport });
  const page = await context.newPage();
  const id = uid();
  await magicSignIn(page, `admin-${id}@example.test`, `Admin ${id}`);
  await expect(page.getByRole("button", { name: "Create the desk" })).toBeVisible();
  await page.locator("#setup-co").fill(`Co ${id}`);
  await page.getByRole("button", { name: "Create the desk" }).click();
  await expect(page.getByRole("button", { name: "Team" }).first()).toBeVisible();
  return { context, page, id };
}

export async function openView(page: Page, label: string) {
  await page.getByRole("button", { name: label, exact: true }).locator("visible=true").first().click();
}

export async function createJob(page: Page, name: string) {
  await openView(page, "Jobs");
  await page.getByPlaceholder("Job name").or(page.getByRole("button", { name: /new job|add job|\+/i })).first().waitFor();
  if (!(await page.getByPlaceholder("Job name").isVisible())) {
    await page.getByRole("button", { name: /new job|add job/i }).first().click();
  }
  await page.getByPlaceholder("Job name").fill(name);
  await page.getByPlaceholder("Client").fill("Test Client");
  await page.getByPlaceholder("Address").fill("1 Test St");
  await page.getByPlaceholder("Contract $").fill("125000");
  await page.getByRole("button", { name: "Save job" }).click();
  // UX finding: a newly saved job is not auto-selected; select it explicitly.
  await page.getByRole("button", { name: new RegExp(`^${name}`) }).click();
  await expect(page.getByRole("heading", { name, level: 2 })).toBeVisible();
}

/** Invite a crew member by email; returns the single-use link the dev fallback shows. */
export async function inviteByEmail(page: Page, name: string, email: string, role = "labor") {
  await openView(page, "Team");
  await page.getByRole("button", { name: "Email", exact: true }).click();
  await page.getByPlaceholder("Name").fill(name);
  await page.getByPlaceholder("Email").fill(email);
  await page.locator("form select").last().selectOption(role);
  await page.getByRole("button", { name: "Send invite" }).click();
  const link = page.locator('a[href^="/m/"]').first();
  await expect(link).toBeVisible();
  return (await link.getAttribute("href"))!;
}
