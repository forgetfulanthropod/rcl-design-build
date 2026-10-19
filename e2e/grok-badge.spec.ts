import { expect, test, type Browser, type Page } from "@playwright/test";

// Spec 05 · F6 (option B, pending Charlie's decision): the "Created with Grok" badge stays, and
// no button or link sits under it. Dev and CI have no project id, so the real extensions.js
// never mounts there; this stub reproduces its geometry as shipped (pill: fixed, top 8px,
// centred, 36px tall; phones/touch: a 44px top bar plus a spacer at the top of <body>).
const BADGE_STUB = () => {
  const MOBILE = "(max-width: 767px), (hover: none) and (pointer: coarse)";
  const mount = () => {
    if (document.querySelector("[data-created-with-grok-banner]")) return;
    const style = document.createElement("style");
    style.textContent =
      ":root{--grok-banner-h:0px}[data-created-with-grok-banner]{pointer-events:none;position:fixed;top:8px;left:0;right:0;z-index:2147483647;display:flex;justify-content:center}" +
      "[data-created-with-grok-spacer]{display:none;height:0}" +
      `@media ${MOBILE}{:root{--grok-banner-h:44px}[data-created-with-grok-banner]{top:0}[data-created-with-grok-spacer]{display:block;height:var(--grok-banner-h)}}`;
    document.head.appendChild(style);
    const host = document.createElement("div");
    host.setAttribute("data-created-with-grok-banner", "");
    const shadow = host.attachShadow({ mode: "open" });
    const mobile = window.matchMedia(MOBILE).matches;
    shadow.innerHTML = mobile
      ? '<a href="#" style="pointer-events:auto;display:flex;box-sizing:border-box;width:100vw;height:44px;align-items:center;justify-content:center;background:#000;color:#fff;font:13px system-ui">Created with Grok · Remix</a>'
      : '<a href="#" style="pointer-events:auto;display:flex;height:36px;width:230px;align-items:center;justify-content:center;border-radius:9999px;background:#000;color:#fff;font:13px system-ui">Created with Grok · Remix</a>';
    document.body.appendChild(host);
    if (mobile) {
      const spacer = document.createElement("div");
      spacer.setAttribute("data-created-with-grok-spacer", "");
      document.body.insertBefore(spacer, document.body.firstChild);
    }
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount);
  else mount();
};

const LABEL: Record<string, string> = { owner: "Owner", admin: "Admin", lead: "Lead", labor: "Labor", subcontractor: "Subcontractor" };
const WIDTHS = [
  { width: 390, height: 844, mobile: true },
  { width: 768, height: 1024, mobile: false },
  { width: 1440, height: 900, mobile: false },
];

async function as(browser: Browser, role: string, vp: (typeof WIDTHS)[number]) {
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, isMobile: vp.mobile, hasTouch: vp.mobile });
  await ctx.addInitScript(BADGE_STUB);
  const page = await ctx.newPage();
  await page.goto("/login");
  await page.getByTestId("debug-login").getByRole("button", { name: LABEL[role], exact: true }).click();
  await page.waitForURL((u) => u.pathname === "/", { timeout: 30_000 });
  await expect(page.locator("[data-desk-header]")).toBeVisible({ timeout: 30_000 });
  await expect(page.locator("[data-created-with-grok-banner]")).toHaveCount(1);
  return { ctx, page };
}

/** Buttons and links (in the viewport) whose centre point lands on the badge. */
async function coveredControls(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const badge = document.querySelector("[data-created-with-grok-banner]");
    const out: string[] = [];
    for (const el of document.querySelectorAll<HTMLElement>("button, a[href], [role=button], [role=tab], input, select, textarea")) {
      if (badge?.contains(el)) continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      const x = r.left + r.width / 2;
      const y = r.top + r.height / 2;
      if (x < 0 || y < 0 || x > innerWidth || y > innerHeight) continue;
      const hit = document.elementFromPoint(x, y);
      if (hit && badge && (hit === badge || badge.contains(hit))) out.push((el.getAttribute("aria-label") || el.textContent || el.tagName).trim().slice(0, 40));
    }
    return out;
  });
}

const NAV_LABELS = ["Today", "My reports", "Reports", "Attention", "Activities", "Docs", "Safety", "Team"];

for (const role of ["owner", "lead", "labor", "subcontractor"] as const) {
  for (const vp of WIDTHS) {
    test(`badge never covers a control (${role}, ${vp.width}px), on every desk view`, async ({ browser }) => {
      const { ctx, page } = await as(browser, role, vp);
      const seen: string[] = [];
      for (const label of NAV_LABELS) {
        const button = page.getByRole("button", { name: label, exact: true }).locator("visible=true").first();
        if (!(await button.count())) continue; // not on this role's desk
        await button.click();
        await page.waitForTimeout(300);
        seen.push(label);
        expect(await coveredControls(page), `${label} at ${vp.width}px`).toEqual([]);
      }
      expect(seen.length).toBeGreaterThan(1);
      // The badge itself is still there and visible (AGENTS.md: never hide it).
      await expect(page.locator("[data-created-with-grok-banner]")).toBeVisible();
      await ctx.close();
    });
  }
}

test("badge never covers the header actions for a long display name at 768–1024px", async ({ browser }) => {
  const { magicSignIn } = await import("./helpers");
  for (const width of [768, 820, 1024]) {
    const ctx = await browser.newContext({ viewport: { width, height: 900 } });
    await ctx.addInitScript(BADGE_STUB);
    const page = await ctx.newPage();
    const id = `${Date.now()}${width}`;
    await magicSignIn(page, `long-${id}@example.test`, "Christopher Montgomery-Whitfield");
    await page.locator("#setup-co").fill(`Long Name Co ${id}`);
    await page.getByRole("button", { name: "Create the desk" }).click();
    await expect(page.locator("[data-desk-header]")).toBeVisible({ timeout: 30_000 });
    await page.waitForTimeout(300);
    expect(await coveredControls(page), `${width}px`).toEqual([]);
    await expect(page.locator("[data-created-with-grok-banner]")).toBeVisible();
    await ctx.close();
  }
});
