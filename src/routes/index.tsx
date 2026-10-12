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
          <span className="text-sm font-medium tracking-wide text-fg">RCL Design Build</span>
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
          <p className="text-sm font-medium uppercase tracking-widest text-copper">Lexington design-build</p>
          <h1 className="mt-3 max-w-xl text-5xl leading-none text-fg md:text-6xl">
            Building smart.
          </h1>
          <p className="mt-5 max-w-lg text-lg leading-relaxed text-muted">
            The operations desk for RCL Design Build. Schematic design through finish, on one board:
            architectural design, remodels, additions, restoration, new construction, and commercial
            fit-up. Foreman can draft a change to the desk, and Elvira approves it before it goes live.
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
            ["Jobs", "Schematic through finish. Sheets, RFIs, change orders, daily logs."],
            ["Site", "Remodels, repairs, fit-ups, and punch, held to priority."],
            ["Foreman", "Drafts a desk change, then waits for Elvira."],
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
