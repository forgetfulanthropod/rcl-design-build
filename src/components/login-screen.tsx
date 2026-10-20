import { useEffect, useState } from "react";
import { Link, Navigate } from "@tanstack/react-router";
import { authClient, GROK_PROVIDERS, signIn } from "@/lib/auth/client";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { debugSignIn, getDebugLogin, requestMagicLink, resetDemoData } from "@/lib/server/fns";
import { Mark } from "@/components/mark";
import { Button } from "@/components/ui";


/**
 * The sign-in screen. `next` is the deep link to land on after signing in (spec 05 · F1);
 * the server keeps it only if it's a same-origin desk path.
 */
export function Login({ next = "" }: { next?: string } = {}) {
  const { user, isPending } = useCurrentUserState();
  const [channel, setChannel] = useState<"email" | "sms">("email");
  const [destination, setDestination] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState<{ path: string | null; destination: string; channel: "email" | "sms" } | null>(
    null,
  );
  const [passwordEmail, setPasswordEmail] = useState("");
  const [password, setPassword] = useState("");

  if (isPending) {
    return (
      <main className="grid min-h-dvh place-items-center px-5">
        <div className="h-40 w-full max-w-md animate-pulse rounded-md bg-surface" />
      </main>
    );
  }
  if (user) return <Navigate to={next && next.startsWith("/") && !next.startsWith("//") ? next.split("?")[0] : "/"} />;

  async function sendLink() {
    setBusy(true);
    setError("");
    try {
      const result = await requestMagicLink({ data: { channel, destination, name, next } });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setSent({ path: result.previewPath ?? null, destination: result.destination, channel: result.channel });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not send the link.");
    } finally {
      setBusy(false);
    }
  }

  async function passwordSignIn() {
    setBusy(true);
    setError("");
    try {
      const existing = await authClient.signIn.email({
        email: passwordEmail.trim(),
        password,
      });
      if (existing.error) {
        const created = await authClient.signUp.email({
          email: passwordEmail.trim(),
          password,
          name: passwordEmail.split("@")[0] || "Crew",
        });
        if (created.error) setError(created.error.message || existing.error.message || "Could not sign in.");
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not sign in.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto grid min-h-dvh max-w-5xl md:grid-cols-2">
      <section className="hidden flex-col justify-between border-r border-line bg-surface p-10 md:flex">
        <div className="flex items-center gap-3">
          <Mark />
          <span className="font-medium">RCL Design Build</span>
        </div>
        <div>
          <h1 className="text-4xl text-fg">Sign in to the desk.</h1>
          <p className="mt-4 max-w-sm leading-relaxed text-muted">
            Design, the superintendent, and the office each sign in on their own email or phone. One
            link, then the job. From schematic design to finish.
          </p>
        </div>
        <p className="text-sm text-muted">Foreman will not ship a code change until Elvira approves it.</p>
      </section>
      <section className="flex flex-col justify-center px-5 py-10">
        <Link to="/" className="mb-8 flex items-center gap-3 md:hidden">
          <Mark />
          <span className="font-medium">RCL Design Build</span>
        </Link>
        <h1 className="text-3xl text-fg md:hidden">Sign in</h1>
        <p className="mt-2 text-sm text-muted md:mt-0">Email or text. One account per person.</p>
        <div className="mt-6 grid grid-cols-2 gap-2">
          {(["email", "sms"] as const).map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => setChannel(item)}
              className={`h-11 rounded-md border text-sm font-medium ${
                channel === item ? "border-copper bg-copper text-ink" : "border-line bg-surface text-fg"
              }`}
            >
              {item === "email" ? "Email" : "Text"}
            </button>
          ))}
        </div>
        <label className="mt-4 block text-sm text-muted" htmlFor="who">
          Name, if this is your first time
        </label>
        <input id="who" className="field mt-1" value={name} onChange={(e) => setName(e.target.value)} />
        <label className="mt-4 block text-sm text-muted" htmlFor="dest">
          {channel === "email" ? "Email" : "Mobile number"}
        </label>
        <input
          id="dest"
          className="field mt-1"
          inputMode={channel === "email" ? "email" : "tel"}
          autoComplete={channel === "email" ? "email" : "tel"}
          placeholder={channel === "email" ? "you@company.com" : "(859) 555-0140"}
          value={destination}
          onChange={(e) => setDestination(e.target.value)}
        />
        <Button className="mt-4 w-full" disabled={busy} onClick={() => void sendLink()}>
          {busy ? "Sending…" : channel === "email" ? "Email me a link" : "Text me a link"}
        </Button>
        <DebugRoles next={next} />
        {sent ? (
          <div className="mt-4 rounded-md border border-line bg-surface p-4">
            {sent.path ? (
              <>
                <p className="text-sm text-fg">
                  {sent.channel === "email" ? "Email" : "Text"} delivery is not set up on this desk, so
                  the link for {sent.destination} is here.
                </p>
                <a href={sent.path} className="mt-3 inline-flex h-11 items-center text-sm font-medium text-copper">
                  Open the magic link
                </a>
              </>
            ) : (
              <p className="text-sm text-fg">
                {sent.channel === "email" ? "Check your email." : "Check your texts."} We sent a single-use
                sign-in link to {sent.destination}. It expires in 30 minutes.
              </p>
            )}
          </div>
        ) : null}
        {error ? <p className="mt-3 text-sm text-danger">{error}</p> : null}
        <div className="my-6 h-px bg-line" />
        <div className="grid gap-2">
          {GROK_PROVIDERS.map((provider) => (
            <Button
              key={provider.providerId}
              tone="ghost"
              className="w-full"
              onClick={() => void signIn(provider.providerId, { callbackURL: "/" })}
            >
              Continue with {provider.label}
            </Button>
          ))}
        </div>
        <details className="mt-6">
          <summary className="cursor-pointer text-sm text-muted">Use a password instead</summary>
          <div className="mt-3 grid gap-2">
            <input
              className="field"
              type="email"
              placeholder="Email"
              value={passwordEmail}
              onChange={(e) => setPasswordEmail(e.target.value)}
            />
            <input
              className="field"
              type="password"
              placeholder="Password, 8 or more characters"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <Button tone="ghost" disabled={busy || password.length < 8} onClick={() => void passwordSignIn()}>
              Sign in or create account
            </Button>
          </div>
        </details>
      </section>
    </main>
  );
}

