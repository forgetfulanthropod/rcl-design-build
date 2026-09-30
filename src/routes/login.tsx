import { useState } from "react";
import { createFileRoute, Link, Navigate } from "@tanstack/react-router";
import { authClient, GROK_PROVIDERS, signIn } from "@/lib/auth/client";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { requestMagicLink } from "@/lib/server/fns";
import { Mark } from "@/components/mark";
import { Button } from "@/components/ui";

export const Route = createFileRoute("/login")({ component: Login });

function Login() {
  const { user, isPending } = useCurrentUserState();
  const [channel, setChannel] = useState<"email" | "sms">("email");
  const [destination, setDestination] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState<{ path: string; destination: string; channel: "email" | "sms" } | null>(
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
  if (user) return <Navigate to="/" />;

  async function sendLink() {
    setBusy(true);
    setError("");
    try {
      const result = await requestMagicLink({ data: { channel, destination, name } });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setSent({ path: result.previewPath, destination: result.destination, channel: result.channel });
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
          <span className="font-medium">RCL Design-Build</span>
        </div>
        <div>
          <h1 className="text-4xl text-fg">A link, not a password locker.</h1>
          <p className="mt-4 max-w-sm leading-relaxed text-muted">
            Superintendents, techs, and the office each sign in on their own email or phone. The
            magic link is single-use. Google and X stay available when a desk already lives there.
          </p>
        </div>
        <p className="text-sm text-muted">Foreman will not ship a code change without an admin.</p>
      </section>
      <section className="flex flex-col justify-center px-5 py-10">
        <Link to="/" className="mb-8 flex items-center gap-3 md:hidden">
          <Mark />
          <span className="font-medium">RCL Design-Build</span>
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
        {sent ? (
          <div className="mt-4 rounded-md border border-line bg-surface p-4">
            <p className="text-sm text-fg">
              {sent.channel === "email" ? "Email" : "Text"} queued for {sent.destination}. This desk
              has no phone carrier, so the message is also here.
            </p>
            <a href={sent.path} className="mt-3 inline-flex h-11 items-center text-sm font-medium text-copper">
              Open the magic link
            </a>
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
