import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { z } from "zod";
import { TimeView } from "@/components/time-view";

// Timesheets review (spec 02) at /time; a week is /time?week=YYYY-MM-DD (any day in that pay week).
export const Route = createFileRoute("/_desk/time")({
  validateSearch: z.object({ week: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }),
  component: TimeRoute,
});

function TimeRoute() {
  const { week } = Route.useSearch();
  const navigate = useNavigate();
  return <TimeView week={week ?? ""} onWeek={(w) => void navigate({ to: "/time", search: { week: w }, replace: true })} />;
}
