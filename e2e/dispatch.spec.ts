import { expect, test, type Browser, type Locator, type Page } from "@playwright/test";

// Dispatch is URL-only. Lead and up edit; labor and subs can open it and cannot change it.
const LABEL: Record<string, string> = {
  owner: "Owner",
  admin: "Admin",
  lead: "Lead",
  labor: "Labor",
  subcontractor: "Subcontractor",
};
const DESKTOP = { width: 1280, height: 860 };
const PHONE = { width: 390, height: 844 };
const MUTATIONS = [
  ["addDispatchLocation", { name: "Nope" }],
  ["updateDispatchLocation", { id: "x", notes: "no" }],
  ["setDispatchDayNote", { locationId: "x", day: "2026-11-24", notes: "no" }],
  ["addDispatchPerson", { userId: "x", kind: "full", day: "2026-11-24" }],
  ["setDispatchPersonKind", { userId: "x", kind: "part", day: "2026-11-24" }],
  ["placeDispatch", { userId: "x", day: "2026-11-24", locationId: "x" }],
  ["setDispatchPersonNote", { userId: "x", day: "2026-11-24", notes: "no" }],
  ["setDispatchPhone", { userId: "x", phone: "8595550100" }],
  ["sendDispatchDay", { day: "2026-11-24" }],
  ["undoDispatchSend", { id: "x" }],
  ["removeDispatchPerson", { userId: "x" }],
] as const;

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

async function openDispatch(page: Page) {
  await page.goto("/dispatch");
  await expect(page).toHaveURL(/\/dispatch$/);
  await expect(page.getByTestId("dispatch-view")).toBeVisible();
  await expect(page.getByTestId("dispatch-start")).toHaveText("Starts at 8:00 AM", {
    timeout: 30_000,
  });
}

function location(page: Page, name: string): Locator {
  return page.getByTestId("dispatch-location").filter({ hasText: name });
}

async function dragPerson(page: Page, name: string, target: Locator, line = false) {
  const handle = page.getByRole("button", { name: `Move ${name}` });
  await handle.scrollIntoViewIfNeeded();
  await target.scrollIntoViewIfNeeded();
  if (!line) {
    await handle.dragTo(target, { targetPosition: { x: 40, y: 48 } });
    return;
  }
  const from = await handle.boundingBox();
  const to = await target.boundingBox();
  if (!from || !to) throw new Error(`missing drag box for ${name}`);
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + 40, to.y + 48, { steps: 12 });
  await expect(target.getByTestId("dispatch-drop-line")).toBeVisible();
  await page.mouse.up();
}

test.describe.configure({ mode: "serial" });

test.beforeAll(async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto("/login");
  page.once("dialog", (dialog) => void dialog.accept());
  await page.getByRole("button", { name: "Reset demo data" }).click();
  await expect(page.getByText("Demo data reset.")).toBeVisible({ timeout: 60_000 });
  await ctx.close();
});

for (const role of ["owner", "admin", "lead"] as const) {
  test(`${role}: /dispatch is not in the nav, and this role can edit`, async ({ browser }) => {
    const { ctx, page } = await as(browser, role);
    await expect(page.getByRole("button", { name: "Dispatch", exact: true })).toHaveCount(0);
    await openDispatch(page);
    await expect(page.getByTestId("dispatch-add-location")).toBeVisible();
    await expect(page.getByTestId("dispatch-readonly")).toHaveCount(0);
    const added = await call(page, "addDispatchLocation", { name: `${role} yard` });
    expect(added.ok, added.error).toBe(true);
    const past = await call(page, "placeDispatch", {
      userId: "nobody",
      day: "2026-11-24",
      locationId: "nope",
    });
    expect(past.ok).toBe(false);
    expect(past.error ?? "").not.toContain("dispatch.edit");
    await ctx.close();
  });
}

