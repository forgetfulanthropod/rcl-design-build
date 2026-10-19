// Keeps the quarantine honest: every entry must name a real test in its file, give a reason,
// and point at a tracking issue. A stale entry (test renamed or fixed) fails here.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const root = new URL("../../", import.meta.url);
const list = JSON.parse(readFileSync(new URL("./quarantine.json", import.meta.url), "utf8"));

test("quarantine has a tracking issue", () => {
  assert.match(list.issue, /^https:\/\/github\.com\/.+\/issues\/\d+$|^TRACKING_ISSUE_URL$/);
});

for (const entry of list.tests) {
  test(`quarantined test still exists: ${entry.name}`, () => {
    assert.ok(entry.reason && entry.reason.length > 10, "needs a reason");
    const source = readFileSync(new URL(entry.file, root), "utf8");
    assert.ok(source.includes(JSON.stringify(entry.name)) || source.includes(`'${entry.name}'`) || source.includes(`\`${entry.name}\``), `${entry.file} has no test named ${entry.name}`);
  });
}
