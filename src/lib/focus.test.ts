import assert from "node:assert/strict";
import { test } from "node:test";
import { userMovedFocus } from "./focus.ts";

const el = (tagName: string, insideThumb = false) => ({ tagName, closest: (s: string) => (insideThumb && s === "[data-photo-id]" ? {} : null) });

test("photo viewer close: return focus to the thumbnail when focus is nowhere", () => {
  assert.equal(userMovedFocus(null), false);
  assert.equal(userMovedFocus(el("BODY")), false);
  assert.equal(userMovedFocus(el("HTML")), false);
  assert.equal(userMovedFocus(el("BUTTON", true)), false); // the thumbnail itself
});

test("photo viewer close: keep focus where the user already moved it (regression: autosave on stolen blur)", () => {
  assert.equal(userMovedFocus(el("TEXTAREA")), true);
  assert.equal(userMovedFocus(el("SELECT")), true);
  assert.equal(userMovedFocus(el("BUTTON")), true);
});
