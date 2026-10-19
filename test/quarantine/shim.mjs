import { readFileSync } from "node:fs";
import * as real from "node:test";

const list = JSON.parse(readFileSync(new URL("./quarantine.json", import.meta.url), "utf8"));
const reasons = new Map(list.tests.map((t) => [t.name, `quarantined: ${t.reason} Tracking: ${list.issue}`]));

function wrap(fn) {
  const wrapped = (...args) => {
    const name = typeof args[0] === "string" ? args[0] : null;
    if (name && reasons.has(name)) {
      const opts = typeof args[1] === "object" && args[1] !== null ? args[1] : {};
      const body = args.find((a) => typeof a === "function");
      return fn(name, { ...opts, skip: reasons.get(name) }, body);
    }
    return fn(...args);
  };
  return Object.assign(wrapped, fn);
}

export const test = wrap(real.test);
export const it = wrap(real.it);
export const { describe, suite, before, after, beforeEach, afterEach, mock, run } = real;
export const snapshot = real.snapshot;
export default test;
