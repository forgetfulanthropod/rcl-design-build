import { createFileRoute } from "@tanstack/react-router";

// "/" — the desk shell sends each role to its first view (e.g. /reports for Owner, /today for Labor).
export const Route = createFileRoute("/_desk/")({ component: () => null });
