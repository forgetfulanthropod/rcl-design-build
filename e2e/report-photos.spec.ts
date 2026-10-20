import { expect, test, type Browser, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { extractPdfText } from "../src/lib/pdf";

// Charlie (Oct 20): "When you add photos uploading from your phone needs to be an option."
// The plus offers Camera (take a new one) and Library (pick existing ones, several at once, no
// forced capture). Each photo is its own time-stamped entry; the camera's EXIF time shows as
// "taken …"; iPhone HEIC is converted to JPEG so it shows in the app and the PDF; big photos are
// downscaled and compressed, and files over 40 MB are refused before upload.
const PHONE = { width: 390, height: 844 };
const DESKTOP = { width: 1280, height: 860 };
const LABEL: Record<string, string> = { owner: "Owner", admin: "Admin", lead: "Lead", labor: "Labor", subcontractor: "Subcontractor" };

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
const photoEntries = (page: Page) => page.getByTestId("entries").locator('[data-testid="entry"][data-kind="photo"]:not([data-pending])');
const plain = (s: string) => s.replace(/[\u202f\u00a0]/g, " ").trim();
const today = (page: Page) =>
  page.evaluate(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  });

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

const JPEG_URL = `data:image/jpeg;base64,${readFileSync("e2e/fixtures/site-photo.jpg").toString("base64")}`;
const photoArgs = (day: string) => ({ day, image: JPEG_URL, thumb: JPEG_URL, width: 1200, height: 900, takenAt: "" });

