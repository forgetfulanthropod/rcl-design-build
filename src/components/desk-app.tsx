import { useEffect, useState } from "react";
import { AlertTriangle, ClipboardList, Files, History, ListChecks, NotebookPen, ShieldCheck, Users } from "lucide-react";
import { UserButton } from "@/lib/auth/gates";
import { completeSetup, loadDesk } from "@/lib/server/fns";
import { Mark } from "@/components/mark";
import { Button, ErrorBanner, OfflineBadge, Skeleton } from "@/components/ui";
import { navFor } from "@/lib/permissions";
import { useOnline } from "@/lib/use-online";
import { CrewView } from "@/components/desk-views";
import { TodayReport } from "@/components/today-report";
import { AttentionView, MyReports, ReportsReview } from "@/components/reports-views";
import { ActivitiesView, ActivityOverview } from "@/components/activities-view";
import { SafetyView } from "@/components/safety-view";
import { DocumentsView } from "@/components/documents-view";
import { can, type NavId } from "@/lib/permissions";
import { SUPER_ADMIN_PHONE_DISPLAY, roleLabel, samePhone } from "@/lib/roles";

type DeskResult = Awaited<ReturnType<typeof loadDesk>>;
type View = NavId | "team";

// Slimmed to daily reports. The older desk views (Desk home, Jobs, Site/dispatch board, work orders,
// RFIs, change orders, milestones, contract values, Log, Foreman) are hidden from navigation; their
// components and server functions remain in desk-views.tsx / data.server.ts and their tables are untouched.
const NAV: { id: NavId; label: string; icon: typeof Users }[] = [
  { id: "today", label: "Today", icon: NotebookPen },
  { id: "mine", label: "My reports", icon: History },
  { id: "reports", label: "Reports", icon: ClipboardList },
  { id: "attention", label: "Attention", icon: AlertTriangle },
  { id: "activities", label: "Activities", icon: ListChecks },
  { id: "safety", label: "Safety", icon: ShieldCheck },
  { id: "docs", label: "Docs", icon: Files },
];

export function DeskApp() {
  const [data, setData] = useState<DeskResult | null>(null);
  const [error, setError] = useState("");
  const [view, setView] = useState<View | "">("");
  const [focus, setFocus] = useState({ id: "", day: "" });
  const [attempt, setAttempt] = useState(0);
  const online = useOnline();

  useEffect(() => {
    let cancelled = false;
    setError("");
    loadDesk()
      .then((result) => {
        if (!cancelled) setData(result);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "Could not open the desk.");
      });
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  async function commit(work: Promise<DeskResult>) {
    setError("");
    try {
      setData(await work);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save that.");
    }
  }

  if (!data) {
    return (
      <main className="mx-auto grid min-h-dvh max-w-lg content-center gap-4 px-5">
        <OfflineBadge online={online} />
        {error ? (
          <ErrorBanner message={error} onRetry={() => setAttempt((n) => n + 1)} />
        ) : (
          <Skeleton lines={4} label="Opening the desk" />
        )}
      </main>
    );
  }
  if (data.needsSetup) {
    return (
      <Setup
        email={data.email}
        suggestedName={data.suggestedName}
        superAdmin={data.superAdmin}
        commit={commit}
      />
    );
  }

  const ready = data;
  const nav = navFor(ready.profile.role)
    .map((id) => NAV.find((item) => item.id === id))
    .filter((item): item is (typeof NAV)[number] => Boolean(item));
  const canTeam = can(ready.profile.role, "crew.invite");
  const current: View = view === "team" && canTeam ? "team" : nav.some((item) => item.id === view) ? (view as NavId) : (nav[0]?.id ?? "today");
  const label = current === "team" ? "Team" : NAV.find((item) => item.id === current)?.label;

  return (
    <div className="min-h-dvh md:grid md:grid-cols-[13rem_1fr]">
      <aside className="hidden border-r border-line bg-surface md:flex md:flex-col md:px-3 md:py-5">
        <div className="flex items-center gap-2 px-2">
          <Mark />
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{ready.copy.companyMark}</p>
            <p className="truncate text-xs text-muted">{ready.companyName}</p>
          </div>
        </div>
        <nav className="mt-6 grid gap-1">
          {nav.map((item) => (
            <NavButton key={item.id} item={item} active={current === item.id} onClick={() => setView(item.id)} />
          ))}
        </nav>
      </aside>
      <div className="flex min-w-0 flex-col pb-20 md:pb-0">
        <header className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
          <div className="shrink-0">
            <p className="font-display text-2xl">{label}</p>
            <p className="hidden truncate text-sm text-muted md:block">{ready.copy.tagline}</p>
          </div>
          <div className="flex min-w-0 items-center gap-2">
            {canTeam ? (
              <button
                type="button"
                onClick={() => setView("team")}
                className={`inline-flex min-h-11 items-center gap-1 rounded-md px-2 text-sm ${current === "team" ? "text-copper" : "text-muted"}`}
              >
                <Users className="size-4" aria-hidden="true" /> Team
              </button>
            ) : null}
            <UserButton roleLabel={roleLabel(ready.profile.role)} />
          </div>
        </header>
        <OfflineBadge online={online} />
        {error ? (
          <div className="px-4 pt-3">
            <ErrorBanner message={error} onRetry={() => setError("")} />
          </div>
        ) : null}
        <div className="min-w-0 flex-1 px-4 py-4">
          {current === "today" ? <TodayReport /> : null}
          {current === "mine" ? <MyReports /> : null}
          {current === "reports" ? <ReportsReview key={`${focus.id}-${focus.day}`} focus={focus.id} initialDay={focus.day} /> : null}
          {current === "attention" ? (
            <AttentionView
              openReport={(id, day) => {
                setFocus({ id, day });
                setView("reports");
              }}
            />
          ) : null}
          {current === "activities" ? (
            can(ready.profile.role, "report.review") ? (
              <ActivityOverview onOpenDocs={() => setView("docs")} />
            ) : (
              <ActivitiesView onOpenDocs={() => setView("docs")} />
            )
          ) : null}
          {current === "safety" ? <SafetyView /> : null}
          {current === "docs" ? <DocumentsView /> : null}
          {current === "team" ? <CrewView data={ready} commit={commit} /> : null}
        </div>
      </div>
      <nav
        aria-label="Main"
        className="pb-safe fixed inset-x-0 bottom-0 z-10 grid border-t border-line bg-surface md:hidden"
        style={{ gridTemplateColumns: `repeat(${nav.length}, minmax(0, 1fr))` }}
      >
        {nav.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setView(item.id)}
            aria-current={current === item.id ? "page" : undefined}
            className={`flex h-16 flex-col items-center justify-center gap-1 text-[13px] font-medium ${
              current === item.id ? "text-copper" : "text-muted"
            }`}
          >
            <item.icon className="size-6" aria-hidden="true" />
            {item.label}
          </button>
        ))}
      </nav>
    </div>
  );
}

