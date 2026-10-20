import { createFileRoute } from "@tanstack/react-router";
import { TodayReport } from "@/components/today-report";

export const Route = createFileRoute("/_desk/today")({ component: TodayReport });
