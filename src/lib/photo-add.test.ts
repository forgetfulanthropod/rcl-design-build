import { test } from "node:test";
import assert from "node:assert/strict";
import { ROLES } from "./roles.ts";
import {
  LOCAL_PHOTO_MAX_BYTES,
  LOCAL_PHOTO_MAX_SIDE,
  MAX_STORED_BYTES,
  STORED_MAX_SIDE,
  firstThatFits,
  isHeic,
  isPhotoFile,
  prepareSteps,
} from "./photo-upload.ts";
import {
  PHONE_STORAGE_FULL,
  applyParkedIds,
  isQuotaError,
  logForDisk,
  mayAddLogPhoto,
  parkPhotoBytes,
  photoAddMessage,
  rememberPhoto,
  requestPersistentStorage,
  runPhotoBatch,
  type LogEntry,
} from "./photo-add.ts";

function quota(
  message = "Setting the value of 'rcl-tracking-log' exceeded the quota.",
): DOMException {
  return new DOMException(message, "QuotaExceededError");
}

test("a failure after the async wait clears busy and does not hang", async () => {
  let waited = false;
  const outcome = await runPhotoBatch({
    files: [
      {
        name: "fence.jpg",
        prepare: async () => {
          await Promise.resolve();
          waited = true;
          return "data:image/jpeg;base64,QQ==";
        },
      },
    ],
    save: () => {
      throw quota();
    },
    owner: true,
    role: "labor",
  });
  assert.equal(waited, true);
  assert.equal(outcome.busy, false);
  assert.equal(outcome.saved.length, 0);
  assert.equal(outcome.failed.length, 1);
  assert.equal(outcome.failed[0].message, PHONE_STORAGE_FULL);
  assert.equal(outcome.failed[0].retry, true);
  assert.equal(outcome.failed[0].remove, true);
  assert.equal(/permission/i.test(outcome.failed[0].message), false);
});

test("a full store or a quota error says Phone storage full", () => {
  const cases = [
    quota(),
    new DOMException("The quota has been exceeded.", "NS_ERROR_DOM_QUOTA_REACHED"),
    Object.assign(new Error("storage quota"), { name: "QUOTA_EXCEEDED_ERR" }),
    new Error("Failed to execute 'setItem' on 'Storage': Setting the value exceeded the quota."),
  ];
  for (const error of cases) {
    assert.equal(isQuotaError(error), true, error instanceof Error ? error.message : "");
    assert.equal(photoAddMessage(error, { owner: true, role: "owner" }), PHONE_STORAGE_FULL);
  }
  assert.equal(
    photoAddMessage(new Error("That file isn't a photo this phone can read."), {
      owner: true,
      role: "owner",
    }),
    "That file isn't a photo this phone can read.",
  );
});

test("one photo failing in a batch does not block the others or leave the batch busy", async () => {
  const stored: string[] = [];
  const outcome = await runPhotoBatch({
    files: [
      { name: "ok-1.jpg", prepare: async () => "one" },
      {
        name: "full.jpg",
        prepare: async () => {
          await Promise.resolve();
          return "nope";
        },
      },
      { name: "ok-2.jpg", prepare: async () => "two" },
    ],
    save: (value) => {
      if (value === "nope") throw quota();
      stored.push(value);
    },
    owner: true,
    role: "lead",
  });
  assert.deepEqual(stored, ["one", "two"]);
  assert.deepEqual(
    outcome.saved.map((item) => item.name),
    ["ok-1.jpg", "ok-2.jpg"],
  );
  assert.equal(outcome.failed.length, 1);
  assert.equal(outcome.failed[0].name, "full.jpg");
  assert.equal(outcome.failed[0].message, PHONE_STORAGE_FULL);
  assert.equal(outcome.failed[0].retry, true);
  assert.equal(outcome.failed[0].remove, true);
  assert.equal(outcome.busy, false);
});

