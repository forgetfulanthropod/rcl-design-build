import { useState, useSyncExternalStore, type ReactNode } from "react";
import { Navigate } from "@tanstack/react-router";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { GROK_PROVIDERS, authEnabled, signIn, signOut } from "./client";
import { hasGateSessionMarker } from "./gate-session-marker";
import { resolveSignInGateState } from "./sign-in-gate";
import { useCurrentUser, useCurrentUserState } from "./use-current-user";

const subscribeToNothing = () => () => {};
const noGateSessionOnServer = () => false;

/**
 * Auth state components — plain wrappers around `useCurrentUserState()`.
 *
 * With auth on, visitors are signed out until they authenticate — in the sandbox
 * live preview too, which does real sign-in. The shared dev user appears only
 * when auth is disabled (`VITE_AUTH_ENABLED=false`, the shipped default).
 * While the session is still resolving, gates that care about signed-out state
 * render nothing so there's no signed-out flash on hard reload.
 */

/** Where `RedirectToSignIn` sends signed-out visitors. Create this route. */
export const SIGN_IN_PATH = "/login";

/** Render children only when a user is present (real session, or the disabled-auth dev user). */
export function SignedIn({ children }: { children: ReactNode }) {
  const { user } = useCurrentUserState();
  return user ? <>{children}</> : null;
}

/**
 * Render children only once we KNOW the visitor is signed out (`isPending` has
 * cleared and there is no user). Hidden while the session is still loading.
 */
export function SignedOut({ children }: { children: ReactNode }) {
  const { user, isPending } = useCurrentUserState();
  if (isPending || user) return null;
  return <>{children}</>;
}

/**
 * Client-side redirect to the sign-in route (TanStack `<Navigate>` — NOT a full
 * `window.location` reload). A hard navigation re-bootstraps the SPA and re-runs
 * session loading, which feels like a second "Loading…" on /login.
 *
 * Guard routes by waiting out `isPending` first (see `use-current-user`), then
 * render this.
 */
export function RedirectToSignIn({ to = SIGN_IN_PATH }: { to?: string }) {
  return <Navigate to={to} />;
}

export function SignInGate({
  children,
  fallback,
}: {
  children: ReactNode;
  fallback?: ReactNode;
}) {
  const { user, isPending } = useCurrentUserState();
  const state = resolveSignInGateState({ isPending, hasUser: user !== null });
  if (state === "pending") return null;
  if (state === "signed_in") return <>{children}</>;
  return <>{fallback ?? <SignInButtons />}</>;
}

export function SignInButtons() {
  return (
    <div className="flex w-full max-w-sm flex-col gap-2">
      {GROK_PROVIDERS.map((p) => (
        <button
          key={p.providerId}
          type="button"
          onClick={() => signIn(p.providerId, { callbackURL: "/" })}
          className="w-full cursor-pointer rounded-md border border-neutral-300 px-4 py-2 hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-900"
        >
          Continue with {p.label}
        </button>
      ))}
    </div>
  );
}

/**
 * Signed-in identity chip + sign-out. Sign-out is only shown when auth is enabled (the
 * disabled-auth dev user has nothing to sign out of) and the session is not
 * gate-materialized — behind the gate the next request signs the viewer
 * straight back in, so a sign-out control there is a broken loop.
 *
 * Phones (< md): a 44×44 avatar button opens an account menu with the name, the
 * role (when given), and a full-width Sign out row. md+: inline name and a 44 px
 * Sign out button at full contrast.
 */
export function UserButton({ roleLabel }: { roleLabel?: string } = {}) {
  const user = useCurrentUser();
  // Sign-out can take a moment (and can fail when deployed), so the control
  // shows it is working and cannot be fired twice.
  const [signingOut, setSigningOut] = useState(false);
  const gateSession = useSyncExternalStore(
    subscribeToNothing,
    hasGateSessionMarker,
    noGateSessionOnServer,
  );
  if (!user) return null;
  const label = user.displayName ?? user.primaryEmail ?? "Account";
  const canSignOut = authEnabled && !gateSession;
  const startSignOut = () => {
    if (signingOut) return;
    setSigningOut(true);
    // Success navigates away; on failure re-enable so it can be retried.
    void signOut().catch(() => setSigningOut(false));
  };
  const avatar = (size: string) =>
    user.profileImageUrl ? (
      <img src={user.profileImageUrl} alt="" className={`${size} rounded-full object-cover`} />
    ) : (
      <span className={`grid ${size} place-items-center rounded-full bg-black/10 text-sm font-medium dark:bg-white/20`}>
        {label.charAt(0).toUpperCase()}
      </span>
    );
  return (
    <>
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <button
            type="button"
            aria-label={`Account: ${label}`}
            data-testid="account-menu"
            className="grid size-11 shrink-0 cursor-pointer place-items-center rounded-full md:hidden"
          >
            {avatar("size-9")}
          </button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            align="end"
            sideOffset={6}
            className="z-50 min-w-60 rounded-md border border-line bg-surface p-2 text-fg shadow-lg"
          >
            <div className="px-3 py-2">
              <p className="text-base font-medium">{label}</p>
              {roleLabel ? <p className="text-sm text-muted">{roleLabel}</p> : null}
            </div>
            {canSignOut ? (
              <DropdownMenu.Item
                disabled={signingOut}
                onSelect={(event) => {
                  event.preventDefault();
                  startSignOut();
                }}
                className="flex min-h-11 w-full cursor-pointer items-center rounded-md px-3 text-base outline-none data-[disabled]:cursor-wait data-[highlighted]:bg-raised"
              >
                {signingOut ? "Signing out…" : "Sign out"}
              </DropdownMenu.Item>
            ) : null}
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
      <div className="hidden items-center gap-2 md:flex">
        {avatar("h-8 w-8")}
        <span className="text-sm font-medium">{label}</span>
        {canSignOut && (
          <button
            type="button"
            disabled={signingOut}
            onClick={startSignOut}
            className="inline-flex min-h-11 min-w-11 shrink-0 cursor-pointer items-center justify-center whitespace-nowrap rounded-md px-3 text-sm text-fg underline-offset-4 hover:underline disabled:cursor-wait disabled:no-underline"
          >
            {signingOut ? "Signing out…" : "Sign out"}
          </button>
        )}
      </div>
    </>
  );
}
