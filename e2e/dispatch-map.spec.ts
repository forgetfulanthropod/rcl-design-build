import { mkdirSync } from "node:fs";
import { expect, test, type Browser, type Page } from "@playwright/test";

// Dispatch map: jobs on a Leaflet map, a year-to-six-months slider, and assigning
// a crew for the next day. Lead and up can assign; labor and subs cannot.
const LABEL: Record<string, string> = {
  owner: "Owner",
  admin: "Admin",
  lead: "Lead",
  labor: "Labor",
  subcontractor: "Subcontractor",
};
const DESKTOP = { width: 1280, height: 860 };
const PHONE = { width: 390, height: 844 };
const SHOTS = "/opt/cursor/artifacts";

async function as(browser: Browser, role: string, viewport = DESKTOP) {
  const ctx = await browser.newContext({
    viewport,
    isMobile: viewport === PHONE,
    hasTouch: viewport === PHONE,
  });
  const page = await ctx.newPage();
  await page.goto("/login");
  await page
    .getByTestId("debug-login")
    .getByRole("button", { name: LABEL[role], exact: true })
    .click();
  await page.waitForURL(
    (url) => !url.pathname.startsWith("/login") && !url.pathname.startsWith("/m/"),
    { timeout: 30_000 },
  );
  await expect(
    page
      .getByRole("button", { name: /^(Sign out|Account: )/ })
      .locator("visible=true")
      .first(),
  ).toBeVisible({ timeout: 30_000 });
  return { ctx, page };
}

async function call(
  page: Page,
  fn: string,
  data?: unknown,
): Promise<{ ok: boolean; error?: string }> {
  return page.evaluate(
    async ([name, payload]) => {
      const fns = (await import("/src/lib/server/fns.ts")) as unknown as Record<
        string,
        (a: { data: unknown }) => Promise<unknown>
      >;
      try {
        await fns[name as string]({ data: payload });
        return { ok: true };
      } catch (error) {
        return { ok: false, error: (error as Error).message };
      }
    },
    [fn, data] as const,
  );
}

async function openMap(page: Page) {
  await page.goto("/dispatch");
  await expect(page.getByTestId("dispatch-view")).toBeVisible();
  await expect(page.getByTestId("dispatch-start")).toBeVisible({ timeout: 30_000 });
  await page.getByRole("tab", { name: "Map", exact: true }).click();
  await expect(page.getByTestId("dispatch-map")).toBeVisible();
  await expect(page.getByTestId("dispatch-bubble").first()).toBeVisible({ timeout: 30_000 });
  await page
    .locator(".leaflet-tile-loaded")
    .first()
    .waitFor({ state: "visible", timeout: 20_000 })
    .catch(() => undefined);
}

test.describe.configure({ mode: "serial" });

