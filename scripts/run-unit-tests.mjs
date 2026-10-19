#!/usr/bin/env node
// Runs every unit test (src/**/*.test.ts and scripts/**/*.test.mjs) with node:test.
// Tests listed in test/quarantine/quarantine.json are reported as skipped, never silently dropped:
// each entry carries a reason and a tracking issue. Extra args pass through to node --test.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const quarantine = JSON.parse(readFileSync(new URL("../test/quarantine/quarantine.json", import.meta.url), "utf8"));
if (quarantine.tests.length) {
  console.log(`[unit] ${quarantine.tests.length} quarantined test(s) are reported as SKIP. Reasons: test/quarantine/quarantine.json. Tracking: ${quarantine.issue}`);
}
const args = [
  "--experimental-strip-types",
  "--disable-warning=ExperimentalWarning",
  "--test",
  "--import=./test/quarantine/register.mjs",
  ...process.argv.slice(2),
  "src/**/*.test.ts",
  "scripts/**/*.test.mjs",
  "test/**/*.test.mjs",
];
const run = spawnSync(process.execPath, args, { stdio: "inherit" });
process.exit(run.status ?? 1);
