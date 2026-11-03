import { createFileRoute } from "@tanstack/react-router";
// TODO: re-enable login when needed
// import { z } from "zod";
// import { Login } from "@/components/login-screen";

export const Route = createFileRoute("/login")({
  // TODO: restore validateSearch and Login component
  // validateSearch: z.object({ next: z.string().max(300).optional() }),
  component: () => (
    <main className="grid min-h-dvh place-items-center px-5">
      <p className="text-muted">Login is temporarily disabled. Use the activity log.</p>
    </main>
  ),
});
