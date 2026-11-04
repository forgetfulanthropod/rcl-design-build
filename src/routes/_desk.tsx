import { useEffect } from "react";
import { createFileRoute, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { DeskApp } from "@/components/desk-app";
import { Login } from "@/components/login-screen";

/**
 * Pathless layout for every desk view (spec 05 · F1): the sign-in gate, then the desk shell
 * (sidebar, header, bottom nav) around the matched view.
 */
export const Route = createFileRoute("/_desk")({ component: DeskLayout });

function DeskLayout() {
  const { user, isPending } = useCurrentUserState();
  // The location this layout is rendered for (not an in-flight one), so a redirect to /login
  // never captures /login itself as `next`.
  const href = useRouterState({ select: (state) => (state.resolvedLocation ?? state.location).href });
  const navigate = useNavigate();
  const deepLink = !isPending && !user && href !== "/" && href !== "" && !href.startsWith("/login");
  useEffect(() => {
    // Signed out on a deep link: sign in first, then come back here (spec 05 · F1).
    if (deepLink) void navigate({ to: "/login", search: { next: href }, replace: true });
  }, [deepLink, href, navigate]);
  if (isPending) {
    // Neutral placeholder while the session resolves, so a signed-in user never sees a marketing page.
    return (
      <main className="grid min-h-dvh place-items-center px-5" aria-busy="true">
        <p className="text-muted">Opening the desk…</p>
      </main>
    );
  }
  if (!user) {
    // "/" shows sign-in in place; a deep link goes to /login and comes back after the magic link.
    return deepLink ? null : <Login />;
  }
  return (
    <DeskApp>
      <Outlet />
    </DeskApp>
  );
}
