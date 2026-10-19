// Preloaded by scripts/run-unit-tests.mjs (node --import). Routes `node:test` through a shim
// that marks the tests in quarantine.json as skipped, with their reason, so they still show
// up in the report as "# SKIP quarantined: ..." instead of disappearing.
import { register } from "node:module";

register("./hooks.mjs", import.meta.url);
