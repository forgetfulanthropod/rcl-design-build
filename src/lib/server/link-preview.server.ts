/**
 * Whether a sign-in link may be shown on screen instead of being delivered.
 * Off by default everywhere (do not rely on NODE_ENV): only DEV_LINK_PREVIEW=true turns it on.
 * Showing a link on screen lets anyone sign in as any address, so never enable it on a public desk.
 */
export function linkPreviewAllowed(): boolean {
  return process.env.DEV_LINK_PREVIEW === "true";
}
