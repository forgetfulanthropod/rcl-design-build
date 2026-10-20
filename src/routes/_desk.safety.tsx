import { createFileRoute } from "@tanstack/react-router";
import { SafetyView } from "@/components/safety-view";

export const Route = createFileRoute("/_desk/safety")({ component: SafetyView });
