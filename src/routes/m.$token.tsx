import { useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { consumeMagicLink } from "@/lib/server/fns";
import { Mark } from "@/components/mark";

export const Route = createFileRoute("/m/$token")({ component: Magic });

const BEARER_KEY = "grok-auth.bearer-token";

const pendingByToken = new Map<string, ReturnType<typeof consumeMagicLink>>();

function Magic() {
  const { token } = Route.useParams();
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    let pending = pendingByToken.get(token);
    if (!pending) {
      pending = consumeMagicLink({ data: { token } });
      pendingByToken.set(token, pending);
    }
    pending
      .then((result) => {
        if (!alive) return;
        if (!result.ok) {
          setError(result.error);
          return;
        }
        try {
          sessionStorage.setItem(BEARER_KEY, result.sessionToken);
        } catch {
          setError("This browser blocked the sign-in. Allow site data and open the link again.");
          return;
        }
        window.location.replace(result.redirect || "/");
      })
      .catch((cause: unknown) => {
        if (alive) setError(cause instanceof Error ? cause.message : "Could not sign you in.");
      });
    return () => {
      alive = false;
    };
  }, [token]);

  return (
    <main className="grid min-h-dvh place-items-center px-5">
      <div className="w-full max-w-md rounded-md border border-line bg-surface p-6">
        <div className="flex items-center gap-3">
          <Mark />
          <h1 className="text-2xl">{error ? "Link not accepted" : "Signing you in"}</h1>
        </div>
        <p className="mt-3 text-sm leading-relaxed text-muted">
          {error || "Checking this single-use email or text link."}
        </p>
        {error ? (
          <Link to="/login" className="mt-4 inline-flex h-11 items-center text-sm text-copper">
            Request a new link
          </Link>
        ) : null}
      </div>
    </main>
  );
}
