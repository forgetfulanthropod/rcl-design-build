import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { z } from "zod";
import { AttentionView } from "@/components/reports-views";

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const Route = createFileRoute("/_desk/attention")({
  validateSearch: z.object({ from: day.optional(), to: day.optional() }),
  component: AttentionRoute,
});

function AttentionRoute() {
  const search = Route.useSearch();
  const navigate = useNavigate();
  return (
    <AttentionView
      initial={search}
      onRange={(range) => void navigate({ to: "/attention", search: range, replace: true })}
      openReport={(focus, day) => void navigate({ to: "/reports", search: { focus, day } })}
    />
  );
}