/** Open a photo entry's full-size image; returns [naturalWidth, naturalHeight, data-URL prefix, base64 length]. */
async function fullPhoto(page: Page, index: number) {
  await photoEntries(page).nth(index).locator("[data-photo-id]").click();
  const full = page.getByTestId("photo-full");
  await expect(full).toBeVisible({ timeout: 20_000 });
  const info = await full.evaluate((img: HTMLImageElement) => [img.naturalWidth, img.naturalHeight, img.src.slice(0, 23), img.src.length] as const);
  await page.getByRole("button", { name: "Close" }).click();
  await expect(page.getByTestId("photo-viewer")).toHaveCount(0);
  return info;
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

test("Camera takes a new photo; Library picks existing ones (several at once, no forced camera)", async ({ browser }) => {
  const { ctx, page } = await as(browser, "labor");
  // The inputs behind the two choices: Library has no `capture` (so the phone shows its library) and allows many.
  await expect(page.getByTestId("photo-input")).not.toHaveAttribute("capture", /.*/);
  await expect(page.getByTestId("photo-input")).toHaveAttribute("multiple", "");
  await expect(page.getByTestId("photo-input")).toHaveAttribute("accept", /image\/\*/);
  await expect(page.getByTestId("camera-input")).toHaveAttribute("capture", "environment");

  await plus(page).click();
  let chooser = page.waitForEvent("filechooser");
  await page.getByRole("menuitem", { name: /Camera/ }).click();
  const camera = await chooser;
  expect(camera.isMultiple()).toBe(false);
  await camera.setFiles("e2e/fixtures/site-photo.jpg");
  await expect(photoEntries(page)).toHaveCount(1, { timeout: 20_000 });

  await plus(page).click();
  chooser = page.waitForEvent("filechooser");
  await page.getByRole("menuitem", { name: /Library/ }).click();
  const library = await chooser;
  expect(library.isMultiple()).toBe(true);
  // Three at once, one of them an iPhone HEIC and one with a camera EXIF time.
  await library.setFiles(["e2e/fixtures/site-photo.jpg", "e2e/fixtures/exif-photo.jpg", "e2e/fixtures/site-photo.heic"]);
  await expect(photoEntries(page)).toHaveCount(4, { timeout: 30_000 });
  await expect(page.getByText(/^4 photos saved\./)).toBeVisible();
  await expect(page.getByTestId("entries").locator("[data-pending]")).toHaveCount(0);

  // Each photo is its own entry with its own time (when it was added), in time order.
  const stamps = (await photoEntries(page).getByTestId("entry-time").allTextContents()).map(plain);
  expect(stamps).toHaveLength(4);
  for (const s of stamps) expect(s).toMatch(/^\d{1,2}:\d{2} [AP]M/);
  // The EXIF one also shows when the camera took it (06:45 in the camera's clock).
  expect(stamps.filter((s) => /· taken (\w{3} \d{1,2}, )?6:45 AM$/.test(s))).toHaveLength(1);

  // Every photo renders, the HEIC included (converted to JPEG): thumbnails decode, full size is JPEG.
  const thumbs = await photoEntries(page).locator("[data-photo-id] img").evaluateAll((imgs) =>
    (imgs as HTMLImageElement[]).map((img) => img.complete && img.naturalWidth > 0),
  );
  expect(thumbs).toEqual([true, true, true, true]);
  // (Chrome can't decode HEIC itself, so the HEIC one showing at all means it was converted.)
  for (let i = 0; i < 4; i += 1) {
    const [w, h, prefix] = await fullPhoto(page, i);
    expect(prefix, `photo ${i}`).toBe("data:image/jpeg;base64,");
    expect(w * h, `photo ${i}`).toBeGreaterThan(0);
  }
  const mine = (await call(page, "getMyReport", { day: await today(page) })).value as { report: { photos: { takenAt: string | null }[] } };
  expect(mine.report.photos.filter((p) => p.takenAt)).toHaveLength(1); // only the EXIF time is stored as "taken"
  await ctx.close();
});

test("the PDF embeds every photo, HEIC included, with its added time and EXIF taken time", async ({ browser }) => {
  const owner = await as(browser, "owner", DESKTOP);
  expect((await call(owner.page, "setCompanySharing", { key: "labor_doc_send", value: true })).ok).toBe(true);
  await owner.ctx.close();
  const { ctx, page } = await as(browser, "labor");
  await expect(photoEntries(page)).toHaveCount(4);
  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download PDF" }).click();
  const file = await (await downloading).path();
  const bytes = new Uint8Array(readFileSync(file!));
  const raw = Buffer.from(bytes).toString("latin1");
  expect((raw.match(/\/Subtype \/Image/g) ?? []).length).toBe(4);
  const text = extractPdfText(bytes).map(plain);
  expect(text.filter((t) => / · Photo$/.test(t))).toHaveLength(4);
  expect(text.filter((t) => /· taken (\w{3} \d{1,2}, )?6:45 AM · Photo$/.test(t))).toHaveLength(1);
  await ctx.close();
  const off = await as(browser, "owner", DESKTOP);
  expect((await call(off.page, "setCompanySharing", { key: "labor_doc_send", value: false })).ok).toBe(true);
  await off.ctx.close();
});

test("large photos: a ~20 MP photo is downscaled to 1600 px and compressed under 3 MB; over 40 MB is refused", async ({ browser }) => {
  const { ctx, page } = await as(browser, "labor");
  const before = 4; // from the first test
  await expect(photoEntries(page)).toHaveCount(before);
  // A 5000×3750 high-detail JPEG made in the browser (noise compresses badly: the worst case).
  const big = await page.evaluate(async () => {
    const c = document.createElement("canvas");
    c.width = 5000;
    c.height = 3750;
    const g = c.getContext("2d")!;
    const tile = g.createImageData(500, 375);
    for (let i = 0; i < tile.data.length; i += 4) {
      tile.data[i] = Math.random() * 255;
      tile.data[i + 1] = Math.random() * 255;
      tile.data[i + 2] = Math.random() * 255;
      tile.data[i + 3] = 255;
    }
    for (let x = 0; x < 10; x += 1) for (let y = 0; y < 10; y += 1) g.putImageData(tile, x * 500, y * 375);
    const blob = await new Promise<Blob>((r) => c.toBlob((b) => r(b!), "image/jpeg", 0.95));
    const buf = new Uint8Array(await blob.arrayBuffer());
    let s = "";
    for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    return btoa(s);
  });
  const buffer = Buffer.from(big, "base64");
  expect(buffer.length).toBeGreaterThan(5 * 1024 * 1024);
  await page.getByTestId("photo-input").setInputFiles({ name: "IMG_big.jpg", mimeType: "image/jpeg", buffer });
  await expect(photoEntries(page)).toHaveCount(before + 1, { timeout: 60_000 });
  const [w, h, prefix, length] = await fullPhoto(page, before);
  expect([w, h, prefix]).toEqual([1600, 1200, "data:image/jpeg;base64,"]);
  expect(((length - 23) * 3) / 4).toBeLessThanOrEqual(3 * 1024 * 1024);

  // Over 40 MB: refused before upload with a clear message, and nothing is added.
  await page.getByTestId("photo-input").setInputFiles({ name: "huge.jpg", mimeType: "image/jpeg", buffer: Buffer.alloc(41 * 1024 * 1024, 1) });
  await expect(page.getByText("That photo is 41 MB. Photos up to 40 MB can be added.")).toBeVisible();
  await expect(page.getByTestId("entries").locator("[data-pending]")).toHaveCount(0);
  await expect(photoEntries(page)).toHaveCount(before + 1);
  // A file that isn't an image is refused too (and can be retried or left).
  await page.getByTestId("photo-input").setInputFiles({ name: "notes.jpg", mimeType: "image/jpeg", buffer: Buffer.from("not a photo") });
  await expect(page.getByText("That file isn't a photo this phone can read.")).toBeVisible({ timeout: 20_000 });
  await expect(photoEntries(page)).toHaveCount(before + 1);
  await ctx.close();
});

test("who can upload: Labor/Lead/Sub add to their own open report only; a submitted report, Owner/Admin's desk and signed-out calls can't", async ({ browser }) => {
  // Lead and Sub: today's report is already submitted, so there's no plus and the server refuses.
  for (const role of ["lead", "subcontractor"]) {
    const { ctx, page } = await as(browser, role);
    if (role === "lead") await nav(page, "Today").click();
    await expect(page.getByText(/✓ Submitted at/)).toBeVisible();
    await expect(plus(page)).toHaveCount(0);
    const res = await call(page, "addMyPhoto", photoArgs(await today(page)));
    expect(res.error, role).toMatch(/already submitted/);
    await ctx.close();
  }
  // Labor uploads land in Labor's own report, never anyone else's.
  const labor = await as(browser, "labor");
  const day = await today(labor.page);
  const added = await call(labor.page, "addMyPhoto", photoArgs(day));
  expect(added.ok).toBe(true);
  const report = (added.value as { report: { userName: string; photos: unknown[] } }).report;
  expect(report.userName).toBe("Luis Moreno");
  await labor.ctx.close();
  const lead = await as(browser, "lead");
  const leads = (await call(lead.page, "getMyReport", { day })).value as { report: { photos: unknown[] } };
  expect(leads.report.photos).toHaveLength(1); // the seeded one only
  await lead.ctx.close();

  // Owner/Admin review; they have no editor to add photos from.
  for (const role of ["owner", "admin"]) {
    const { ctx, page } = await as(browser, role, DESKTOP);
    await expect(page.getByRole("navigation").getByRole("button", { name: "Today", exact: true })).toHaveCount(0);
    await expect(plus(page)).toHaveCount(0);
    await expect(page.getByTestId("photo-input")).toHaveCount(0);
    await ctx.close();
  }
  // Signed out: refused.
  const anon = await browser.newContext();
  const page = await anon.newPage();
  await page.goto("/login");
  expect((await call(page, "addMyPhoto", photoArgs(day))).ok).toBe(false);
  await anon.close();
});
