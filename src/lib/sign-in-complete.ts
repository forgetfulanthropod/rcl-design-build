export const BEARER_STORAGE_KEY = "grok-auth.bearer-token";
export const MAGIC_REPLAY_MS = 3 * 60 * 1000;

export function safeRedirect(path: string | null | undefined): string {
  if (!path) return "/";
  if (!path.startsWith("/") || path.startsWith("//") || path.includes("\\") || path.includes("\n")) {
    return "/";
  }
  return path;
}

export function canReplayConsumedLink(
  consumedAt: Date | null,
  expiresAt: Date,
  now: Date,
): boolean {
  if (!consumedAt) return false;
  if (expiresAt.getTime() <= now.getTime()) return false;
  return now.getTime() - consumedAt.getTime() <= MAGIC_REPLAY_MS;
}

export type MagicResult =
  | { ok: true; sessionToken: string; redirect: string }
  | { ok: false; error: string };

export type MagicSettle =
  | { action: "redirect"; sessionToken: string; redirect: string }
  | { action: "error"; message: string }
  | { action: "wait" };

/** A successful consume always redirects, even if the screen already unmounted. */
export function settleMagicAttempt(input: {
  result: MagicResult | null;
  timedOut: boolean;
}): MagicSettle {
  if (input.result?.ok) {
    return {
      action: "redirect",
      sessionToken: input.result.sessionToken,
      redirect: safeRedirect(input.result.redirect),
    };
  }
  if (input.result && !input.result.ok) {
    return { action: "error", message: input.result.error };
  }
  if (input.timedOut) {
    return { action: "error", message: "Sign-in is taking too long. Request a new link." };
  }
  return { action: "wait" };
}

function htmlEscape(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/** Tiny document. Does not load the app, so sign-in cannot wait on the client bundle. */
export function signInDocument(input: { sessionToken: string; redirect: string }): string {
  const redirect = safeRedirect(input.redirect);
  const token = JSON.stringify(input.sessionToken);
  const dest = JSON.stringify(redirect);
  const key = JSON.stringify(BEARER_STORAGE_KEY);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Signing you in</title>
</head>
<body>
<p>Signing you in.</p>
<p><a id="continue" href="${htmlEscape(redirect)}">Continue to the desk</a></p>
<script>
try { sessionStorage.setItem(${key}, ${token}); } catch (e) {}
location.replace(${dest});
</script>
</body>
</html>
`;
}

export function signInErrorDocument(message: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Link not accepted</title>
</head>
<body>
<p>${htmlEscape(message)}</p>
<p><a href="/login">Request a new link</a></p>
</body>
</html>
`;
}
