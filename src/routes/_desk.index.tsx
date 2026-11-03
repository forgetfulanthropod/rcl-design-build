import { createFileRoute, redirect } from "@tanstack/react-router";

// "/" now goes straight to the activity tracker.
export const Route = createFileRoute("/_desk/")({
  beforeLoad: () => {
    throw redirect({ to: "/tracking" });
  },
  component: () => null,
});
