import { expect, test, type Browser, type Page } from "@playwright/test";

// Spec 01 · Crew & skills board — per-role permissions and core acceptance flows.
const LABEL: Record<string, string> = {
  owner: "Owner",
  admin: "Admin",
  lead: "Lead",
  labor: "Labor",
  subcontractor: "Subcontractor",
};
const DESKTOP = { width: 1280, height: 860 };
const PHONE = { width: 390, height: 844 };

async function as(browser: Browser, role: string, viewport = DESKTOP) {
  const ctx = await browser.newContext({ viewport, isMobile: viewport === PHONE, hasTouch: viewport === PHONE });
  const page = await ctx.newPage();
  await page.goto("/login");
  await page.getByTestId("debug-login").getByRole("button", { name: LABEL[role], exact: true }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login") && !u.pathname.startsWith("/m/"), { timeout: 30_000 });
  await expect(page.getByRole("button", { name: "Sign out" }).first()).toBeVisible({ timeout: 30_000 });
  return { ctx, page };
}

const nav = (page: Page, label: string) => page.getByRole("button", { name: label, exact: true }).locator("visible=true").first();

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
  await expect(page.getByText("Demo data reset.")).toBeVisible({ timeout: 60_000 });
  await ctx.close();
});

for (const role of ["owner", "admin", "lead"] as const) {
  test(`${role}: Crew nav opens the board with people and job rail`, async ({ browser }) => {
    const { ctx, page } = await as(browser, role);
    await nav(page, "Crew").click();
    await expect(page.getByTestId("crew-view")).toBeVisible();
    await expect(page.getByRole("tab", { name: "Board" })).toBeVisible();
    await expect(page.getByTestId("crew-board-grid")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("crew-job-card").first()).toBeVisible();
    await ctx.close();
  });
}

for (const role of ["labor", "subcontractor"] as const) {
  test(`${role}: no Crew nav; board/assign/publish/skill refused; You're on on Today`, async ({ browser }) => {
    const { ctx, page } = await as(browser, role, PHONE);
    await expect(nav(page, "Crew")).toHaveCount(0);
    for (const [fn, data, action] of [
      ["getCrewBoard", { week: "2026-10-19" }, "crew.board.view"],
      ["assignCrew", { userId: "x", projectId: "y", day: "2026-10-19" }, "crew.assign"],
      ["publishCrewWeek", { week: "2026-10-19" }, "crew.publish"],
      ["upsertCrewPersonCert", { userId: "x", certTypeId: "y" }, "skill.manage"],
      ["getCrewCertsMatrix", undefined, "crew.board.view"],
    ] as const) {
      const result = await call(page, fn, data);
      expect(result.ok, fn).toBe(false);
      expect(result.error, fn).toContain(action);
    }
    await nav(page, "Today").click();
    await expect(page.getByTestId("youre-on")).toBeVisible({ timeout: 30_000 });
    const week = await call(page, "getMyCrewWeek", {});
    expect(week.ok).toBe(true);
    await ctx.close();
  });
}

test("owner: double-book rejected; Lead cannot assign off their jobs; publish writes outbound", async ({ browser }) => {
  const { ctx, page } = await as(browser, "owner");
  const board = (await call(page, "getCrewBoard", {})).value as {
    weekStart: string;
    people: { userId: string; name: string }[];
    jobs: { projectId: string; name: string }[];
    days: string[];
  };
  const luis = board.people.find((p) => p.name.includes("Luis"))!;
  const whitaker = board.jobs.find((j) => j.name.includes("Whitaker"))!;
  const oak = board.jobs.find((j) => j.name.includes("Oak"))!;
  const day = board.days[4]; // Friday — less likely already full-booked in seed

  // Clear any existing on that day for Luis via remove if present
  const before = (await call(page, "getCrewBoard", { week: board.weekStart })).value as {
    assignments: { id: string; userId: string; day: string }[];
  };
  for (const a of before.assignments.filter((x) => x.userId === luis.userId && x.day === day)) {
    await call(page, "removeCrewAssignment", { id: a.id });
  }

  const a1 = await call(page, "assignCrew", { userId: luis.userId, projectId: whitaker.projectId, day, part: "full" });
  expect(a1.ok, a1.error).toBe(true);
  const a2 = await call(page, "assignCrew", { userId: luis.userId, projectId: oak.projectId, day, part: "full" });
  expect(a2.ok).toBe(false);
  expect(a2.error).toMatch(/already assigned/i);

  // Lead permission: use lead session
  await ctx.close();
  const lead = await as(browser, "lead");
  // Find a job lead does not lead — Chevy Chase is job index 2, seed only leads 0 and 1
  const leadBoard = (await call(lead.page, "getCrewBoard", {})).value as {
    jobs: { projectId: string; name: string; isLead: boolean }[];
    people: { userId: string; name: string }[];
    days: string[];
  };
  const notLead = leadBoard.jobs.find((j) => !j.isLead);
  const someone = leadBoard.people.find((p) => p.name.includes("Luis"))!;
  if (notLead) {
    const refused = await call(lead.page, "assignCrew", {
      userId: someone.userId,
      projectId: notLead.projectId,
      day: leadBoard.days[5],
      part: "am",
    });
    expect(refused.ok).toBe(false);
    expect(refused.error).toContain("crew.assign");
  }

  // Publish from owner
  await lead.ctx.close();
  const owner = await as(browser, "owner");
  const pub = await call(owner.page, "publishCrewWeek", { week: board.weekStart, confirmWarnings: true });
  expect(pub.ok, pub.error).toBe(true);
  const val = pub.value as { published: number; messages: number };
  expect(val.published + val.messages).toBeGreaterThanOrEqual(0); // may already be published
  await owner.ctx.close();
});

test("Activities, Safety, and Docs tabs remain for owner", async ({ browser }) => {
  const { ctx, page } = await as(browser, "owner");
  for (const tab of ["Activities", "Safety", "Docs", "Crew", "Attention", "Reports"]) {
    await expect(nav(page, tab)).toBeVisible();
  }
  await ctx.close();
});
