import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { z } from "zod";
import { ActivitiesView, ActivityOverview } from "@/components/activities-view";
import { useDesk } from "@/components/desk-context";
import { can } from "@/lib/permissions";

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const Route = createFileRoute("/_desk/activities")({
  validateSearch: z.object({ day: day.optional(), from: day.optional(), to: day.optional(), job: z.string().max(80).optional() }),
  component: ActivitiesRoute,
});

function ActivitiesRoute() {
  const search = Route.useSearch();
  const navigate = useNavigate();
  const { ready } = useDesk();
  const openDocs = (docId?: string) =>
    void (docId ? navigate({ to: "/docs/$docId", params: { docId } }) : navigate({ to: "/docs" }));
  if (can(ready.profile.role, "report.review")) {
    return (
      <ActivityOverview
        onOpenDocs={openDocs}
        initial={search}
        onFilters={(f) => void navigate({ to: "/activities", search: { from: f.from, to: f.to, job: f.job || undefined }, replace: true })}
      />
    );
  }
  return (
    <ActivitiesView
      onOpenDocs={openDocs}
      initialDay={search.day}
      onDay={(next) => void navigate({ to: "/activities", search: { day: next }, replace: true })}
    />
  );
}
