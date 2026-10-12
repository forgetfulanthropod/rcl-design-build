import { createFileRoute } from "@tanstack/react-router";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { DeskApp } from "@/components/desk-app";
import { Login } from "@/components/login-screen";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  const { user, isPending } = useCurrentUserState();
  if (isPending) {
    // Neutral placeholder while the session resolves, so a signed-in user never sees a marketing page.
    return (
      <main className="grid min-h-dvh place-items-center px-5" aria-busy="true">
        <p className="text-muted">Opening the desk…</p>
      </main>
    );
  }
  if (!user) return <Login />;
  return <DeskApp />;
}
