import { useEffect, useState } from "react";
import { Bot, Building2, LayoutDashboard, Radio, Users, Wrench } from "lucide-react";
import { UserButton } from "@/lib/auth/gates";
import { completeSetup, loadDesk } from "@/lib/server/fns";
import { Mark } from "@/components/mark";
import { Button } from "@/components/ui";
import { CommsView, CrewView, DeskHome, FieldView, ForemanView, JobsView } from "@/components/desk-views";

type DeskResult = Awaited<ReturnType<typeof loadDesk>>;
type View = "desk" | "jobs" | "field" | "comms" | "foreman" | "crew";

const NAV: { id: View; label: string; icon: typeof Bot }[] = [
  { id: "desk", label: "Desk", icon: LayoutDashboard },
  { id: "jobs", label: "Jobs", icon: Building2 },
  { id: "field", label: "Field", icon: Wrench },
  { id: "comms", label: "Radio", icon: Radio },
  { id: "foreman", label: "Foreman", icon: Bot },
  { id: "crew", label: "Crew", icon: Users },
];

export function DeskApp() {
  const [data, setData] = useState<DeskResult | null>(null);
  const [error, setError] = useState("");
  const [view, setView] = useState<View>("desk");

  useEffect(() => {
    let cancelled = false;
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
  }, []);

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
      <main className="grid min-h-dvh place-items-center px-5">
        <p className="text-muted">{error || "Opening the desk…"}</p>
      </main>
    );
  }
  if (data.needsSetup) return <Setup email={data.email} suggestedName={data.suggestedName} commit={commit} />;

  const ready = data;
  const label = view === "jobs" ? ready.copy.jobsLabel : view === "field" ? ready.copy.fieldLabel : NAV.find((item) => item.id === view)?.label;

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
          {NAV.map((item) => (
            <NavButton key={item.id} item={item} active={view === item.id} onClick={() => setView(item.id)} />
          ))}
        </nav>
      </aside>
      <div className="flex min-w-0 flex-col pb-20 md:pb-0">
        <header className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
          <div className="min-w-0">
            <p className="truncate font-display text-2xl">{label}</p>
            <p className="truncate text-sm text-muted">{ready.copy.tagline}</p>
          </div>
          <UserButton />
        </header>
        {error ? <p className="px-4 pt-3 text-sm text-danger">{error}</p> : null}
        <div className="min-w-0 flex-1 px-4 py-4">
          {view === "desk" ? <DeskHome data={ready} open={setView} /> : null}
          {view === "jobs" ? <JobsView data={ready} commit={commit} /> : null}
          {view === "field" ? <FieldView data={ready} commit={commit} /> : null}
          {view === "comms" ? <CommsView data={ready} /> : null}
          {view === "foreman" ? <ForemanView data={ready} commit={commit} /> : null}
          {view === "crew" ? <CrewView data={ready} commit={commit} /> : null}
        </div>
      </div>
      <nav className="fixed inset-x-0 bottom-0 z-10 grid grid-cols-6 border-t border-line bg-surface md:hidden">
        {NAV.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setView(item.id)}
            className={`flex h-16 flex-col items-center justify-center gap-1 text-xs ${
              view === item.id ? "text-copper" : "text-muted"
            }`}
          >
            <item.icon className="size-5" aria-hidden="true" />
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
  commit,
}: {
  email: string;
  suggestedName: string;
  commit: (work: Promise<DeskResult>) => Promise<void>;
}) {
  const [name, setName] = useState(suggestedName);
  const [companyName, setCompanyName] = useState("RCL Design-Build");
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);

  return (
    <main className="mx-auto flex min-h-dvh max-w-lg flex-col justify-center px-5 py-10">
      <div className="flex items-center gap-3">
        <Mark />
        <h1 className="text-3xl">Open your company</h1>
      </div>
      <p className="mt-3 text-sm leading-relaxed text-muted">
        You are the first admin on this account{email ? ` (${email})` : ""}. Add a mobile number if
        you want Foreman to text staging links, not only email them.
      </p>
      <label className="mt-6 text-sm text-muted" htmlFor="setup-name">
        Your name
      </label>
      <input id="setup-name" className="field mt-1" value={name} onChange={(e) => setName(e.target.value)} />
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
        Mobile for texts, optional
      </label>
      <input
        id="setup-phone"
        className="field mt-1"
        inputMode="tel"
        value={phone}
        onChange={(e) => setPhone(e.target.value)}
      />
      <Button
        className="mt-5"
        disabled={busy}
        onClick={() => {
          setBusy(true);
          void commit(completeSetup({ data: { name, companyName, phone } })).finally(() => setBusy(false));
        }}
      >
        {busy ? "Opening…" : "Create the desk"}
      </Button>
    </main>
  );
}
