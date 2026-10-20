import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { z } from "zod";
import { TodayReport } from "@/components/today-report";

// Today's report; /today?day=YYYY-MM-DD opens a day whose hours were sent back (spec 02).
export const Route = createFileRoute("/_desk/today")({
  validateSearch: z.object({ day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }),
  component: TodayRoute,
});

function TodayRoute() {
  const { day } = Route.useSearch();
  const navigate = useNavigate();
  return <TodayReport key={day ?? ""} day={day} onBackToToday={() => void navigate({ to: "/today", search: {} })} />;
}