for (const role of ["labor", "subcontractor"] as const) {
  test(`${role}: /dispatch opens read-only and every edit API is refused`, async ({ browser }) => {
    const { ctx, page } = await as(browser, role, PHONE);
    await expect(
      page
        .getByRole("navigation", { name: "Main" })
        .getByRole("button", { name: "Dispatch", exact: true }),
    ).toHaveCount(0);
    await openDispatch(page);
    await expect(page.getByTestId("dispatch-readonly")).toBeVisible();
    await expect(page.getByTestId("dispatch-add-location")).toHaveCount(0);
    await expect(page.getByTestId("dispatch-handle")).toHaveCount(0);
    await expect(page.getByTestId("dispatch-send")).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Actions for/ })).toHaveCount(0);
    await expect(page.getByTestId("dispatch-move-menu")).toHaveCount(0);
    await expect(page.getByRole("menuitem", { name: /Move to|Remove|Clear/ })).toHaveCount(0);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    );
    expect(overflow).toBe(false);
    const read = await call(page, "getDispatch", {});
    expect(read.ok, read.error).toBe(true);
    for (const [fn, data] of MUTATIONS) {
      const result = await call(page, fn, data);
      expect(result.ok, fn).toBe(false);
      expect(result.error, fn).toContain("dispatch.edit");
    }
    await ctx.close();
  });
}

