import { createFileRoute } from "@tanstack/react-router";
import { MyReports } from "@/components/reports-views";

export const Route = createFileRoute("/_desk/mine")({ component: MyReports });
