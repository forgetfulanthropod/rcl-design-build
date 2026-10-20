import assert from "node:assert/strict";
import { test } from "node:test";
import { attentionRangeKey, clearAttentionInflightForTests, shareAttentionFresh } from "./attention-inflight.ts";

test("attention inflight: concurrent fresh calls for one range share one start()", async () => {
  clearAttentionInflightForTests();
  let starts = 0;
  const key = attentionRangeKey("2026-10-13", "2026-10-19");
  const start = () => {
    starts += 1;
    return new Promise<string>((resolve) => setTimeout(() => resolve("ok"), 20));
  };
  const [a, b] = await Promise.all([shareAttentionFresh(key, start), shareAttentionFresh(key, start)]);
  assert.equal(a, "ok");
  assert.equal(b, "ok");
  assert.equal(starts, 1);
});

test("attention inflight: a later call after settle starts again", async () => {
  clearAttentionInflightForTests();
  let starts = 0;
  const key = attentionRangeKey("2026-10-19", "2026-10-19");
  const start = () => {
    starts += 1;
    return Promise.resolve(starts);
  };
  assert.equal(await shareAttentionFresh(key, start), 1);
  assert.equal(await shareAttentionFresh(key, start), 2);
  assert.equal(starts, 2);
});