test("owner: map, slider, and assigning a crew for the next day", async ({ browser }) => {
  test.setTimeout(120_000);
  mkdirSync(SHOTS, { recursive: true });
  const { ctx, page } = await as(browser, "owner");
  await openMap(page);
  const bubble = (name: string) =>
    page.locator(`[data-testid="dispatch-bubble"][data-job-name="${name}"]`);
  await expect(page.getByTestId("dispatch-bubble")).toHaveCount(4);
  await expect(bubble("Whitaker kitchen remodel")).toBeVisible();
  await expect(bubble("Oak Street duplex addition")).toBeVisible();
  await expect(bubble("Chevy Chase dental fit-up")).toBeVisible();
  await expect(bubble("Lexington kitchen")).toBeVisible();
  await expect(page.getByTestId("dispatch-legend")).toContainText("Left of a job");
  await page.screenshot({ path: `${SHOTS}/dispatch-map-desktop.png` });

  const date = page.getByTestId("dispatch-slider-date");
  const todayLabel = (await date.innerText()).trim();
  await page.getByTestId("dispatch-slider").evaluate((el) => {
    const input = el as HTMLInputElement;
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    set?.call(input, "0");
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await expect(date).not.toHaveText(todayLabel);
  await expect(date).toContainText("365 days ago");
  await page.getByRole("button", { name: "Today", exact: true }).click();
  await expect(date).toContainText("Today");

  const dental = page.getByTestId("dispatch-need").filter({ hasText: "Chevy Chase dental fit-up" });
  await expect(dental).toBeVisible();
  await dental.getByTestId("dispatch-assign").click();
  const sheet = page.getByTestId("dispatch-assign-sheet");
  await expect(sheet).toBeVisible();
  await expect(sheet.getByTestId("dispatch-assign-flag")).toBeVisible();
  await sheet.getByRole("checkbox", { name: "Adam Price", exact: true }).check();
  await page.screenshot({ path: `${SHOTS}/dispatch-assign-desktop.png` });
  await sheet.getByTestId("dispatch-assign-save").click();
  await expect(sheet).toHaveCount(0);
  await expect(dental).toHaveCount(0);
  await expect(bubble("Chevy Chase dental fit-up")).toHaveAttribute("data-needs", "false");
  await ctx.close();
});

test("owner on a phone: the map fits and a job can be opened to assign", async ({ browser }) => {
  test.setTimeout(90_000);
  mkdirSync(SHOTS, { recursive: true });
  const { ctx, page } = await as(browser, "owner", PHONE);
  await openMap(page);
  await expect(page.getByTestId("dispatch-slider")).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  );
  expect(overflow).toBe(false);
  await page.screenshot({ path: `${SHOTS}/dispatch-map-phone.png` });
  const need = page.getByTestId("dispatch-need");
  if ((await need.count()) > 0) {
    await need.first().getByTestId("dispatch-assign").click();
  } else {
    await page.getByTestId("dispatch-bubble").first().click();
  }
  await expect(page.getByTestId("dispatch-assign-sheet")).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/dispatch-assign-phone.png` });
  const sheetOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  );
  expect(sheetOverflow).toBe(false);
  await ctx.close();
});

test("labor on a phone: the map is read-only and assign is refused", async ({ browser }) => {
  const { ctx, page } = await as(browser, "labor", PHONE);
  await openMap(page);
  await expect(page.getByTestId("dispatch-readonly")).toBeVisible();
  await expect(page.getByTestId("dispatch-assign")).toHaveCount(0);
  await expect(page.getByTestId("dispatch-bubble").first()).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  );
  expect(overflow).toBe(false);
  const read = await call(page, "getDispatchMap", {});
  expect(read.ok, read.error).toBe(true);
  const denied = await call(page, "assignDispatchCrew", {
    projectId: "x",
    day: "2020-01-01",
    userIds: ["x"],
  });
  expect(denied.ok).toBe(false);
  expect(denied.error).toContain("dispatch.edit");
  await ctx.close();
});

for (const role of ["subcontractor"] as const) {
  test(`${role}: assignDispatchCrew is refused`, async ({ browser }) => {
    const { ctx, page } = await as(browser, role);
    await page.goto("/dispatch");
    await expect(page.getByTestId("dispatch-view")).toBeVisible();
    const denied = await call(page, "assignDispatchCrew", {
      projectId: "x",
      day: "2020-01-01",
      userIds: ["x"],
    });
    expect(denied.ok).toBe(false);
    expect(denied.error).toContain("dispatch.edit");
    const read = await call(page, "getDispatchMap", {});
    expect(read.ok, read.error).toBe(true);
    await ctx.close();
  });
}

for (const role of ["admin", "lead"] as const) {
  test(`${role}: assignDispatchCrew passes the role check`, async ({ browser }) => {
    const { ctx, page } = await as(browser, role);
    await page.goto("/dispatch");
    await expect(page.getByTestId("dispatch-view")).toBeVisible();
    const result = await call(page, "assignDispatchCrew", {
      projectId: "no-such-job",
      day: "2020-01-01",
      userIds: ["no-such-person"],
    });
    expect(result.ok).toBe(false);
    expect(result.error ?? "").not.toContain("dispatch.edit");
    await ctx.close();
  });
}