test("a HEIC photo is stored, and a HEIC that cannot be converted fails on its own", async () => {
  assert.equal(isHeic({ type: "", name: "IMG_2044.HEIC" }), true);
  assert.equal(isPhotoFile({ type: "image/heic", name: "broken.heic" }), true);
  const stored: string[] = [];
  const outcome = await runPhotoBatch({
    files: [
      {
        name: "IMG_2044.HEIC",
        prepare: async () => ({ image: "data:image/jpeg;base64,QQ==", converted: true }),
      },
      {
        name: "broken.heic",
        prepare: async () => {
          throw new Error("Couldn't convert that iPhone (HEIC) photo. Try sharing it as a JPEG.");
        },
      },
      {
        name: "site.jpg",
        prepare: async () => ({ image: "data:image/jpeg;base64,Qg==", converted: false }),
      },
    ],
    save: async (value) => {
      stored.push(value.image);
    },
    owner: true,
    role: "labor",
  });
  assert.deepEqual(stored, ["data:image/jpeg;base64,QQ==", "data:image/jpeg;base64,Qg=="]);
  assert.equal(outcome.failed.length, 1);
  assert.match(outcome.failed[0].message, /HEIC/);
  assert.equal(/permission/i.test(outcome.failed[0].message), false);
  assert.equal(outcome.busy, false);
  assert.equal(outcome.failed[0].retry, true);
  assert.equal(outcome.failed[0].remove, true);
});

