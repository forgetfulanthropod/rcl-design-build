import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { z } from "zod";
import { DocumentsView } from "@/components/documents-view";

export const Route = createFileRoute("/_desk/docs/")({
  validateSearch: z.object({ section: z.enum(["policy", "bids", "invoices", "changes"]).optional() }),
  component: DocsRoute,
});

function DocsRoute() {
  const { section } = Route.useSearch();
  const navigate = useNavigate();
  return (
    <DocumentsView
      section={section ?? "policy"}
      onSection={(next) => void navigate({ to: "/docs", search: { section: next }, replace: true })}
      docId=""
      onOpenDoc={(docId, opts) =>
        void (docId
          ? navigate({ to: "/docs/$docId", params: { docId }, search: opts?.created ? { created: opts.created } : {} })
          : navigate({ to: "/docs" }))
      }
    />
  );
}