test("owner: day board, drag between locations, carry-forward, and the week", async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const { ctx, page } = await as(browser, "owner");
  await openDispatch(page);

  await page.getByTestId("dispatch-add-location").click();
  await page.locator("#dispatch-project").selectOption({ label: "Whitaker kitchen remodel" });
  await page
    .getByTestId("dispatch-location-form")
    .getByRole("button", { name: "Add location" })
    .click();
  await expect(location(page, "Whitaker kitchen remodel").getByText("Job")).toBeVisible();

  await page.getByTestId("dispatch-add-location").click();
  await page.locator("#dispatch-location-name").fill("Shop");
  await page.locator("#dispatch-location-address").fill("100 Yard St");
  await page.locator("#dispatch-location-notes").fill("Gate code 1492");
  await page
    .getByTestId("dispatch-location-form")
    .getByRole("button", { name: "Add location" })
    .click();
  const shop = location(page, "Shop");
  await expect(shop.getByTestId("dispatch-standing-note")).toHaveValue("Gate code 1492");

  await page.getByTestId("dispatch-add-person").click();
  await page.locator("#dispatch-person").selectOption({ label: "Luis Moreno" });
  await page
    .locator("#dispatch-person-location")
    .selectOption({ label: "Whitaker kitchen remodel" });
  await page
    .getByTestId("dispatch-person-form")
    .getByRole("button", { name: "Add to schedule" })
    .click();
  await expect(
    location(page, "Whitaker kitchen remodel").getByText("Luis Moreno", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Move Luis Moreno" }).click();
  await page.getByRole("menuitem", { name: "Move to Shop" }).click();
  await expect(location(page, "Shop").getByText("Luis Moreno", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Move Luis Moreno" }).click();
  await page.getByRole("menuitem", { name: "Move to Whitaker kitchen remodel" }).click();
  await expect(
    location(page, "Whitaker kitchen remodel").getByText("Luis Moreno", { exact: true }),
  ).toBeVisible();

  await page.getByTestId("dispatch-add-person").click();
  await page
    .locator("#dispatch-person")
    .selectOption({ label: "Sam Whitfield (Bluegrass Electric)" });
  await page.getByRole("radio", { name: /Part-time/ }).check();
  await page
    .getByTestId("dispatch-person-form")
    .getByRole("button", { name: "Add to schedule" })
    .click();
  await expect(
    page
      .getByTestId("dispatch-available")
      .getByText("Sam Whitfield (Bluegrass Electric)", { exact: true }),
  ).toBeVisible();

  await shop.getByTestId("dispatch-day-note").fill("Bring the trailer.");
  await shop.getByTestId("dispatch-day-note").blur();
  await expect(shop.getByText("Saved")).toBeVisible();
  await shop.getByRole("button", { name: "Actions for Shop" }).click();
  await shop.getByRole("menuitem", { name: "Clear instructions for Shop" }).click();
  await expect(page.getByTestId("dispatch-action-undo")).toBeVisible();
  await expect(shop.getByTestId("dispatch-day-note")).toHaveValue("Bring the trailer.");
  await page.getByTestId("dispatch-action-undo").getByRole("button", { name: "Undo" }).click();
  await expect(page.getByTestId("dispatch-action-undo")).toHaveCount(0);

  const luis = page.getByTestId("dispatch-person").filter({ hasText: "Luis Moreno" });
  await luis.getByRole("button", { name: "Instruction for Luis Moreno" }).click();
  await luis.getByLabel("Instruction for Luis Moreno").fill("Call the homeowner.");
  await luis.getByRole("button", { name: "Save instruction for Luis Moreno" }).click();
  await expect(luis.getByTestId("dispatch-person-note")).toHaveText("Call the homeowner.");
  await luis.getByRole("button", { name: "Move Luis Moreno" }).click();
  await luis.getByRole("menuitem", { name: "Clear instruction for Luis Moreno" }).click();
  await expect(page.getByTestId("dispatch-action-undo")).toContainText(
    "Clearing instruction for Luis Moreno",
  );
  await expect(luis.getByTestId("dispatch-person-note")).toHaveText("Call the homeowner.");
  await page.getByTestId("dispatch-action-undo").getByRole("button", { name: "Undo" }).click();
  await expect(luis.getByTestId("dispatch-person-note")).toHaveText("Call the homeowner.");

  await luis.getByLabel("Phone for Luis Moreno").fill("(859) 555-0100");
  await luis.getByLabel("Phone for Luis Moreno").blur();
  await expect(luis.getByLabel("Phone for Luis Moreno")).toHaveValue("+1 859-555-0100");
  await luis.getByLabel("Phone for Luis Moreno").fill("8595550199");
  await luis.getByLabel("Phone for Luis Moreno").blur();
  await expect(luis.getByLabel("Phone for Luis Moreno")).toHaveValue("+1 859-555-0199");

  await dragPerson(page, "Luis Moreno", shop, true);
  await expect(shop.getByText("Luis Moreno", { exact: true })).toBeVisible();
  await expect(
    location(page, "Whitaker kitchen remodel").getByText("Luis Moreno", { exact: true }),
  ).toHaveCount(0);

  await dragPerson(
    page,
    "Sam Whitfield (Bluegrass Electric)",
    location(page, "Whitaker kitchen remodel"),
  );
  await expect(
    location(page, "Whitaker kitchen remodel").getByText("Sam Whitfield (Bluegrass Electric)", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page
      .getByTestId("dispatch-available")
      .getByText("Sam Whitfield (Bluegrass Electric)", { exact: true }),
  ).toHaveCount(0);

  await page.reload();
  await expect(page.getByTestId("dispatch-start")).toHaveText("Starts at 8:00 AM");
  await expect(location(page, "Shop").getByText("Luis Moreno", { exact: true })).toBeVisible();
  await expect(location(page, "Shop").getByTestId("dispatch-day-note")).toHaveValue(
    "Bring the trailer.",
  );

  await page.getByRole("button", { name: "Previous day" }).click();
  await expect(location(page, "Shop").getByText("Luis Moreno", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Previous day" }).click();
  await expect(location(page, "Shop").getByText("Luis Moreno", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Next day" }).click();
  await page.getByRole("button", { name: "Next day" }).click();
  await expect(location(page, "Shop").getByText("Luis Moreno", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Next day" }).click();
  await expect(location(page, "Shop").getByText("Luis Moreno", { exact: true })).toBeVisible();
  await expect(
    page
      .getByTestId("dispatch-available")
      .getByText("Sam Whitfield (Bluegrass Electric)", { exact: true }),
  ).toBeVisible();
  await expect(
    location(page, "Whitaker kitchen remodel").getByText("Sam Whitfield (Bluegrass Electric)", {
      exact: true,
    }),
  ).toHaveCount(0);

  await page.getByTestId("dispatch-scroll").evaluate((node) => {
    node.scrollTop = node.scrollHeight;
  });
  const field = await page.getByTestId("dispatch-day-note").last().boundingBox();
  const dock = await page.getByTestId("dispatch-send-dock").boundingBox();
  expect(field && dock && field.y + field.height <= dock.y + 2).toBeTruthy();

  await page.getByTestId("dispatch-tab-week").click();
  const week = page.getByTestId("dispatch-week");
  await expect(week).toBeVisible();
  await expect(week.getByRole("button")).toHaveCount(7);
  await expect(week.locator("section")).toHaveCount(7);
  await expect(week.locator("[data-selected='true']")).toHaveCount(1);
  await expect(week.getByText("No one placed")).toHaveCount(0);
  const widths = await week
    .locator("section")
    .evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().width));
  expect(Math.max(...widths) - Math.min(...widths)).toBeLessThan(8);
  await expect(week.getByTestId("dispatch-week-location-note").first()).toHaveClass(/line-clamp-2/);
  await expect(week.getByText("Luis Moreno", { exact: true }).first()).toBeVisible();
  await expect(week.getByText("Shop").first()).toBeVisible();
  await expect(week.getByText("Bring the trailer.").first()).toBeVisible();
  await expect(week.getByText("Call the homeowner.").first()).toBeVisible();
  await expect(week.getByText("+1 859-555-0199", { exact: true }).first()).toBeVisible();
  const fab = page.getByTestId("dispatch-send");
  await expect(fab).toHaveAttribute("data-state", "pending");
  await expect(fab).toBeEnabled();
  await expect(page.getByTestId("dispatch-last-sent")).toHaveText("Never sent");
  const box = await fab.boundingBox();
  expect(box).toBeTruthy();
  expect((box?.x ?? 0) + (box?.width ?? 0)).toBeGreaterThan(1200);
  expect((box?.y ?? 0) + (box?.height ?? 0)).toBeGreaterThan(740);
  await ctx.close();
});

test("owner on a phone: dragging the handle still moves a person", async ({ browser }) => {
  const { ctx, page } = await as(browser, "owner", PHONE);
  await openDispatch(page);
  const whitaker = location(page, "Whitaker kitchen remodel");
  await dragPerson(page, "Luis Moreno", whitaker);
  await expect(whitaker.getByText("Luis Moreno", { exact: true })).toBeVisible();
  await expect(location(page, "Shop").getByText("Luis Moreno", { exact: true })).toHaveCount(0);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  );
  expect(overflow).toBe(false);
  await page.getByTestId("dispatch-scroll").evaluate((node) => {
    node.scrollTop = node.scrollHeight;
  });
  const field = await page.getByTestId("dispatch-day-note").last().boundingBox();
  const dock = await page.getByTestId("dispatch-send-dock").boundingBox();
  expect(field && dock && field.y + field.height <= dock.y + 2).toBeTruthy();
  await ctx.close();
});

test("labor sees the day's instructions and phone, and cannot change them", async ({ browser }) => {
  const { ctx, page } = await as(browser, "labor");
  await openDispatch(page);
  const luis = page.getByTestId("dispatch-person").filter({ hasText: "Luis Moreno" });
  await expect(luis.getByTestId("dispatch-person-note")).toHaveText("Call the homeowner.");
  await expect(location(page, "Shop").getByText("Bring the trailer.")).toBeVisible();
  await expect(luis.getByTestId("dispatch-phone")).toHaveText("+1 859-555-0199");
  await expect(page.getByRole("button", { name: /Instruction for/ })).toHaveCount(0);
  await expect(page.getByLabel("Phone for Luis Moreno")).toHaveCount(0);
  await expect(page.getByTestId("dispatch-send")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Actions for/ })).toHaveCount(0);
  await expect(page.getByTestId("dispatch-move-menu")).toHaveCount(0);
  await expect(page.getByRole("menuitem", { name: /Move to/ })).toHaveCount(0);
  for (const [fn, data] of [
    ["setDispatchPersonNote", { userId: "x", day: "2026-11-24", notes: "no" }],
    ["setDispatchPhone", { userId: "x", phone: "8595550100" }],
    ["setDispatchDayNote", { locationId: "x", day: "2026-11-24", notes: "" }],
  ] as const) {
    const result = await call(page, fn, data);
    expect(result.ok, fn).toBe(false);
    expect(result.error, fn).toContain("dispatch.edit");
  }
  await ctx.close();
});

test("undo shows for 5 seconds without a confirm dialog", async ({ browser }) => {
  test.setTimeout(90_000);
  const ctx = await browser.newContext({ viewport: DESKTOP });
  const page = await ctx.newPage();
  await page.clock.install();
  await page.goto("/login");
  await page.getByTestId("debug-login").getByRole("button", { name: "Owner", exact: true }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 30_000 });
  await page.goto("/dispatch");
  await expect(page.getByTestId("dispatch-start")).toBeVisible();
  const added = await call(page, "addDispatchLocation", { name: "Undo yard" });
  expect(added.ok, added.error).toBe(true);
  await page.reload();
  await expect(page.getByTestId("dispatch-start")).toBeVisible();
  const fab = page.getByTestId("dispatch-send");
  await expect(fab).toBeEnabled();
  let dialog = false;
  page.on("dialog", () => {
    dialog = true;
  });
  await fab.click();
  await expect(page.getByTestId("dispatch-undo")).toBeVisible();
  expect(dialog).toBe(false);
  await page.clock.fastForward(5_000);
  await expect(page.getByTestId("dispatch-undo")).toHaveCount(0);

  const yard = location(page, "Undo yard");
  await yard.getByTestId("dispatch-day-note").fill("Keep this.");
  await yard.getByTestId("dispatch-day-note").blur();
  await expect(yard.getByText("Saved")).toBeVisible();
  await yard.getByRole("button", { name: "Actions for Undo yard" }).click();
  await yard.getByRole("menuitem", { name: "Clear instructions for Undo yard" }).click();
  await expect(page.getByTestId("dispatch-action-undo")).toContainText(
    "Clearing today's instructions",
  );
  await expect(yard.getByTestId("dispatch-day-note")).toHaveValue("Keep this.");
  await page.getByTestId("dispatch-action-undo").getByRole("button", { name: "Undo" }).click();
  await expect(yard.getByTestId("dispatch-day-note")).toHaveValue("Keep this.");
  await yard.getByRole("button", { name: "Actions for Undo yard" }).click();
  await yard.getByRole("menuitem", { name: "Clear instructions for Undo yard" }).click();
  await page.clock.fastForward(5_000);
  await expect(page.getByTestId("dispatch-action-undo")).toHaveCount(0);
  await expect(yard.getByTestId("dispatch-day-note")).toHaveValue("");

  await yard.getByRole("button", { name: "Actions for Undo yard" }).click();
  await yard.getByRole("menuitem", { name: "Remove" }).click();
  await expect(page.getByTestId("dispatch-action-undo")).toContainText("Removing Undo yard");
  await page.getByTestId("dispatch-action-undo").getByRole("button", { name: "Undo" }).click();
  await expect(yard).toBeVisible();
  await yard.getByRole("button", { name: "Actions for Undo yard" }).click();
  await yard.getByRole("menuitem", { name: "Remove" }).click();
  await page.clock.fastForward(5_000);
  await expect(location(page, "Undo yard")).toHaveCount(0);
  await ctx.close();
});
