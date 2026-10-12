import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  BEARER_STORAGE_KEY,
  canReplayConsumedLink,
  MAGIC_REPLAY_MS,
  safeRedirect,
  settleMagicAttempt,
  signInDocument,
  signInErrorDocument,
} from "./sign-in-complete.ts";

describe("magic link sign-in", () => {
  it("sends a successful consume to the desk even if the screen unmounted", () => {
    const settled = settleMagicAttempt({
      result: { ok: true, sessionToken: "abc", redirect: "/stage/deadbeef" },
      timedOut: false,
    });
    assert.deepEqual(settled, {
      action: "redirect",
      sessionToken: "abc",
      redirect: "/stage/deadbeef",
    });
  });

  it("rejects an off-site redirect", () => {
    assert.equal(safeRedirect("//evil.example"), "/");
    assert.equal(safeRedirect("https://evil.example"), "/");
    assert.equal(safeRedirect("/desk"), "/desk");
  });

  it("surfaces a burned link instead of waiting forever", () => {
    const settled = settleMagicAttempt({
      result: { ok: false, error: "This link is expired or already used." },
      timedOut: false,
    });
    assert.equal(settled.action, "error");
  });

  it("stops waiting when the request never returns", () => {
    const settled = settleMagicAttempt({ result: null, timedOut: true });
    assert.equal(settled.action, "error");
  });

  it("replays a link only for a few minutes after the first open", () => {
    const now = new Date("2026-09-30T15:00:00Z");
    const expires = new Date("2026-09-30T16:00:00Z");
    const fresh = new Date(now.getTime() - 30_000);
    const stale = new Date(now.getTime() - MAGIC_REPLAY_MS - 1);
    assert.equal(canReplayConsumedLink(fresh, expires, now), true);
    assert.equal(canReplayConsumedLink(stale, expires, now), false);
    assert.equal(canReplayConsumedLink(null, expires, now), false);
    assert.equal(canReplayConsumedLink(fresh, new Date(now.getTime() - 1), now), false);
  });

  it("returns a document that stores the session and leaves without the app bundle", () => {
    const html = signInDocument({ sessionToken: "tok-1", redirect: "/" });
    assert.match(html, /location\.replace/);
    assert.match(html, new RegExp(BEARER_STORAGE_KEY));
    assert.match(html, /tok-1/);
    assert.match(html, /id="continue"/);
    assert.doesNotMatch(html, /src="\/src\//);
    assert.match(signInErrorDocument("This link is expired or already used."), /Request a new link/);
  });
});
