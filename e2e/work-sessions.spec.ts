import { expect, test, type Browser, type Page } from "@playwright/test";
import { mkdirSync, readFileSync } from "node:fs";
import { extractPdfText } from "../src/lib/pdf";

const SHOTS = "/opt/cursor/artifacts/screenshots";

// Activity log (no sign-in): the 24-hour bar stays, photos get captions, export offers download and share.
// Daily-report sessions: who may create, view and edit, per role.
// Private links: who may create one, per role.
const LABEL: Record<string, string> = { owner: "Owner", admin: "Admin", lead: "Lead", labor: "Labor", subcontractor: "Subcontractor" };

async function as(browser: Browser, role: string) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto("/login");
  await page.getByTestId("debug-login").getByRole("button", { name: LABEL[role], exact: true }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login") && !u.pathname.startsWith("/m/"), { timeout: 30_000 });
  await expect(page.getByRole("button", { name: /^(Sign out|Account: )/ }).locator("visible=true").first()).toBeVisible({ timeout: 30_000 });
  return { ctx, page };
}

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

const today = (page: Page) =>
  page.evaluate(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  });

test("activity log keeps the day bar, captions photos with the time on top, and offers download and share", async ({ page }) => {
  await page.goto("/tracking");
  await expect(page.getByRole("heading", { name: "Activity log" })).toBeVisible();
  const bar = page.getByTestId("day-bar");
  await expect(bar).toBeVisible();
  await expect(bar.getByRole("img")).toContainText("a");
  await expect(bar.getByRole("img")).toContainText("b");
  await expect(page.getByTestId("session-row").filter({ hasText: "Project A" })).toContainText("demolish fence");
  await expect(page.getByTestId("add-session")).toBeVisible();
  await expect(page.getByText("Current project / client")).toHaveCount(0);
  await expect(page.getByLabel("Day")).toHaveCount(0);

  const drop = page.getByTestId("photo-drop");
  await expect(drop).toBeVisible();
  const picker = drop.getByTestId("photo-input");
  await expect(picker).toHaveJSProperty("multiple", true);
  await expect(picker).toHaveAttribute("accept", /heic/);

  const camera = page.getByTestId("photo-caption").nth(0);
  const cameraTime = camera.getByTestId("photo-caption-time");
  await expect(cameraTime).toBeVisible();
  await expect(cameraTime).not.toContainText("not camera");
  await expect(camera.getByRole("textbox", { name: "Caption" })).toHaveValue(/Rotten posts/);
  const timeBox = await cameraTime.boundingBox();
  const fieldBox = await camera.getByRole("textbox", { name: "Caption" }).boundingBox();
  expect(timeBox && fieldBox && timeBox.y < fieldBox.y).toBe(true);

  const fileCap = page.getByTestId("photo-caption").nth(1);
  await expect(fileCap.getByTestId("photo-caption-time")).toContainText("file time");
  await expect(fileCap.getByTestId("photo-caption-time")).toContainText("(not camera)");
  await expect(fileCap.getByRole("textbox", { name: "Caption" })).toHaveValue(/Counted sheets/);

  mkdirSync(SHOTS, { recursive: true });
  await drop.screenshot({ path: `${SHOTS}/photo-drop.png` });
  await camera.screenshot({ path: `${SHOTS}/photo-caption-time.png` });

  await page.getByTestId("day-export").scrollIntoViewIfNeeded();
  await page.getByRole("button", { name: "Share", exact: true }).click();
  await expect(page.getByTestId("share-options")).toBeVisible();
  await expect(page.getByRole("button", { name: "Download PDF" })).toBeVisible();
  await expect(page.getByTestId("create-share-link")).toBeVisible();
  await page.getByTestId("day-export").screenshot({ path: `${SHOTS}/share-download.png` });

  await picker.setInputFiles("e2e/fixtures/site-photo.jpg");
  await expect(page.getByTestId("photo-caption")).toHaveCount(3);
  await camera.getByRole("textbox", { name: "Caption" }).fill("Posts were rotten at the base.");

  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download PDF" }).click();
  const download = await downloading;
  const saved = `${SHOTS}/activity-log.pdf`;
  await download.saveAs(saved);
  const text = extractPdfText(new Uint8Array(readFileSync(saved))).join("");
  const rotten = text.indexOf("Posts were rotten at the base.");
  const fileTime = text.indexOf("file time");
  const counted = text.indexOf("Counted sheets");
  expect(rotten).toBeGreaterThanOrEqual(0);
  expect(fileTime).toBeGreaterThan(rotten);
  expect(counted).toBeGreaterThan(fileTime);
  expect(text).toContain("(not camera)");
  expect(text).toContain("a  Project A demolish fence   b  Project B drywall takeoffs");
});

