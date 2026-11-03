import { useEffect } from "react";
import { createFileRoute, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
// TODO: re-enable auth once activity tracking is solid
// import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { DeskApp } from "@/components/desk-app";
// TODO: login screen commented out
// import { Login } from "@/components/login-screen";

/**
 * Pathless layout for every desk view (spec 05 · F1): the sign-in gate, then the desk shell
 * (sidebar, header, bottom nav) around the matched view.
 *
 * TODO: login / auth gate is commented out for now. This app is currently just the activity tracker.
 */
export const Route = createFileRoute("/_desk")({ component: DeskLayout });

function DeskLayout() {
  // TODO: restore auth checks
  // const { user, isPending } = useCurrentUserState();
  // const href = useRouterState({ select: (state) => (state.resolvedLocation ?? state.location).href });
  // const navigate = useNavigate();
  // const deepLink = !isPending && !user && href !== "/" && href !== "" && !href.startsWith("/login");
  // useEffect(() => {
  //   if (deepLink) void navigate({ to: "/login", search: { next: href }, replace: true });
  // }, [deepLink, href, navigate]);
  // if (isPending) {
  //   return (
  //     <main className="grid min-h-dvh place-items-center px-5" aria-busy="true">
  //       <p className="text-muted">Opening the desk…</p>
  //     </main>
  //   );
  // }
  // if (!user) {
  //   return deepLink ? null : <Login />;
  // }

  // For now just render the desk shell (or redirect to /tracking from index)
  return (
    <DeskApp>
      <Outlet />
    </DeskApp>
  );
}
