import { createFileRoute } from "@tanstack/react-router";
import { Login } from "@/components/login-screen";

export const Route = createFileRoute("/login")({ component: Login });
