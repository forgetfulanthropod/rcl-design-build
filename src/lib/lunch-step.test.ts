import assert from "node:assert/strict";
import { test } from "node:test";
import { lunchStepScroll } from "./lunch-step.ts";

test("the lunch step centers in the viewport, smoothly unless reduced motion is on", () => {
  assert.deepEqual(lunchStepScroll(false), { block: "center", behavior: "smooth" });
  assert.deepEqual(lunchStepScroll(true), { block: "center", behavior: "auto" });
});
