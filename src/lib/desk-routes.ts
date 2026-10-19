/**
 * Desk URLs (spec 05 · F1). Every view and record has a path, so reload, back/forward and
 * sharing a link all work. Pure helpers, shared by the routes, the shell and the tests.
 */
import { can, navFor, type NavId } from "./permissions.ts";
import { safeRedirect } from "./sign-in-complete.ts";

export type DeskView = NavId | "team";

export const VIEW_PATH: Record<DeskView, string> = {
  today: "/today",
  mine: "/mine",
  reports: "/reports",
  attention: "/attention",
  activities: "/activities",
  safety: "/safety",
  docs: "/docs",
  team: "/team",
};

export const VIEW_LABEL: Record<DeskView, string> = {
  today: "Today",
  mine: "My reports",
  reports: "Reports",
  attention: "Attention",
  activities: "Activities",
  safety: "Safety",
  docs: "Docs",
  team: "Team",
};

/** The desk view a path belongs to ("/docs/abc" → "docs"), or null for non-desk paths. */
export function viewForPath(pathname: string): DeskView | null {
  const first = `/${pathname.split("/").filter(Boolean)[0] ?? ""}`;
  const hit = (Object.entries(VIEW_PATH) as [DeskView, string][]).find(([, path]) => path === first);
  return hit ? hit[0] : null;
}

/** Views this role has on its desk: its nav, plus Team for crew managers. */
export function viewsFor(role: string): DeskView[] {
  const views: DeskView[] = [...navFor(role)];
  if (can(role, "crew.invite")) views.push("team");
  return views;
}

export function canOpen(role: string, view: DeskView): boolean {
  return viewsFor(role).includes(view);
}

/** Where "/" (and a page that isn't on this desk) goes: the role's first nav item. */
export function defaultPath(role: string): string {
  const first = navFor(role)[0];
  return first ? VIEW_PATH[first] : VIEW_PATH.today;
}

export const NOT_ON_DESK = "That page isn't on your desk.";

/** "<Record> · <View> · RCL", or "<View> · RCL" without a record. */
export function pageTitle(view: DeskView, record?: string | null): string {
  return [record?.trim(), VIEW_LABEL[view], "RCL"].filter(Boolean).join(" · ");
}

/**
 * Where to land after signing in from a deep link. Same-origin paths only; sign-in pages
 * (which would loop) and anything else fall back to "/".
 */
export function safeNext(next: string | null | undefined): string {
  const path = safeRedirect(next ?? "");
  if (path === "/" || path.startsWith("/login") || path.startsWith("/m/") || path.startsWith("/api/")) return "/";
  return path.slice(0, 300);
}