function hoursMinutes(label: string): number {
  const h = /(\d+)h/.exec(label);
  const m = /(\d+)m/.exec(label);
  return (h ? Number(h[1]) : 0) * 60 + (m ? Number(m[1]) : 0);
}

test("activity log edits lettered hours: times, session b, delete, and the total", async ({ page }) => {
  await page.goto("/tracking");
  const total = page.getByTestId("hours-total");
  await expect(total).toHaveText("6h 30m");
  await expect(page.getByTestId("day-bar")).toContainText("sample");

  const rowA = page.getByTestId("session-row").filter({ hasText: "Project A" });
  await rowA.getByTestId("edit-session").click();
  const edit = page.getByTestId("session-form");
  await edit.locator("input[type=time]").nth(1).fill("12:00");
  await edit.getByRole("button", { name: "Save session" }).click();
  await expect(total).toHaveText("7h");
  await expect(rowA).toContainText("12:00 PM");

  await page.getByTestId("session-row").filter({ hasText: "drywall" }).getByTestId("remove-session").click();
  await expect(page.getByTestId("session-row").filter({ hasText: "drywall" })).toHaveCount(0);
  await expect(total).toHaveText("4h");
  await expect(page.getByTestId("day-bar").getByRole("img")).not.toContainText("b");

  await page.getByTestId("add-session").click();
  const add = page.getByTestId("session-form");
  await add.locator("input[type=time]").nth(0).fill("18:00");
  await add.locator("input[type=time]").nth(1).fill("19:30");
  await add.getByLabel("Project / job").fill("Project B");
  await add.getByLabel("Notes").fill("set the posts");
  await add.getByRole("button", { name: "Add to the day" }).click();
  const rowB = page.getByTestId("session-row").filter({ hasText: "set the posts" });
  await expect(rowB).toContainText("b");
  await expect(rowB).toContainText("Project B");
  await expect(rowB).toContainText("6:00 PM");
  await expect(total).toHaveText("5h 30m");

  await page.reload();
  await expect(page.getByTestId("hours-total")).toHaveText("5h 30m");
  await expect(page.getByTestId("session-row").filter({ hasText: "set the posts" })).toBeVisible();
  await expect(page.getByTestId("session-row").filter({ hasText: "Project A" })).toContainText("12:00 PM");
});