function NavButton({
  item,
  active,
  onClick,
}: {
  item: (typeof NAV)[number];
  active: boolean;
  onClick: () => void;
}) {
  const Icon = item.icon;
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex h-11 items-center gap-2 rounded-md px-2 text-left text-sm ${
        active ? "bg-raised text-fg" : "text-muted hover:text-fg"
      }`}
    >
      <Icon className="size-4" aria-hidden="true" />
      {item.label}
    </button>
  );
}

function Setup({
  email,
  suggestedName,
  superAdmin,
  commit,
}: {
  email: string;
  suggestedName: string;
  superAdmin: boolean;
  commit: (work: Promise<DeskResult>) => Promise<void>;
}) {
  const [name, setName] = useState(superAdmin ? "Elvira" : suggestedName);
  const [companyName, setCompanyName] = useState("RCL Design Build");
  const [phone, setPhone] = useState(superAdmin ? SUPER_ADMIN_PHONE_DISPLAY : "");
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState("");

  return (
    <main className="mx-auto flex min-h-dvh max-w-lg flex-col justify-center px-5 py-10">
      <div className="flex items-center gap-3">
        <Mark />
        <h1 className="text-3xl">{superAdmin ? "Open Elvira's desk" : "Open your company"}</h1>
      </div>
      <p className="mt-3 text-sm leading-relaxed text-muted">
        {superAdmin
          ? `This sign-in is the super-admin line ${SUPER_ADMIN_PHONE_DISPLAY}. You join as Elvira. Foreman texts this number before a product change goes live.`
          : `You join as an admin${email ? ` (${email})` : ""}. Elvira (${SUPER_ADMIN_PHONE_DISPLAY}) is the super admin. Foreman texts her before a product change goes live. Add your own mobile if you want crew texts, not hers.`}
      </p>
      <label className="mt-6 text-sm text-muted" htmlFor="setup-name">
        Your name
      </label>
      <input
        id="setup-name"
        className="field mt-1"
        value={name}
        disabled={superAdmin}
        onChange={(e) => setName(e.target.value)}
      />
      <label className="mt-4 text-sm text-muted" htmlFor="setup-co">
        Company
      </label>
      <input
        id="setup-co"
        className="field mt-1"
        value={companyName}
        onChange={(e) => setCompanyName(e.target.value)}
      />
      <label className="mt-4 text-sm text-muted" htmlFor="setup-phone">
        {superAdmin ? "Super-admin mobile" : "Your mobile, optional"}
      </label>
      <input
        id="setup-phone"
        className="field mt-1"
        inputMode="tel"
        value={phone}
        disabled={superAdmin}
        onChange={(e) => setPhone(e.target.value)}
      />
      {localError ? <p className="mt-3 text-sm text-danger">{localError}</p> : null}
      <Button
        className="mt-5"
        disabled={busy}
        onClick={() => {
          if (!superAdmin && samePhone(phone)) {
            setLocalError(`That number is Elvira's (${SUPER_ADMIN_PHONE_DISPLAY}). Use your own, or leave it blank.`);
            return;
          }
          setLocalError("");
          setBusy(true);
          void commit(completeSetup({ data: { name, companyName, phone } })).finally(() => setBusy(false));
        }}
      >
        {busy ? "Opening…" : "Create the desk"}
      </Button>
    </main>
  );
}
