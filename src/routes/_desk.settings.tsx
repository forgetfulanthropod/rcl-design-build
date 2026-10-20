import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { z } from "zod";
import { SharingSettings } from "@/components/sharing-settings";
import { useDesk } from "@/components/desk-context";

// Sharing settings (spec 06) at /settings; a job's sharing page is /settings?project=<id> (spec 05 · F1).
export const Route = createFileRoute("/_desk/settings")({
  validateSearch: z.object({ project: z.string().max(80).optional() }),
  component: SettingsRoute,
});

function SettingsRoute() {
  const { project } = Route.useSearch();
  const { sharingChanged } = useDesk();
  const navigate = useNavigate();
  return (
    <SharingSettings
      projectId={project ?? ""}
      onOpenProject={(id) => void navigate({ to: "/settings", search: id ? { project: id } : {} })}
      onChanged={sharingChanged}
    />
  );
}
