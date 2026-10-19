import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { DocumentsView } from "@/components/documents-view";
import { useDesk } from "@/components/desk-context";

export const Route = createFileRoute("/_desk/docs/$docId")({ component: DocRoute });

/** One document. Another company's id (or a deleted one) says "Not found". */
function DocRoute() {
  const { docId } = Route.useParams();
  const navigate = useNavigate();
  const { setRecordTitle } = useDesk();
  return (
    <DocumentsView
      docId={docId}
      onTitle={setRecordTitle}
      onSection={(section) => void navigate({ to: "/docs", search: { section } })}
      onOpenDoc={(next) => void (next ? navigate({ to: "/docs/$docId", params: { docId: next } }) : navigate({ to: "/docs" }))}
    />
  );
}
