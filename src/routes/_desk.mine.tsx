import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { MyReports } from "@/components/reports-views";

export const Route = createFileRoute("/_desk/mine")({ component: MineRoute });

function MineRoute() {
  const navigate = useNavigate();
  return <MyReports onFixDay={(day) => void navigate({ to: "/today", search: { day } })} />;
}