const DEBUG_LABELS: Record<string, string> = {
  owner: "Owner",
  admin: "Admin",
  lead: "Lead",
  labor: "Labor",
  subcontractor: "Subcontractor",
};

/** Debug-only role sign-in. The server decides whether it exists (DEBUG_LOGIN=true). */
function DebugRoles({ next = "" }: { next?: string }) {
  const [roles, setRoles] = useState<string[]>([]);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    let cancelled = false;
    getDebugLogin()
      .then((result) => {
        if (!cancelled && result.enabled) setRoles(result.roles);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);
  if (roles.length === 0) return null;
  return (
    <div className="mt-6 rounded-md border border-dashed border-copper/60 p-3" data-testid="debug-login">
      <p className="text-xs font-medium uppercase tracking-widest text-copper">Debug sign-in</p>
      <p className="mt-1 text-sm text-muted">
        Signs in to a separate demo company with fake data. Changes there are real and saved. Anyone can use this
        while it is on.
      </p>
      <div className="mt-3 grid grid-cols-2 gap-2">
        {roles.map((role) => (
          <button
            key={role}
            type="button"
            disabled={Boolean(busy)}
            onClick={() => {
              setBusy(role);
              setError("");
              debugSignIn({ data: { role, next } })
                .then((result) => window.location.assign(result.path))
                .catch((cause: unknown) => {
                  setBusy("");
                  setError(cause instanceof Error ? cause.message : "Could not sign in.");
                });
            }}
            className="h-11 rounded-md border border-line bg-surface text-sm text-fg"
          >
            {busy === role ? "Signing in…" : (DEBUG_LABELS[role] ?? role)}
          </button>
        ))}
      </div>
      <button
        type="button"
        disabled={Boolean(busy)}
        className="mt-3 h-11 w-full rounded-md text-sm text-muted underline"
        onClick={() => {
          if (!window.confirm("Reset the demo company? All demo changes are erased and fresh demo data is loaded.")) return;
          setBusy("reset");
          setError("");
          resetDemoData()
            .then(() => setError("Demo data reset."))
            .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "Could not reset."))
            .finally(() => setBusy(""));
        }}
      >
        {busy === "reset" ? "Resetting…" : "Reset demo data"}
      </button>
      {error ? <p className="mt-2 text-sm text-muted" role="status">{error}</p> : null}
    </div>
  );
}
