import { expect, test, type Browser, type Download, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { extractPdfText } from "../src/lib/pdf";

// Daily report as time-stamped entries (Charlie, Oct 20): a plus adds Text or Photo, entries show
// in time order with their times, and "Download PDF" works at any point while writing. Who can
// download follows the sharing rules: Lead yes, Labor only with "Labor can send documents",
// Subs never, Owner/Admin any report from Reports. In the demo, Labor's today is empty; Lead's
// and the Sub's today are seeded and already submitted (written before entries existed).
const PHONE = { width: 390, height: 844 };
const DESKTOP = { width: 1280, height: 860 };
const LABEL: Record<string, string> = { owner: "Owner", admin: "Admin", lead: "Lead", labor: "Labor", subcontractor: "Subcontractor" };
const NAME: Record<string, string> = { lead: "Lena Ortiz", labor: "Luis Moreno", owner: "Olivia Grant" };

async function as(browser: Browser, role: string, viewport = PHONE) {
  const phone = viewport === PHONE;
  const ctx = await browser.newContext({ viewport, isMobile: phone, hasTouch: phone, acceptDownloads: true });
  const page = await ctx.newPage();
  await page.goto("/login");
  await page.getByTestId("debug-login").getByRole("button", { name: LABEL[role], exact: true }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login") && !u.pathname.startsWith("/m/"), { timeout: 30_000 });
  await expect(page.getByRole("button", { name: /^(Sign out|Account: )/ }).locator("visible=true").first()).toBeVisible({ timeout: 30_000 });
  return { ctx, page };
}
const nav = (page: Page, label: string) => page.getByRole("button", { name: label, exact: true }).locator("visible=true").first();
const plus = (page: Page) => page.getByRole("button", { name: "Add text or photo" });
const entries = (page: Page) => page.getByTestId("entries").getByTestId("entry");
/** Times on screen use a narrow no-break space before AM/PM; the PDF writes a plain space. */
const plain = (s: string) => s.replace(/[\u202f\u00a0]/g, " ").trim();

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

async function laborDocSend(browser: Browser, value: boolean) {
  const owner = await as(browser, "owner", DESKTOP);
  expect((await call(owner.page, "setCompanySharing", { key: "labor_doc_send", value })).ok).toBe(true);
  await owner.ctx.close();
}

async function pdfOf(download: Download) {
  const bytes = new Uint8Array(readFileSync((await download.path())!));
  const raw = Buffer.from(bytes).toString("latin1");
  return { raw, text: extractPdfText(bytes).map(plain), name: download.suggestedFilename() };
}

/** A structurally valid PDF: header, EOF, and every xref offset lands on its "n 0 obj". */
function expectValidPdf(raw: string) {
  expect(raw.startsWith("%PDF-1.4\n")).toBe(true);
  expect(raw.trimEnd().endsWith("%%EOF")).toBe(true);
  const start = Number(/startxref\n(\d+)\n%%EOF/.exec(raw)![1]);
  expect(raw.slice(start, start + 4)).toBe("xref");
  const offsets = [...raw.slice(start).matchAll(/^(\d{10}) 00000 n $/gm)].map((m) => Number(m[1]));
  expect(offsets.length).toBeGreaterThan(5);
  offsets.forEach((at, i) => expect(raw.slice(at, at + `${i + 1} 0 obj`.length)).toBe(`${i + 1} 0 obj`));
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

test("labor (phone): the plus adds text and photo entries, in time order with times; they persist; no PDF while the setting is off", async ({ browser }) => {
  const { ctx, page } = await as(browser, "labor");
  // An empty report opens on one blank note ("Your day"), so you can just type.
  await expect(entries(page)).toHaveCount(1);
  await expect(page.locator("#narrative")).toHaveValue("");
  // Labor can't download with "Labor can send documents" off (the default): no button, a hint,
  // and the server refuses too.
  await expect(page.getByRole("button", { name: "Download PDF" })).toHaveCount(0);
  await expect(page.getByTestId("pdf-off")).toHaveText(/PDF download is off/);
  expect((await call(page, "getReportPdfData", { day: await today(page) })).error).toMatch(/can't do that/);

  // The plus is a big target in thumb reach: 56 px tall, full width, in the lower half of the screen.
  const box = (await plus(page).boundingBox())!;
  expect(box.height).toBeGreaterThanOrEqual(56);
  expect(box.width).toBeGreaterThanOrEqual(300);
  await page.locator("#narrative").fill("Framed the pantry wall.");
  await page.locator("#narrative").blur(); // autosave on blur
  await expect(page.getByRole("button", { name: "Saved", exact: true })).toBeVisible();
  await expect(entries(page).first().getByTestId("entry-time")).toHaveText(/^\d{1,2}:\d{2}\s?[AP]M$/);
  await plus(page).scrollIntoViewIfNeeded();
  const onScreen = (await plus(page).boundingBox())!;
  expect(onScreen.y + onScreen.height).toBeLessThanOrEqual(PHONE.height - 64); // above the tab bar
  expect(onScreen.y).toBeGreaterThan(PHONE.height / 2);

  await plus(page).click();
  const menu = page.getByRole("menu", { name: "Add to report" });
  await expect(menu.getByRole("menuitem")).toHaveText([/Text/, /Camera/, /Library/]);
  for (const item of await menu.getByRole("menuitem").all()) expect((await item.boundingBox())!.height).toBeGreaterThanOrEqual(56);
  await expect(menu.getByRole("menuitem", { name: /Text/ })).toBeFocused();
  // Escape closes the menu and puts focus back on the plus.
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await expect(plus(page)).toBeFocused();

  await plus(page).click();
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("menuitem", { name: /Library/ }).click();
  await (await chooser).setFiles("e2e/fixtures/site-photo.jpg");
  await expect(page.getByText(/^1 photo saved\./)).toBeVisible({ timeout: 20_000 });
  await expect(entries(page)).toHaveCount(2);

  await plus(page).click();
  await page.getByRole("menuitem", { name: /Text/ }).click();
  const fresh = entries(page).last().locator("textarea");
  await expect(fresh).toBeFocused(); // straight into typing
  await fresh.fill("Pantry door is a pocket door now.");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("button", { name: "Saved", exact: true })).toBeVisible();

  await expect(entries(page)).toHaveCount(3);
  const kinds = await entries(page).evaluateAll((els) => els.map((el) => el.getAttribute("data-kind")));
  expect(kinds).toEqual(["text", "photo", "text"]);
  // Each entry shows its time; the times never go backwards.
  const times = (await entries(page).getByTestId("entry-time").allTextContents()).map(plain);
  expect(times).toHaveLength(3);
  const minutes = times.map((t) => {
    const m = /(\d{1,2}):(\d{2})\s*([AP]M)/i.exec(t)!;
    return ((Number(m[1]) % 12) + (m[3].toUpperCase() === "PM" ? 12 : 0)) * 60 + Number(m[2]);
  });
  expect([...minutes].sort((a, b) => a - b)).toEqual(minutes);

  // Editing a note keeps its place and time (and still autosaves on blur).
  await page.locator("#narrative").fill("Framed the pantry wall and blocked for the shelves.");
  await page.locator("#narrative").blur();
  await expect(page.getByRole("button", { name: "Saved", exact: true })).toBeVisible();
  await expect(entries(page).first().getByTestId("entry-time")).toHaveText(new RegExp(`^${times[0].replace(/ /g, "\\s")}`));

  await page.reload();
  await expect(entries(page)).toHaveCount(3);
  await expect(page.locator("#narrative")).toHaveValue("Framed the pantry wall and blocked for the shelves.");
  await expect(entries(page).nth(1)).toHaveAttribute("data-kind", "photo");
  await expect(entries(page).last().locator("textarea")).toHaveValue("Pantry door is a pocket door now.");
  // The narrative everything else reads is the notes, in order.
  const mine = (await call(page, "getMyReport", { day: await today(page) })).value as { report: { narrative: string } };
  expect(mine.report.narrative).toBe("Framed the pantry wall and blocked for the shelves.\n\nPantry door is a pocket door now.");
  await ctx.close();
});

test("labor with “Labor can send documents” on: Download PDF while still writing — job, date, author, every entry with its time, photo embedded", async ({ browser }) => {
  await laborDocSend(browser, true);
  const { ctx, page } = await as(browser, "labor");
  await expect(entries(page)).toHaveCount(3);
  // Unsaved text goes into the PDF too (the editor saves first).
  await plus(page).click();
  await page.getByRole("menuitem", { name: /Text/ }).click();
  await entries(page).last().locator("textarea").fill('Unsaved line (about 4" gap) — still in the PDF.');
  await expect(page.getByRole("button", { name: "Submit my day" })).toBeVisible(); // not submitted
  const job = plain((await page.locator("#report-job option:checked").textContent()) ?? "");

  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download PDF" }).click();
  const pdf = await pdfOf(await downloading);
  expect(pdf.name).toMatch(/^daily-report-\d{4}-\d{2}-\d{2}-luis-moreno\.pdf$/);
  expectValidPdf(pdf.raw);
  expect((pdf.raw.match(/\/Subtype \/Image/g) ?? []).length).toBe(1);
  await expect(page.getByRole("button", { name: "Saved", exact: true })).toBeVisible();

  const times = (await entries(page).getByTestId("entry-time").allTextContents()).map(plain);
  expect(times).toHaveLength(4);
  const joined = pdf.text.join("\n");
  expect(pdf.text).toContain("Daily report");
  expect(pdf.text).toContain(`Author: ${NAME.labor}`);
  expect(pdf.text).toContain(`Job: ${job || "No job"}`);
  expect(joined).toMatch(/Date: \w+day, \w{3} \d{1,2}, \d{4}/);
  // every entry, in order, each under its own time stamp
  const order = [
    `${times[0]} · Note`,
    "Framed the pantry wall and blocked for the shelves.",
    `${times[1]} · Photo`,
    `${times[2]} · Note`,
    "Pantry door is a pocket door now.",
    `${times[3]} · Note`,
    'Unsaved line (about 4" gap) — still in the PDF.',
  ];
  let at = -1;
  for (const piece of order) {
    const next = joined.indexOf(piece, at + 1);
    expect(next, piece).toBeGreaterThan(at);
    at = next;
  }
  expect(joined).not.toMatch(/\$/); // no money in a report PDF
  await ctx.close();
  await laborDocSend(browser, false);
});

test("lead: a report written before entries reads as entries; once submitted it's read-only with no plus, and Download PDF still works", async ({ browser }) => {
  const { ctx, page } = await as(browser, "lead");
  await nav(page, "Today").click();
  await expect(page.getByText(/✓ Submitted at/)).toBeVisible();
  await expect(plus(page)).toHaveCount(0);
  const kinds = await entries(page).evaluateAll((els) => els.map((el) => el.getAttribute("data-kind")));
  expect(kinds.sort()).toEqual(["photo", "text"]);
  for (const field of await entries(page).locator("textarea").all()) await expect(field).toBeDisabled();
  const note = await entries(page).locator("textarea").inputValue();
  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download PDF" }).click();
  const pdf = await pdfOf(await downloading);
  expectValidPdf(pdf.raw);
  expect(pdf.text).toContain(`Author: ${NAME.lead}`);
  expect(pdf.text.join(" ")).toMatch(/Submitted \d{1,2}:\d{2}/);
  expect(pdf.text.join(" ")).toContain(note.split(" ").slice(0, 5).join(" "));
  expect((pdf.raw.match(/\/Subtype \/Image/g) ?? []).length).toBe(1);
  await ctx.close();
});

test("subcontractor: never downloads, even with “Labor can send documents” on (server refuses too)", async ({ browser }) => {
  await laborDocSend(browser, true);
  const sub = await as(browser, "subcontractor");
  await expect(entries(sub.page).first()).toBeVisible();
  await expect(sub.page.getByRole("button", { name: "Download PDF" })).toHaveCount(0);
  await expect(sub.page.getByTestId("pdf-off")).toBeVisible();
  expect((await call(sub.page, "getReportPdfData", { day: await today(sub.page) })).error).toMatch(/can't do that/);
  await sub.ctx.close();
  await laborDocSend(browser, false);
});

for (const role of ["owner", "admin"] as const) {
  test(`${role}: no editor; Download PDF on any report in Reports (photos embedded); Lead and Sub can't fetch it by id`, async ({ browser }) => {
    const { ctx, page } = await as(browser, role, DESKTOP);
    // Owner/Admin review; they don't write reports (no Today tab, no editor).
    await expect(page.getByRole("navigation").getByRole("button", { name: "Today", exact: true })).toHaveCount(0);
    await expect(page.getByRole("navigation").getByRole("button", { name: "Reports", exact: true })).toHaveCount(1);
    await expect(plus(page)).toHaveCount(0);
    await nav(page, "Reports").click();
    await page.getByRole("button", { name: "7 days" }).click();
    const seeded = page
      .getByTestId("report-card")
      .filter({ hasText: "Luis Moreno" })
      .filter({ hasText: /Submitted/ })
      .filter({ has: page.locator("[data-photo-id]") })
      .last();
    await expect(seeded).toBeVisible({ timeout: 30_000 });
    // Pin the card by id: the list can re-render while the filter loads.
    const id = (await seeded.getAttribute("id"))!.replace(/^report-/, "");
    const card = page.locator(`[id="report-${id}"]`);
    const photos = await card.locator("[data-photo-id]").count();
    expect(photos).toBeGreaterThan(0);
    const downloading = page.waitForEvent("download");
    await card.getByRole("button", { name: "Download PDF" }).click();
    const pdf = await pdfOf(await downloading);
    expectValidPdf(pdf.raw);
    expect(pdf.text).toContain(`Author: ${NAME.labor}`);
    expect(pdf.text.join(" ")).toMatch(/Submitted \d{1,2}:\d{2}/);
    expect((pdf.raw.match(/\/Subtype \/Image/g) ?? []).length).toBe(photos);
    const narrative = plain((await card.locator("p.whitespace-pre-wrap").textContent()) ?? "");
    expect(pdf.text.join(" ")).toContain(narrative.split(" ").slice(0, 6).join(" "));
    await ctx.close();

    // Someone else's report by id is refused for Lead (even its author's lead) and for other field roles.
    for (const other of ["lead", "subcontractor"]) {
      const s = await as(browser, other);
      expect((await call(s.page, "getReportPdfData", { reportId: id })).error).toMatch(/can't do that/);
      await s.ctx.close();
    }
  });
}

// Regression (#18 + this PR): /reports/<id> (reviewReport) hydrates with the viewer, so it carries
// the report's entries and the viewer's PDF flag. Route permissions stay principals-only.
test("/reports/<id>: Owner/Admin get the report with its entries and canPdf; Lead, Labor and Sub are refused", async ({ browser }) => {
  const owner = await as(browser, "owner", DESKTOP);
  const id = await owner.page.evaluate(async () => {
    const mod = await import("/src/lib/server/fns.ts");
    const day = (d: Date) => d.toLocaleDateString("en-CA");
    const to = new Date();
    const from = new Date(to);
    from.setDate(from.getDate() - 14);
    const list = await mod.reviewReports({ data: { from: day(from), to: day(to), projectId: "", personId: "" } });
    return list.reports.find((r) => r.userName === "Luis Moreno" && r.submittedAt && r.photos.length > 0)?.id ?? "";
  });
  expect(id).not.toBe("");
  await owner.ctx.close();

  for (const role of ["owner", "admin"] as const) {
    const { ctx, page } = await as(browser, role, DESKTOP);
    const got = await call(page, "reviewReport", { id });
    expect(got.ok, role).toBe(true);
    const report = got.value as { id: string; canPdf: boolean; entries: { kind: string; photoId: string | null }[]; photos: { id: string }[]; narrative: string };
    expect(report.id).toBe(id);
    expect(report.canPdf, role).toBe(true);
    expect(report.entries.filter((e) => e.kind === "photo").map((e) => e.photoId).sort()).toEqual(report.photos.map((p) => p.id).sort());
    expect(report.entries.some((e) => e.kind === "text")).toBe(report.narrative.trim() !== "");
    // The page itself: its own URL and title, and a working Download PDF for that report.
    await page.goto(`/reports/${id}`);
    await expect(page).toHaveTitle(/report, .* · Reports · RCL$/);
    const card = page.locator(`[id="report-${id}"]`);
    await expect(card).toBeVisible({ timeout: 30_000 });
    const downloading = page.waitForEvent("download");
    await card.getByRole("button", { name: "Download PDF" }).click();
    const pdf = await pdfOf(await downloading);
    expectValidPdf(pdf.raw);
    expect(pdf.text).toContain(`Author: ${NAME.labor}`);
    expect((pdf.raw.match(/\/Subtype \/Image/g) ?? []).length).toBe(report.photos.length);
    await ctx.close();
  }
  for (const role of ["lead", "labor", "subcontractor"]) {
    const { ctx, page } = await as(browser, role);
    const got = await call(page, "reviewReport", { id });
    expect(got.ok, role).toBe(false);
    expect(got.error, role).toMatch(/can't do that|Only an owner or admin/);
    await ctx.close();
  }
});
