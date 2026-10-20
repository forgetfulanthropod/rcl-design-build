import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { z } from "zod";
import { ReportsReview } from "@/components/reports-views";

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const Route = createFileRoute("/_desk/reports/")({
  validateSearch: z.object({
    day: day.optional(),
    from: day.optional(),
    to: day.optional(),
    job: z.string().max(80).optional(),
    person: z.string().max(80).optional(),
    focus: z.string().max(80).optional(),
  }),
  component: ReportsRoute,
});

function ReportsRoute() {
  const search = Route.useSearch();
  const navigate = useNavigate();
  return (
    <ReportsReview
      key={search.focus ?? ""}
      focus={search.focus ?? ""}
      initialDay={search.day ?? ""}
      initial={{ from: search.from, to: search.to, job: search.job, person: search.person }}
      onFilters={(f) =>
        void navigate({
          to: "/reports",
          search: (prev) => ({ ...prev, day: undefined, from: f.from, to: f.to, job: f.job || undefined, person: f.person || undefined }),
          replace: true,
        })
      }
    />
  );
}
