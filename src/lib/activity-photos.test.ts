import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ACTIVITY_PHOTO_MAX_BYTES,
  activityPhotoMessage,
  addActivityPhotos,
  canAddActivityPhoto,
  knownActivityRoles,
  settlePhotoRead,
  tryStore,
} from "./activity-photos.ts";

test("every role can add a photo to their own activity log", () => {
  for (const role of knownActivityRoles()) {
    assert.equal(canAddActivityPhoto(role), true, role || "(signed out)");
  }
  assert.equal(canAddActivityPhoto(null), true);
  assert.equal(canAddActivityPhoto(undefined), true);
});

test("a full browser or a blocked read is not a role permission error", () => {
  const quota = tryStore(() => {
    throw new DOMException("The quota has been exceeded.", "QuotaExceededError");
  });
  assert.match(quota ?? "", /browser is full/);
  assert.doesNotMatch(quota ?? "", /permission|role can't|own report|doc\.send/i);

  const blocked = activityPhotoMessage(new DOMException("The request is not allowed by the user agent.", "NotAllowedError"));
  assert.match(blocked, /blocked reading that photo/);
  assert.doesNotMatch(blocked, /role can't|own report|doc\.send/);

  const role = activityPhotoMessage(new Error("Your role can't do that (doc.send)."));
  assert.equal(role, "This photo stays on this device with your log.");
  assert.doesNotMatch(role, /role can't|doc\.send/);

  const own = activityPhotoMessage(new Error("You can only remove photos from your own report."));
  assert.doesNotMatch(own, /own report|permission/i);
});

test("one photo that never finishes does not stall the batch, and a thrown save is just that photo", async () => {
  await assert.rejects(settlePhotoRead(new Promise(() => {}), 30), /too long/);

  const reads = new Map<string, "ok" | "throw" | "hang">([
    ["a.jpg", "ok"],
    ["b.jpg", "throw"],
    ["slow.heic", "hang"],
    ["c.jpg", "ok"],
  ]);
  let stored = 0;
  const result = await addActivityPhotos({
    files: [...reads.keys()].map((name) => ({ name })),
    nameOf: (file) => file.name,
    read: async (file) => {
      const mode = reads.get(file.name);
      if (mode === "hang") return settlePhotoRead(new Promise(() => {}), 30);
      if (mode === "throw") throw new Error("That file isn't a photo this phone can read.");
      return file.name;
    },
    store: (name) => {
      stored += 1;
      if (name === "c.jpg") throw new DOMException("The quota has been exceeded.", "QuotaExceededError");
    },
  });
  assert.deepEqual(result.saved, ["a.jpg"]);
  assert.equal(result.failed.length, 3);
  assert.match(result.failed[0].message, /isn't a photo/);
  assert.match(result.failed[1].message, /too long/);
  assert.match(result.failed[2].message, /browser is full/);
  assert.equal(stored, 2);
  assert.ok(ACTIVITY_PHOTO_MAX_BYTES * 24 < 5 * 1024 * 1024);
});
