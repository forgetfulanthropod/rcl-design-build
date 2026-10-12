import { test } from "node:test";
import assert from "node:assert/strict";
import { linkPreviewAllowed } from "./link-preview.server.ts";

test("on-screen sign-in links are off by default, even without NODE_ENV", () => {
  delete process.env.DEV_LINK_PREVIEW;
  delete process.env.NODE_ENV;
  assert.equal(linkPreviewAllowed(), false);
  process.env.NODE_ENV = "development";
  assert.equal(linkPreviewAllowed(), false);
});

test("only DEV_LINK_PREVIEW=true enables on-screen links", () => {
  for (const v of ["", "1", "TRUE", "yes", "false"]) {
    process.env.DEV_LINK_PREVIEW = v;
    assert.equal(linkPreviewAllowed(), false, v);
  }
  process.env.DEV_LINK_PREVIEW = "true";
  assert.equal(linkPreviewAllowed(), true);
  delete process.env.DEV_LINK_PREVIEW;
});
