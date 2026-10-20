/** Minimal shape so this works on DOM elements and in plain unit tests. */
export type FocusLike = { tagName: string; closest(selector: string): unknown } | null;

/**
 * After a dialog closes, should focus go back to its trigger? Only if focus has not already
 * moved somewhere real: body/html means "nowhere", and a photo thumbnail is the trigger itself.
 */
export function userMovedFocus(active: FocusLike): boolean {
  if (!active || active.tagName === "BODY" || active.tagName === "HTML") return false;
  return !active.closest("[data-photo-id]");
}
