import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { CrewView } from "@/components/crew-view";
import { useDesk } from "@/components/desk-context";
import { can } from "@/lib/permissions";

// Crew & skills board (spec 01), at /crew (spec 05 · F1).
export const Route = createFileRoute("/_desk/crew")({ component: CrewRoute });

function CrewRoute() {
  const { ready } = useDesk();
  const navigate = useNavigate();
  const role = ready.profile.role;
  return (
    <CrewView
      role={role}
      onOpenSharing={can(role, "settings.sharing.view") ? (project) => void navigate({ to: "/settings", search: project ? { project } : {} }) : undefined}
    />
  );
}
