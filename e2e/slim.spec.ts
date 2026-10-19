import { expect, test, type Browser, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";

// Daily reports (slim app). Runs against a server with debug login ON. For the AI summary,
// start e2e/fake-xai.mjs and the server with XAI_API_KEY=test-fake XAI_BASE_URL=http://127.0.0.1:8099.
// Set SLIM_NO_KEY=1 when the server has no XAI_API_KEY to test the graceful fallback instead.
const OUT = process.env.SLIM_SHOT_DIR ?? "test-results/slim";
const NO_KEY = process.env.SLIM_NO_KEY === "1";
const PHONE = { width: 390, height: 844 };
const DESKTOP = { width: 1280, height: 860 };
const LABEL: Record<string, string> = { owner: "Owner", admin: "Admin", lead: "Lead", labor: "Labor", subcontractor: "Subcontractor" };

async function as(browser: Browser, role: string, viewport = PHONE) {
  const ctx = await browser.newContext({ viewport, isMobile: viewport === PHONE, hasTouch: viewport === PHONE, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await page.goto("/login");
  await page.getByTestId("debug-login").getByRole("button", { name: LABEL[role], exact: true }).click();
  await page.waitForURL((u) => u.pathname !== "/" && u.pathname !== "/login", { timeout: 30_000 }); // "/" now redirects to the role's first view (F1)
  await expect(page.getByRole("button", { name: "Sign out" }).first()).toBeVisible({ timeout: 30_000 });
  return { ctx, page };
}

const nav = (page: Page, label: string) =>
  page.getByRole("button", { name: label, exact: true }).locator("visible=true").first();

test.beforeAll(async ({ browser }) => {
  mkdirSync(OUT, { recursive: true });
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto("/login");
  page.once("dialog", (d) => void d.accept());
  await page.getByRole("button", { name: "Reset demo data" }).click();
  await expect(page.getByText("Demo data reset.")).toBeVisible({ timeout: 30_000 });
  await ctx.close();
});

test.describe.configure({ mode: "serial" });

test("navigation is tiny and role-based; hidden features are gone from nav", async ({ browser }) => {
  for (const [role, tabs] of [
    ["labor", ["Today", "My reports", "Activities", "Docs", "Safety"]],
    ["subcontractor", ["Today", "My reports", "Docs"]],
    ["lead", ["Today", "My reports", "Activities", "Docs", "Safety"]],
    ["owner", ["Reports", "Attention", "Activities", "Docs", "Safety"]],
    ["admin", ["Reports", "Attention", "Activities", "Docs", "Safety"]],
  ] as const) {
    const { ctx, page } = await as(browser, role);
    const bar = page.getByRole("navigation", { name: "Main" });
    await expect(bar.getByRole("button")).toHaveText([...tabs]);
    for (const gone of ["Desk", "Jobs", "Site", "Log", "Foreman"]) {
      await expect(page.getByRole("button", { name: gone, exact: true })).toHaveCount(0);
    }
    await expect(page.getByText("Contract value")).toHaveCount(0);
    await ctx.close();
  }
});

test("labor writes today's report: photo, narrative, first/last edit, lunch dial, submit", async ({ browser }) => {
  const { ctx, page } = await as(browser, "labor");
  await expect(page.getByTestId("first-edit")).toHaveText("—");
  await expect(page.getByRole("button", { name: /Write about your day to submit/ })).toBeDisabled();
  await page.screenshot({ path: `${OUT}/390x844-labor-today-empty.png`, fullPage: true });

  // Camera-first: upload a photo through the capture input.
  await page.getByTestId("photo-input").setInputFiles("e2e/fixtures/site-photo.jpg");
  await expect(page.getByText("1 photo saved.")).toBeVisible({ timeout: 20_000 });
  const first = await page.getByTestId("first-edit").textContent();
  expect(first).not.toBe("—");
  // The full-size photo is served to its author and is a real JPEG, downscaled to <= 1600px.
  await page.locator("[data-photo-id]").first().click();
  const full = page.getByTestId("photo-full");
  await expect(full).toBeVisible();
  const dims = await full.evaluate((img: HTMLImageElement) => [img.naturalWidth, img.naturalHeight, img.src.slice(0, 23)]);
  expect(dims).toEqual([1200, 900, "data:image/jpeg;base64,"]);
  await page.getByRole("button", { name: "Close" }).click();

  await page.locator("#narrative").fill(
    "Hung drywall in the hallway. Ran out of screws by 2pm. The scaffold plank on the stair is cracked, I tagged it.",
  );
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("button", { name: "Saved", exact: true })).toBeVisible();
  await expect(page.getByTestId("first-edit")).toHaveText(first!);
  await page.screenshot({ path: `${OUT}/390x844-labor-today-filled.png`, fullPage: true });

  await page.getByRole("button", { name: "Submit my day" }).click();
  const dial = page.getByRole("slider", { name: "Lunch duration" });
  await expect(dial).toHaveAttribute("aria-valuenow", "30");
  // Keyboard
  await dial.focus();
  await page.keyboard.press("ArrowUp");
  await expect(dial).toHaveAttribute("aria-valuenow", "35");
  await page.keyboard.press("End");
  await expect(dial).toHaveAttribute("aria-valuenow", "60");
  await page.keyboard.press("Home");
  await expect(dial).toHaveAttribute("aria-valuenow", "0");
  await expect(page.getByRole("button", { name: "5 minutes less" })).toBeDisabled();
  // ±5 buttons
  await page.getByRole("button", { name: "5 minutes more" }).click();
  await page.getByRole("button", { name: "5 minutes more" }).click();
  await expect(dial).toHaveAttribute("aria-valuenow", "10");
  // Drag the dot to 3 o'clock (= 15 min); value shows live while moving.
  const box = (await dial.boundingBox())!;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const r = box.width / 2 - 22;
  await page.mouse.move(cx + r * Math.sin((10 / 60) * 2 * Math.PI), cy - r * Math.cos((10 / 60) * 2 * Math.PI));
  await page.mouse.down();
  await page.mouse.move(cx + r * 0.7, cy - r * 0.7, { steps: 5 });
  await expect(page.getByText(/^Lunch: \d+ minutes?$/)).toBeVisible();
  await page.mouse.move(cx + r, cy, { steps: 5 });
  await page.mouse.up();
  await expect(dial).toHaveAttribute("aria-valuenow", "15");
  await page.getByRole("button", { name: "5 minutes more" }).click();
  await page.getByRole("button", { name: "5 minutes more" }).click();
  await page.getByRole("button", { name: "5 minutes more" }).click();
  await expect(dial).toHaveAttribute("aria-valuenow", "30");
  await page.screenshot({ path: `${OUT}/390x844-lunch-dial.png`, fullPage: true });
  await dial.screenshot({ path: `${OUT}/lunch-dial-closeup.png` });

  await page.getByRole("button", { name: "Submit with 30 min lunch" }).click();
  await expect(page.getByText(/✓ Submitted at/)).toBeVisible();
  await expect(page.getByTestId("lunch-saved")).toHaveText("30 min");
  await expect(page.locator("#narrative")).toBeDisabled();
  const last = await page.getByTestId("last-edit").textContent();
  expect(last).not.toBe("—");
  await page.reload();
  await expect(page.getByTestId("lunch-saved")).toHaveText("30 min"); // saved with the report
  await page.screenshot({ path: `${OUT}/390x844-labor-today-submitted.png`, fullPage: true });

  await nav(page, "My reports").click();
  await expect(page.getByTestId("report-card")).toHaveCount(7); // today + 6 seeded days
  await page.screenshot({ path: `${OUT}/390x844-labor-my-reports.png`, fullPage: true });
  await ctx.close();
});

test("field roles can't use the principal review endpoints (server-enforced)", async ({ browser }) => {
  const { ctx, page } = await as(browser, "labor");
  const result = await page.evaluate(async () => {
    const fns = await import("/src/lib/server/fns.ts");
    const day = new Date().toISOString().slice(0, 10);
    const out: string[] = [];
    try {
      await fns.reviewReports({ data: { from: day, to: day, projectId: "", personId: "" } });
      out.push("review:allowed");
    } catch (e) {
      out.push(`review:${(e as Error).message}`);
    }
    try {
      await fns.getAttention({ data: { from: day, to: day } });
      out.push("attention:allowed");
    } catch (e) {
      out.push(`attention:${(e as Error).message}`);
    }
    return out;
  });
  expect(result.join(" ")).not.toContain("allowed");
  expect(result.join(" ")).toContain("report.review");
  await ctx.close();
});

test("owner reviews reports by date, job, and person, with photos", async ({ browser }) => {
  const { ctx, page } = await as(browser, "owner");
  await expect(nav(page, "Reports")).toHaveAttribute("aria-current", "page");
  await page.getByRole("button", { name: "7 days" }).click();
  await expect.poll(() => page.getByTestId("report-card").count(), { timeout: 15_000 }).toBeGreaterThanOrEqual(15);
  await page.screenshot({ path: `${OUT}/390x844-owner-reports.png`, fullPage: true });

  await page.getByRole("button", { name: /Dates, job, person/ }).click();
  await page.locator("#rv-person").selectOption({ label: "Sam Whitfield (Bluegrass Electric)" });
  await expect(page.getByTestId("report-card")).toHaveCount(4);
  for (const card of await page.getByTestId("report-card").all()) await expect(card).toContainText("Sam Whitfield");
  await page.locator("#rv-person").selectOption({ label: "Everyone" });
  await page.locator("#rv-job").selectOption({ label: "Oak Street duplex addition" });
  for (const card of await page.getByTestId("report-card").all()) await expect(card).toContainText("Oak Street duplex addition");
  await page.locator("#rv-job").selectOption({ label: "All jobs" });
  const img = page.getByTestId("report-card").locator("img").first();
  await expect(img).toBeVisible();
  // A principal can open another person's full photo.
  await page.getByTestId("report-card").locator("[data-photo-id]").first().click();
  await expect(page.getByTestId("photo-full")).toBeVisible();
  await page.screenshot({ path: `${OUT}/390x844-owner-photo-open.png` });
  await page.getByRole("button", { name: "Close" }).click();
  await ctx.close();

  const desk = await as(browser, "owner", DESKTOP);
  await desk.page.getByRole("button", { name: "7 days" }).click();
  await expect.poll(() => desk.page.getByTestId("report-card").count()).toBeGreaterThanOrEqual(15);
  await desk.page.screenshot({ path: `${OUT}/desktop-owner-reports.png`, fullPage: false });
  await desk.ctx.close();
});

test("a photo can't be opened by someone outside the company", async ({ browser }) => {
  const { ctx, page } = await as(browser, "owner");
  await page.getByRole("button", { name: "7 days" }).click();
  const id = await page.getByTestId("report-card").locator("[data-photo-id]").first().getAttribute("data-photo-id");
  await ctx.close();
  const { newAdmin } = await import("./helpers");
  const other = await newAdmin(browser);
  const msg = await other.page.evaluate(async (photoId) => {
    const fns = await import("/src/lib/server/fns.ts");
    try {
      await fns.getReportPhoto({ data: { id: photoId! } });
      return "allowed";
    } catch (e) {
      return (e as Error).message;
    }
  }, id);
  expect(msg).toContain("Photo not found");
  await other.context.close();
});

test("attention: AI summary lists items with citations, is cached, and links to the report", async ({ browser }) => {
  const { ctx, page } = await as(browser, "owner");
  await nav(page, "Attention").click();
  await page.getByRole("button", { name: "7 days" }).click();
  if (NO_KEY) {
    await expect(page.getByText("AI summary isn't set up")).toBeVisible({ timeout: 30_000 });
    await page.screenshot({ path: `${OUT}/390x844-owner-attention-no-key.png`, fullPage: true });
    await ctx.close();
    return;
  }
  const list = page.getByTestId("attention-list");
  await expect(page.getByText(/^Read 1\d reports · generated /)).toBeVisible({ timeout: 30_000 });
  await expect(list.getByText(/Safety/).first()).toBeVisible();
  await expect(list.getByText(/Materials/).first()).toBeVisible();
  await expect(list.getByRole("button", { name: /From Luis Moreno's report/ }).first()).toBeVisible();
  await page.screenshot({ path: `${OUT}/390x844-owner-attention.png`, fullPage: true });
  // Cached on the second read.
  await nav(page, "Reports").click();
  await nav(page, "Attention").click();
  await page.getByRole("button", { name: "7 days" }).click();
  await expect(page.getByText(/^Read 1\d reports · cached /)).toBeVisible({ timeout: 30_000 });
  // Citation jumps to the report.
  const cite = list.getByRole("button", { name: /From .+'s report/ }).first();
  const who = ((await cite.textContent()) ?? "").match(/From (.+)'s report/)![1];
  await cite.click();
  await expect(nav(page, "Reports")).toHaveAttribute("aria-current", "page");
  await expect(page.locator("article.border-copper")).toContainText(who);
  await ctx.close();

  const desk = await as(browser, "owner", DESKTOP);
  await nav(desk.page, "Attention").click();
  await desk.page.getByRole("button", { name: "7 days" }).click();
  await expect(desk.page.getByText(/^Read 1\d reports/)).toBeVisible({ timeout: 30_000 });
  await desk.page.screenshot({ path: `${OUT}/desktop-owner-attention.png`, fullPage: false });
  await desk.ctx.close();
});

// ---- Spec 05 · F1: deep links. Every view has a URL; reload, back/forward and links work. ----
const ALL_VIEWS = ["/today", "/mine", "/reports", "/attention", "/activities", "/safety", "/docs", "/team"] as const;
const DESK: Record<string, { views: string[]; home: string }> = {
  owner: { views: ["/reports", "/attention", "/activities", "/docs", "/safety", "/team"], home: "/reports" },
  admin: { views: ["/reports", "/attention", "/activities", "/docs", "/safety", "/team"], home: "/reports" },
  lead: { views: ["/today", "/mine", "/activities", "/docs", "/safety"], home: "/today" },
  labor: { views: ["/today", "/mine", "/activities", "/docs", "/safety"], home: "/today" },
  subcontractor: { views: ["/today", "/mine", "/docs"], home: "/today" },
};
const TITLE: Record<string, string> = {
  "/today": "Today",
  "/mine": "My reports",
  "/reports": "Reports",
  "/attention": "Attention",
  "/activities": "Activities",
  "/safety": "Safety",
  "/docs": "Docs",
  "/team": "Team",
};

for (const role of Object.keys(DESK)) {
  test(`F1 (${role}): each route opens directly; others redirect home with a notice`, async ({ browser }) => {
    const { ctx, page } = await as(browser, role, DESKTOP);
    const { views, home } = DESK[role];
    await expect(page).toHaveURL((u) => u.pathname === home); // "/" → the role's first view
    for (const path of ALL_VIEWS) {
      await page.goto(path);
      if (views.includes(path)) {
        await expect(page).toHaveURL((u) => u.pathname === path);
        await expect(page).toHaveTitle(`${TITLE[path]} · RCL`);
        await expect(page.getByTestId("desk-notice")).toHaveCount(0);
      } else {
        await expect(page).toHaveURL((u) => u.pathname === home);
        await expect(page.getByTestId("desk-notice")).toHaveText("That page isn't on your desk.");
      }
    }
    await ctx.close();
  });
}

test("F1 (lead): each nav click changes the URL and marks the current tab; back/forward work", async ({ browser }) => {
  const { ctx, page } = await as(browser, "lead", DESKTOP);
  for (const [label, path] of [["My reports", "/mine"], ["Activities", "/activities"], ["Docs", "/docs"], ["Safety", "/safety"], ["Today", "/today"]]) {
    await nav(page, label).click();
    await expect(page).toHaveURL((u) => u.pathname === path);
    await expect(nav(page, label)).toHaveAttribute("aria-current", "page");
  }
  await page.goBack();
  await expect(page).toHaveURL((u) => u.pathname === "/safety");
  await expect(page.getByText("2. Daily job safety analysis")).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL((u) => u.pathname === "/docs");
  await page.goForward();
  await expect(page).toHaveURL((u) => u.pathname === "/safety");
  await ctx.close();
});

test("F1 (owner): report filters live in the URL and survive reload", async ({ browser }) => {
  const { ctx, page } = await as(browser, "owner", DESKTOP);
  await page.goto("/reports?from=2026-01-05&to=2026-01-09");
  await expect(page.locator("#rv-from")).toHaveValue("2026-01-05");
  await page.locator("#rv-to").fill("2026-01-12");
  await expect(page).toHaveURL((u) => u.searchParams.get("to") === "2026-01-12");
  await page.reload();
  await expect(page.locator("#rv-from")).toHaveValue("2026-01-05");
  await expect(page.locator("#rv-to")).toHaveValue("2026-01-12");
  await ctx.close();
});

test("F1 (owner): /docs/<id> opens the document directly, with its title, and survives reload", async ({ browser }) => {
  const { ctx, page } = await as(browser, "owner", DESKTOP);
  await page.goto("/docs?section=changes");
  await page.getByTestId("documents").locator("li button").first().click();
  await expect(page).toHaveURL((u) => /^\/docs\/[^/]+$/.test(u.pathname));
  const url = page.url();
  await expect(page).toHaveTitle(/ · Docs · RCL$/);
  await page.reload();
  await expect(page).toHaveURL(url);
  await expect(page.getByTestId("doc-missing")).toHaveCount(0);
  await expect(page).toHaveTitle(/ · Docs · RCL$/);
  await page.goBack();
  await expect(page).toHaveURL((u) => u.pathname === "/docs" && u.searchParams.get("section") === "changes");
  await ctx.close();
});

test("F1: a signed-out deep link goes through sign-in and lands on it; another company's doc is Not found", async ({ browser }) => {
  const owner = await as(browser, "owner", DESKTOP);
  await owner.page.goto("/docs?section=changes");
  await owner.page.getByTestId("documents").locator("li button").first().click();
  await expect(owner.page).toHaveURL((u) => /^\/docs\/[^/]+$/.test(u.pathname));
  const docPath = new URL(owner.page.url()).pathname;
  await owner.ctx.close();

  const ctx = await browser.newContext({ viewport: DESKTOP });
  const page = await ctx.newPage();
  await page.goto(docPath);
  await expect(page).toHaveURL((u) => u.pathname === "/login" && u.searchParams.get("next") === docPath);
  const id = Math.random().toString(36).slice(2, 8);
  await page.getByRole("button", { name: "Email", exact: true }).click();
  await page.locator("#who").fill(`Admin ${id}`);
  await page.locator("#dest").fill(`admin-${id}@example.test`);
  await page.getByRole("button", { name: /Email me a link/ }).click();
  await page.getByRole("link", { name: "Open the magic link" }).click();
  await page.waitForURL((u) => u.pathname === docPath, { timeout: 30_000 });
  await page.locator("#setup-co").fill(`Co ${id}`);
  await page.getByRole("button", { name: "Create the desk" }).click();
  // A new company: the demo company's document isn't on this desk, and nothing about it leaks.
  await expect(page.getByTestId("doc-missing")).toBeVisible();
  await expect(page.getByTestId("doc-missing")).toContainText("Not found");
  await expect(page).toHaveURL((u) => u.pathname === docPath);
  await ctx.close();
});

test("F1 (owner): a single report has its own URL; another company gets Not found", async ({ browser }) => {
  const { ctx, page } = await as(browser, "owner", DESKTOP);
  const reportId = await page.evaluate(async () => {
    const mod = await import("/src/lib/server/fns.ts");
    const today = new Date();
    const day = (d: Date) => d.toLocaleDateString("en-CA");
    const from = new Date(today);
    from.setDate(from.getDate() - 14);
    const list = await mod.reviewReports({ data: { from: day(from), to: day(today), projectId: "", personId: "" } });
    return list.reports[0]?.id ?? "";
  });
  expect(reportId).not.toBe("");
  await page.goto(`/reports/${reportId}`);
  await expect(page.getByTestId("report-missing")).toHaveCount(0);
  await expect(page).toHaveTitle(/report, .* · Reports · RCL$/);
  await ctx.close();

  const { newAdmin } = await import("./helpers");
  const other = await newAdmin(browser, { viewport: DESKTOP });
  await other.page.goto(`/reports/${reportId}`);
  await expect(other.page.getByTestId("report-missing")).toContainText("Not found");
  await other.context.close();
});
