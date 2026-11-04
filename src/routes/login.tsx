import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { Login } from "@/components/login-screen";

export const Route = createFileRoute("/login")({
  validateSearch: z.object({ next: z.string().max(300).optional() }),
  component: LoginRoute,
});

function LoginRoute() {
  const { next } = Route.useSearch();
  return <Login next={next ?? ""} />;
}
