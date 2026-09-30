import { createFileRoute, Link } from "@tanstack/react-router";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { DeskApp } from "@/components/desk-app";
import { Mark } from "@/components/mark";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  const { user, isPending } = useCurrentUserState();
  if (isPending) return <Intro showEntry={false} />;
  if (!user) return <Intro showEntry />;
  return <DeskApp />;
}

function Intro({ showEntry }: { showEntry: boolean }) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-5xl flex-col px-5 py-8 md:px-10">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Mark />
          <span className="text-sm font-medium tracking-wide text-fg">RCL Design-Build</span>
        </div>
        {showEntry ? (
          <Link to="/login" className="text-sm text-copper">
            Sign in
          </Link>
        ) : (
          <span className="h-5 w-16 animate-pulse rounded bg-raised" />
        )}
      </header>
      <div className="grid flex-1 content-center gap-10 py-12 md:grid-cols-[1.3fr_0.7fr] md:items-end">
        <div>
          <p className="text-sm font-medium uppercase tracking-widest text-copper">Design-build + field service</p>
          <h1 className="mt-3 max-w-xl text-5xl leading-none text-fg md:text-6xl">
            One desk for the job and the truck.
          </h1>
          <p className="mt-5 max-w-lg text-lg leading-relaxed text-muted">
            RCL replaces the split between a project system and a dispatch board. Drawings, RFIs,
            change orders, and service calls sit together. Every account can talk to Foreman. Foreman
            does not edit the product until an admin opens the staging link from a text or email.
          </p>
          {showEntry ? (
            <Link
              to="/login"
              className="mt-8 inline-flex h-11 items-center rounded-md bg-copper px-5 text-sm font-medium text-ink"
            >
              Sign in with email or text
            </Link>
          ) : null}
        </div>
        <ul className="grid gap-3">
          {[
            ["Jobs", "Phases, sheets, RFIs, change orders, daily logs."],
            ["Field", "Work orders by trade, priority, and who is rolling."],
            ["Foreman", "A bot that proposes code, then waits for an admin."],
          ].map(([title, body]) => (
            <li key={title} className="rounded-md border border-line bg-surface p-4">
              <p className="font-display text-xl text-fg">{title}</p>
              <p className="mt-1 text-sm leading-relaxed text-muted">{body}</p>
            </li>
          ))}
        </ul>
      </div>
    </main>
  );
}