test("work sessions: labor logs their own, cannot see the crew; a lead can view but not edit someone else's; an owner can", async ({ browser }) => {
  const labor = await as(browser, "labor");
  const day = await today(labor.page);
  const jobs = (await call(labor.page, "getMyReport", { day })).value as { jobs: { id: string; name: string }[] };
  expect(jobs.jobs.length).toBeGreaterThan(0);
  const projectId = jobs.jobs[0].id;
  const created = await call(labor.page, "createWorkSession", { day, projectId, startMin: 8 * 60, endMin: 11 * 60, notes: "demolish fence" });
  expect(created.ok, created.error).toBe(true);
  const id = (created.value as { id: string }).id;
  const mine = await call(labor.page, "listWorkSessions", { day, scope: "mine" });
  expect(mine.ok).toBe(true);
  expect((mine.value as { id: string }[]).some((row) => row.id === id)).toBe(true);
  const crew = await call(labor.page, "listWorkSessions", { day, scope: "company" });
  expect(crew.ok).toBe(false);
  expect(crew.error).toMatch(/can't do that \(session\.review\)/);

  const lead = await as(browser, "lead");
  const seen = await call(lead.page, "listWorkSessions", { day, scope: "company" });
  expect(seen.ok, seen.error).toBe(true);
  expect((seen.value as { id: string }[]).some((row) => row.id === id)).toBe(true);
  const leadEdit = await call(lead.page, "updateWorkSession", { id, day, projectId, startMin: 8 * 60, endMin: 12 * 60, notes: "changed by lead" });
  expect(leadEdit.ok).toBe(false);
  expect(leadEdit.error).toMatch(/can't do that \(session\.manage\)/);

  const sub = await as(browser, "subcontractor");
  expect((await call(sub.page, "listWorkSessions", { day, scope: "company" })).ok).toBe(false);
  const subOwn = await call(sub.page, "createWorkSession", { day, projectId, startMin: 13 * 60, endMin: 15 * 60, notes: "sub hours" });
  expect(subOwn.ok, subOwn.error).toBe(true);

  const owner = await as(browser, "owner");
  const fixed = await call(owner.page, "updateWorkSession", { id, day, projectId, startMin: 8 * 60, endMin: 12 * 60, notes: "demolish fence" });
  expect(fixed.ok, fixed.error).toBe(true);
  expect((fixed.value as { notes: string }).notes).toBe("demolish fence");
  expect((await call(owner.page, "deleteWorkSession", { id })).ok).toBe(true);
  if (subOwn.ok) expect((await call(owner.page, "deleteWorkSession", { id: (subOwn.value as { id: string }).id })).ok).toBe(true);

  await owner.ctx.close();
  await sub.ctx.close();
  await lead.ctx.close();
  await labor.ctx.close();
});

test("private activity link follows document sending for every signed-in role", async ({ browser }) => {
  const image = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"/>')}`;
  const snap = (note: string) => ({
    day: "2026-11-04",
    entries: [
      {
        id: "p1",
        kind: "photo",
        body: note,
        image,
        takenAt: "2026-11-02T08:41:00.000Z",
        takenSource: "exif",
        project: "Project A",
        ts: "2026-11-02T08:40:00.000Z",
        lat: 38.04,
        lng: -84.5,
      },
    ],
    sessions: [],
  });

  const opened: { ctx: Awaited<ReturnType<typeof as>>["ctx"]; page: Page; role: string }[] = [];
  const open = async (role: string) => {
    const session = await as(browser, role);
    opened.push({ ...session, role });
    return session;
  };

  try {
    const labor = await open("labor");
    const laborDenied = await call(labor.page, "createActivityShare", snap("labor"));
    expect(laborDenied.ok).toBe(false);
    expect(laborDenied.error).toMatch(/can't do that \(doc\.send\)/);

    const sub = await open("subcontractor");
    const subDenied = await call(sub.page, "createActivityShare", snap("sub"));
    expect(subDenied.ok).toBe(false);
    expect(subDenied.error).toMatch(/can't do that \(doc\.send\)/);

    const tokens = new Map<string, string>();
    for (const role of ["lead", "admin", "owner"] as const) {
      const who = await open(role);
      const created = await call(who.page, "createActivityShare", snap(`${role} caption`));
      expect(created.ok, `${role} ${created.error}`).toBe(true);
      const token = (created.value as { token: string }).token;
      tokens.set(role, token);
      const read = await call(who.page, "getActivityShare", token);
      expect(read.ok, read.error).toBe(true);
      const body = read.value as { share: { entries: { body: string }[] } };
      expect(body.share.entries[0].body).toBe(`${role} caption`);
      expect(JSON.stringify(read.value)).not.toContain("38.04");
      expect(JSON.stringify(read.value)).not.toContain("lat");
    }

    const viewer = await browser.newPage();
    await viewer.goto(`/share/${tokens.get("owner")}`);
    await expect(viewer.getByTestId("photo-caption-time")).toBeVisible();
    await expect(viewer.getByText("owner caption")).toBeVisible();
    await viewer.close();

    const owner = opened.find((row) => row.role === "owner")!;
    const lead = opened.find((row) => row.role === "lead")!;
    await call(owner.page, "setCompanySharing", { key: "labor_doc_send", value: true });
    const laborOk = await call(labor.page, "createActivityShare", snap("labor caption"));
    expect(laborOk.ok, laborOk.error).toBe(true);
    const laborToken = (laborOk.value as { token: string }).token;
    const subStill = await call(sub.page, "createActivityShare", snap("sub still"));
    expect(subStill.ok).toBe(false);
    expect(subStill.error).toMatch(/can't do that \(doc\.send\)/);

    const leadRevoke = await call(lead.page, "revokeActivityShare", { token: laborToken });
    expect(leadRevoke.ok).toBe(false);
    expect(leadRevoke.error).toMatch(/can't do that \(report\.review\)/);

    await call(owner.page, "setCompanySharing", { key: "labor_doc_send", value: false });
    const laborAgain = await call(labor.page, "createActivityShare", snap("labor again"));
    expect(laborAgain.ok).toBe(false);
    expect(laborAgain.error).toMatch(/can't do that \(doc\.send\)/);
    expect((await call(owner.page, "revokeActivityShare", { token: laborToken })).ok).toBe(true);
    for (const token of tokens.values()) {
      expect((await call(owner.page, "revokeActivityShare", { token })).ok).toBe(true);
    }
    const check = await browser.newPage();
    await check.goto(`/share/${tokens.get("owner")}`);
    await expect(check.getByText("This link is not available.")).toBeVisible();
    await check.close();
  } finally {
    const owner = opened.find((row) => row.role === "owner");
    if (owner) await call(owner.page, "setCompanySharing", { key: "labor_doc_send", value: false });
    for (const session of opened) await session.ctx.close();
  }
});

test("signed-in activity log: each role edits only the hours they are allowed to", async ({ browser }) => {
  const labor = await as(browser, "labor");
  const day = await labor.page.evaluate(() => new Date().toISOString().slice(0, 10));
  const note = `labor hours ${Date.now()}`;
  const subNote = `sub hours ${Date.now()}`;
  const opened = [labor];
  try {
    await labor.page.goto("/tracking");
    await expect(labor.page.getByText("sample day")).toBeVisible();
    await labor.page.getByTestId("go-today").click();
    await expect(labor.page).toHaveURL(new RegExp(`day=${day}`));
    await expect(labor.page.getByTestId("day-bar")).toHaveAttribute("data-source", "server", { timeout: 30_000 });
    const before = hoursMinutes(await labor.page.getByTestId("hours-total").innerText());
    await labor.page.getByTestId("add-session").click();
    const form = labor.page.getByTestId("session-form");
    await form.locator("select").selectOption({ index: 1 });
    await form.locator("input[type=time]").nth(0).fill("08:00");
    await form.locator("input[type=time]").nth(1).fill("11:00");
    await form.getByLabel("Notes").fill(note);
    await form.getByRole("button", { name: "Add to the day" }).click();
    await expect.poll(async () => hoursMinutes(await labor.page.getByTestId("hours-total").innerText())).toBe(before + 180);
    await labor.page.getByTestId("session-row").filter({ hasText: note }).getByTestId("edit-session").click();
    await labor.page.getByTestId("session-form").locator("input[type=time]").nth(1).fill("12:00");
    await labor.page.getByTestId("session-form").getByRole("button", { name: "Save session" }).click();
    await expect.poll(async () => hoursMinutes(await labor.page.getByTestId("hours-total").innerText())).toBe(before + 240);
    await labor.page.reload();
    await expect(labor.page.getByTestId("day-bar")).toHaveAttribute("data-source", "server", { timeout: 30_000 });
    await expect(labor.page.getByTestId("session-row").filter({ hasText: note })).toContainText("12:00 PM", { timeout: 30_000 });

    const crew = await call(labor.page, "listWorkSessions", { day, scope: "company" });
    expect(crew.ok).toBe(false);
    expect(crew.error).toMatch(/can't do that \(session\.review\)/);
    const mine = (await call(labor.page, "listWorkSessions", { day, scope: "mine" })).value as { id: string; notes: string; projectId: string }[];
    const created = mine.find((row) => row.notes === note);
    expect(created).toBeTruthy();

    const lead = await as(browser, "lead");
    opened.push(lead);
    await lead.page.goto(`/tracking?day=${day}`);
    await expect(lead.page.getByTestId("day-bar")).toHaveAttribute("data-source", "server", { timeout: 30_000 });
    const leadRow = lead.page.getByTestId("session-row").filter({ hasText: note });
    await expect(leadRow).toBeVisible({ timeout: 30_000 });
    await expect(leadRow.getByTestId("edit-session")).toHaveCount(0);
    const leadEdit = await call(lead.page, "updateWorkSession", {
      id: created!.id,
      day,
      projectId: created!.projectId,
      startMin: 8 * 60,
      endMin: 13 * 60,
      notes: "changed by lead",
    });
    expect(leadEdit.ok).toBe(false);
    expect(leadEdit.error).toMatch(/can't do that \(session\.manage\)/);

    const sub = await as(browser, "subcontractor");
    opened.push(sub);
    await sub.page.goto(`/tracking?day=${day}`);
    await expect(sub.page.getByTestId("day-bar")).toHaveAttribute("data-source", "server", { timeout: 30_000 });
    await expect(sub.page.getByText(note)).toHaveCount(0);
    expect((await call(sub.page, "listWorkSessions", { day, scope: "company" })).ok).toBe(false);
    await sub.page.getByTestId("add-session").click();
    const subForm = sub.page.getByTestId("session-form");
    await subForm.locator("select").selectOption({ index: 1 });
    await subForm.locator("input[type=time]").nth(0).fill("13:00");
    await subForm.locator("input[type=time]").nth(1).fill("15:00");
    await subForm.getByLabel("Notes").fill(subNote);
    await subForm.getByRole("button", { name: "Add to the day" }).click();
    await expect(sub.page.getByTestId("session-row").filter({ hasText: subNote }).getByTestId("edit-session")).toBeVisible();

    const admin = await as(browser, "admin");
    opened.push(admin);
    await admin.page.goto(`/tracking?day=${day}`);
    await expect(admin.page.getByTestId("day-bar")).toHaveAttribute("data-source", "server", { timeout: 30_000 });
    await expect(admin.page.getByTestId("session-row").filter({ hasText: note }).getByTestId("edit-session")).toBeVisible({ timeout: 30_000 });

    const owner = await as(browser, "owner");
    opened.push(owner);
    await owner.page.goto(`/tracking?day=${day}`);
    await expect(owner.page.getByTestId("day-bar")).toHaveAttribute("data-source", "server", { timeout: 30_000 });
    const ownerRow = owner.page.getByTestId("session-row").filter({ hasText: note });
    await expect(ownerRow.getByTestId("edit-session")).toBeVisible({ timeout: 30_000 });
    await ownerRow.getByTestId("edit-session").click();
    await owner.page.getByTestId("session-form").getByLabel("Notes").fill("owner fixed");
    await owner.page.getByTestId("session-form").getByRole("button", { name: "Save session" }).click();
    await owner.page.reload();
    await expect(owner.page.getByTestId("day-bar")).toHaveAttribute("data-source", "server", { timeout: 30_000 });
    await expect(owner.page.getByTestId("session-row").filter({ hasText: "owner fixed" })).toBeVisible({ timeout: 30_000 });
    await owner.page.getByTestId("session-row").filter({ hasText: "owner fixed" }).getByTestId("remove-session").click();
    await owner.page.getByTestId("session-row").filter({ hasText: subNote }).getByTestId("remove-session").click();
    await expect(owner.page.getByText("owner fixed")).toHaveCount(0);
    await expect(owner.page.getByText(subNote)).toHaveCount(0);
  } finally {
    for (const session of opened) await session.ctx.close();
  }
});
