import assert from "node:assert/strict";
import { test } from "node:test";
import { PHOTO_UNDO_MS, planPhotoRemove } from "./photo-remove.ts";

test("a pending photo is dropped and a saved photo waits 5 seconds", () => {
  assert.deepEqual(planPhotoRemove(false), { kind: "drop" });
  assert.deepEqual(planPhotoRemove(true), { kind: "undo", ms: 5_000 });
  assert.equal(PHOTO_UNDO_MS, 5_000);
});
