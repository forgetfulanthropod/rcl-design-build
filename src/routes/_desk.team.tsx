import { createFileRoute } from "@tanstack/react-router";
import { CrewView } from "@/components/desk-views";
import { useDesk } from "@/components/desk-context";

export const Route = createFileRoute("/_desk/team")({ component: TeamRoute });

function TeamRoute() {
  const { ready, commit } = useDesk();
  return <CrewView data={ready} commit={commit} />;
}
