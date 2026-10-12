import { expect, test } from "@playwright/test";
import { createJob, inviteByEmail, newAdmin, openView, uid } from "./helpers";


test("magic-link sign-in and company setup", async ({ browser }) => {
  const { page, context } = await newAdmin(browser);
  await expect(page.getByText(/Desk/).first()).toBeVisible();
  await context.close();
});

test("magic links are single-use", async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  const id = uid();
  await page.goto("/login");
  await page.getByRole("button", { name: "Email", exact: true }).click();
  await page.locator("#dest").fill(`once-${id}@example.test`);
  await page.getByRole("button", { name: /Email me a link/ }).click();
  const href = await page.getByRole("link", { name: "Open the magic link" }).getAttribute("href");
  await page.goto(href!);
  await page.waitForURL((u) => !u.pathname.startsWith("/m/"));
  const second = await browser.newContext();
  const p2 = await second.newPage();
  await p2.goto(href!);
  await expect(p2.getByText(/not valid|used|expired/i).first()).toBeVisible();
  await context.close();
  await second.close();
});

test("add an employee (crew invite) and the employee signs in", async ({ browser }) => {
  const { page, context, id } = await newAdmin(browser);
  const email = `tech-${id}@example.test`;
  const link = await inviteByEmail(page, `Tech ${id}`, email);
  // Note: an invitee is not listed under People until they open the link (no "pending" list).
  const emp = await browser.newContext();
  const ep = await emp.newPage();
  await ep.goto(link);
  await ep.waitForURL((u) => !u.pathname.startsWith("/m/"));
  await expect(ep.getByRole("button", { name: "Field" }).first()).toBeVisible();
  await openView(ep, "Crew");
  await expect(ep.getByText(/Only an admin can send/)).toBeVisible();
  await page.reload();
  await openView(page, "Crew");
  await expect(page.getByText(`Tech ${id}`).first()).toBeVisible();
  await emp.close();
  await context.close();
});

test.skip("remove an employee", async () => {
  // NOT IMPLEMENTED in the app: there is no remove/deactivate crew action in
  // src/lib/server/data.server.ts or CrewView. Unskip once it exists.
});

test("create and edit an activity (work order) assigned to an employee", async ({ browser }) => {
  const { page, context, id } = await newAdmin(browser);
  const link = await inviteByEmail(page, `Tech ${id}`, `tech-${id}@example.test`);
  const emp = await browser.newContext();
  const ep = await emp.newPage();
  await ep.goto(link);
  await ep.waitForURL((u) => !u.pathname.startsWith("/m/"));
  await page.reload();
  await openView(page, "Field");
  const title = `Replace RTU belt ${id}`;
  await page.getByPlaceholder("Customer").fill("Acme");
  await page.getByPlaceholder("Site").fill("12 Main");
  await page.getByPlaceholder("Work order").fill(title);
  await page.getByPlaceholder("Notes for the tech").fill("Bring belts");
  await page.getByRole("button", { name: "Dispatch" }).click();
  // UX finding: the first work order isn't auto-selected after dispatch; the card must be tapped.
  await page.getByRole("button", { name: new RegExp(title) }).click();
  await expect(page.getByRole("heading", { name: title })).toBeVisible();

  const editor = page.locator("form", { has: page.getByRole("heading", { name: title }) });
  const selects = editor.locator("select");
  const statusOptions = await selects.nth(0).locator("option").allTextContents();
  await selects.nth(0).selectOption({ label: statusOptions[1] });
  await selects.nth(2).selectOption({ label: `Tech ${id}` });
  await editor.locator("textarea").fill("Belts swapped, test run OK");
  await editor.getByRole("button").last().click();
  await expect(page.getByText(`Tech ${id}`).first()).toBeVisible();
  await page.reload();
  await openView(page, "Field");
  await expect(page.getByText(title).first()).toBeVisible();
  await expect(page.locator("section", { hasText: statusOptions[1] }).getByText(title)).toBeVisible();
  // The employee sees the activity on their own Field board.
  await ep.reload();
  await openView(ep, "Field");
  await expect(ep.getByText(title).first()).toBeVisible();
  await emp.close();
  await context.close();
});

test.skip("delete an activity (work order)", async () => {
  // NOT IMPLEMENTED: no delete action for work orders or daily logs exists.
});

test("log a daily activity on a job", async ({ browser }) => {
  const { page, context, id } = await newAdmin(browser);
  const job = `Kitchen ${id}`;
  await createJob(page, job);
  await page.getByPlaceholder("Weather").fill("Sunny 70F");
  await page.getByPlaceholder("What happened").fill(`Framing done ${id}`);
  await page.getByPlaceholder("What happened").locator("xpath=ancestor::form").getByRole("button").last().click();
  await expect(page.getByText(`Framing done ${id}`)).toBeVisible();
  await context.close();
});

test("archive a job", async ({ browser }) => {
  const { page, context, id } = await newAdmin(browser);
  const job = `Archive me ${id}`;
  await createJob(page, job);
  await page.getByRole("button", { name: "Archive job" }).click();
  await expect(page.getByRole("button", { name: "Archive job" })).toHaveCount(0);
  await page.reload();
  await openView(page, "Jobs");
  await expect(page.getByText(job).first()).toBeVisible();
  await context.close();
});

test.skip("search the archive", async () => {
  // NOT IMPLEMENTED: archived jobs are only sorted to the bottom of the job list; there is no search.
});
test.skip("upload photos", async () => {
  // NOT IMPLEMENTED: no file/photo upload anywhere (no <input type=file>, no storage).
});
test.skip("submit a bid", async () => {
  // NOT IMPLEMENTED: no bid/estimate entity. Closest is change orders on a job.
});
test.skip("upload a takeoff spreadsheet", async () => {
  // NOT IMPLEMENTED: no spreadsheet import. Fixture kept at e2e/fixtures/takeoff-sample.csv for when it lands.
});

test("RFI and change order on a job", async ({ browser }) => {
  const { page, context, id } = await newAdmin(browser);
  await createJob(page, `RFI job ${id}`);
  await page.getByPlaceholder("RFI title").fill(`Beam size ${id}`);
  await page.getByPlaceholder("Question").fill("W8 or W10?");
  await page.getByPlaceholder("Question").locator("xpath=ancestor::form").getByRole("button").last().click();
  await expect(page.getByText(`Beam size ${id}`)).toBeVisible();
  await page.getByPlaceholder("Change title").fill(`Extra outlet ${id}`);
  await page.getByPlaceholder("Amount").fill("450");
  await page.getByPlaceholder("Amount").locator("xpath=ancestor::form").getByRole("button").last().click();
  await expect(page.getByText(`Extra outlet ${id}`)).toBeVisible();
  await context.close();
});

test("milestone add and toggle", async ({ browser }) => {
  const { page, context, id } = await newAdmin(browser);
  await createJob(page, `MS job ${id}`);
  await page.getByPlaceholder("New milestone").fill(`Rough-in ${id}`);
  await page.getByPlaceholder("New milestone").locator("xpath=ancestor::form").getByRole("button").last().click();
  const box = page.getByRole("checkbox", { name: new RegExp(`Rough-in ${id}`) });
  await expect(box).toBeVisible();
  await box.click();
  await expect(box).toBeChecked();
  await page.reload();
  await openView(page, "Jobs");
  await expect(page.getByRole("checkbox", { name: new RegExp(`Rough-in ${id}`) })).toBeChecked();
  await context.close();
});