test("the log owner never sees a permission error, and someone else's log is checked per role", () => {
  const security = new DOMException("The operation is insecure.", "SecurityError");
  const denied = new DOMException("Permission denied", "NotAllowedError");
  const forbidden = new Error("Your role can't do that (activity.add).");
  for (const role of ROLES) {
    assert.equal(mayAddLogPhoto({ owner: true, role }), true, role);
    for (const error of [quota(), security, denied, forbidden]) {
      const message = photoAddMessage(error, { owner: true, role });
      assert.equal(message, PHONE_STORAGE_FULL, `${role} ${error.name}`);
      assert.equal(/permission/i.test(message), false, message);
      assert.equal(/can't do that/i.test(message), false, message);
    }
  }
  for (const role of ["superadmin", "owner", "admin", "lead", "labor", "field"] as const) {
    assert.equal(mayAddLogPhoto({ owner: false, role }), true, role);
    assert.equal(photoAddMessage(quota(), { owner: false, role }), PHONE_STORAGE_FULL, role);
    assert.match(
      photoAddMessage(forbidden, { owner: false, role }),
      /can't do that \(activity\.add\)/,
      `${role} keeps a real permission error`,
    );
  }
  assert.equal(mayAddLogPhoto({ owner: false, role: "sub" }), false);
  assert.equal(mayAddLogPhoto({ owner: false, role: "subcontractor" }), false);
  assert.match(
    photoAddMessage(quota(), { owner: false, role: "sub" }),
    /can't do that \(activity\.add\)/,
  );
  assert.equal(mayAddLogPhoto({ owner: false, role: null }), false);
  assert.match(
    photoAddMessage(new Error("nope"), { owner: false, role: null }),
    /can't do that \(activity\.add\)/,
  );
});

test("persistent storage is requested only when the browser offers it", async () => {
  assert.equal(await requestPersistentStorage(null), false);
  assert.equal(await requestPersistentStorage(undefined), false);
  assert.equal(await requestPersistentStorage({}), false);
  let calls = 0;
  assert.equal(
    await requestPersistentStorage({
      persist: async () => {
        calls += 1;
        return true;
      },
    }),
    true,
  );
  assert.equal(calls, 1);
  assert.equal(
    await requestPersistentStorage({
      persisted: async () => true,
      persist: async () => {
        throw new Error("should not be called");
      },
    }),
    true,
  );
  assert.equal(
    await requestPersistentStorage({
      persist: async () => {
        throw new DOMException("Permission denied", "NotAllowedError");
      },
    }),
    false,
  );
});

test("log photos are downscaled below the server upload cap before they are stored", () => {
  assert.ok(LOCAL_PHOTO_MAX_BYTES < MAX_STORED_BYTES);
  assert.ok(LOCAL_PHOTO_MAX_SIDE < STORED_MAX_SIDE);
  const steps = prepareSteps(LOCAL_PHOTO_MAX_SIDE, LOCAL_PHOTO_MAX_BYTES);
  assert.equal(steps[0].side, LOCAL_PHOTO_MAX_SIDE);
  assert.equal(steps[0].maxBytes, LOCAL_PHOTO_MAX_BYTES);
  assert.ok(steps.every((step) => step.side <= LOCAL_PHOTO_MAX_SIDE));
  assert.deepEqual(
    prepareSteps(STORED_MAX_SIDE, MAX_STORED_BYTES).map((step) => step.side),
    [1600, 1024, 800, 640],
  );
  const sizes: Record<number, number> = {
    0.82: 400_000,
    0.72: 300_000,
    0.6: 200_000,
    0.5: 100_000,
  };
  const fake = (bytes: number) =>
    `data:image/jpeg;base64,${"A".repeat(Math.ceil((bytes * 4) / 3))}`;
  const fit = firstThatFits((q) => ({ url: fake(sizes[q]), q }), LOCAL_PHOTO_MAX_BYTES);
  assert.equal(fit?.q, 0.6);
});

test("eighteen fat photos are parked out of the log record so a new one can be saved", async () => {
  const big = `data:image/jpeg;base64,${"A".repeat(20_000)}`;
  const day = "2026-11-23";
  const existing: LogEntry[] = Array.from({ length: 18 }, (_, i) => ({
    id: `p${i}`,
    kind: "photo",
    dataUrl: big,
  }));
  const blobs = new Map<string, string>();
  let disk = "";
  const save = (log: Record<string, LogEntry[]>) => {
    const json = JSON.stringify(logForDisk(log));
    if (json.includes("base64")) throw quota();
    disk = json;
  };
  const next = await rememberPhoto(
    { [day]: existing },
    day,
    { id: "new", kind: "photo", dataUrl: big },
    {
      save,
      putBlob: async (id, dataUrl) => {
        blobs.set(id, dataUrl);
      },
    },
  );
  assert.equal(blobs.size, 19);
  assert.equal(disk.includes("base64"), false);
  assert.ok(disk.length < 20_000);
  assert.equal(next[day].at(-1)?.dataUrl, big, "the screen still has the picture");
  assert.equal(next[day].at(-1)?.blobId, "new");
  const reloaded = logForDisk(next);
  assert.equal(
    reloaded[day].every((entry) => entry.dataUrl === undefined),
    true,
  );
  assert.equal(reloaded[day].length, 19);
});

test("when the blob store and the log are both full, that photo is not kept", async () => {
  let saved = false;
  await assert.rejects(
    () =>
      rememberPhoto(
        { "2026-11-23": [{ id: "old", kind: "photo", dataUrl: "data:image/jpeg;base64,QQ==" }] },
        "2026-11-23",
        { id: "p", kind: "photo", dataUrl: "data:image/jpeg;base64,Qg==" },
        {
          putBlob: async () => {
            throw quota();
          },
          save: () => {
            saved = true;
            throw quota();
          },
        },
      ),
    (error: unknown) => isQuotaError(error),
  );
  assert.equal(saved, false, "a full blob store fails this photo before rewriting the log");
});

test("parking keeps a caption typed onto the latest log", async () => {
  const day = "2026-11-23";
  let latest: Record<string, LogEntry[]> = {
    [day]: [
      { id: "old", kind: "photo", dataUrl: "data:image/jpeg;base64,QQ==", body: "" } as LogEntry,
    ],
  };
  const parked = await parkPhotoBytes(latest, async () => undefined);
  latest = { [day]: [{ ...latest[day][0], body: "Rotten posts" } as LogEntry] };
  const stamped = applyParkedIds(latest, parked);
  assert.equal((stamped[day][0] as LogEntry & { body?: string }).body, "Rotten posts");
  assert.equal(stamped[day][0].blobId, "old");
  assert.equal(stamped[day][0].dataUrl?.startsWith("data:image/jpeg"), true);
});
