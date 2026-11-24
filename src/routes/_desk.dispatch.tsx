import { createFileRoute } from "@tanstack/react-router";
import { DispatchView } from "@/components/dispatch-view";

// Morning dispatch sheet. URL only — not in the nav (see desk-routes viewsFor).
export const Route = createFileRoute("/_desk/dispatch")({ component: DispatchRoute });

function DispatchRoute() {
  return <DispatchView />;
}
