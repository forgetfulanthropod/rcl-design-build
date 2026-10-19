import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { z } from "zod";
import { DocumentsView } from "@/components/documents-view";
import { useDesk } from "@/components/desk-context";

export const Route = createFileRoute("/_desk/docs/$docId")({
  validateSearch: z.object({ created: z.string().max(80).optional() }),
  component: DocRoute,
});

/** One document. Another company's id (or a deleted one) says "Not found". */
function DocRoute() {
  const { docId } = Route.useParams();
  const { created } = Route.useSearch();
  const navigate = useNavigate();
  const { setRecordTitle } = useDesk();
  return (
    <DocumentsView
      docId={docId}
      createdFlash={created}
      onTitle={setRecordTitle}
      onClearCreated={() => void navigate({ to: "/docs/$docId", params: { docId }, search: {}, replace: true })}
      onSection={(section) => void navigate({ to: "/docs", search: { section } })}
      onOpenDoc={(next, opts) =>
        void (next
          ? navigate({ to: "/docs/$docId", params: { docId: next }, search: opts?.created ? { created: opts.created } : {} })
          : navigate({ to: "/docs" }))
      }
    />
  );
}
