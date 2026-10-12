import { useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { consumeMagicLink } from "@/lib/server/fns";
import { Mark } from "@/components/mark";
import {
  BEARER_STORAGE_KEY,
  settleMagicAttempt,
  signInDocument,
  signInErrorDocument,
  type MagicResult,
} from "@/lib/sign-in-complete";

function tokenFrom(request: Request, params: { token?: string }): string {
  if (params.token) return params.token;
  const path = new URL(request.url).pathname.split("/").filter(Boolean);
  return path[path.length - 1] ?? "";
}

function htmlResponse(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

export const Route = createFileRoute("/m/$token")({
  server: {
    handlers: {
      GET: async ({ request, params }: { request: Request; params: { token?: string } }) => {
        try {
          const { consumeToken } = await import("@/lib/server/magic.server");
          const result = await consumeToken(tokenFrom(request, params));
          if (!result.ok) return htmlResponse(signInErrorDocument(result.error));
          return htmlResponse(signInDocument({ sessionToken: result.sessionToken, redirect: result.redirect }));
        } catch (error) {
          const message = error instanceof Error ? error.message : "Could not sign you in.";
          return htmlResponse(signInErrorDocument(message), 500);
        }
      },
    },
  },
  component: Magic,
});

const pendingByToken = new Map<string, Promise<MagicResult>>();

function Magic() {
  const token = Route.useParams().token ?? "";
  const [error, setError] = useState("");
  const [next, setNext] = useState("");

  useEffect(() => {
    let finished = false;
    const timer = window.setTimeout(() => {
      if (finished) return;
      const decision = settleMagicAttempt({ result: null, timedOut: true });
      if (decision.action === "error") setError(decision.message);
    }, 12000);

    let pending = pendingByToken.get(token);
    if (!pending) {
      pending = consumeMagicLink({ data: { token } });
      pendingByToken.set(token, pending);
    }

    pending
      .then((result) => {
        window.clearTimeout(timer);
        if (finished && !result.ok) return;
        finished = true;
        const decision = settleMagicAttempt({ result, timedOut: false });
        if (decision.action === "error") {
          setError(decision.message);
          return;
        }
        if (decision.action !== "redirect") return;
        try {
          sessionStorage.setItem(BEARER_STORAGE_KEY, decision.sessionToken);
        } catch {
          setError("This browser blocked the sign-in. Allow site data and open the link again.");
          return;
        }
        setNext(decision.redirect);
        window.location.replace(decision.redirect);
      })
      .catch((cause: unknown) => {
        window.clearTimeout(timer);
        if (finished) return;
        finished = true;
        setError(cause instanceof Error ? cause.message : "Could not sign you in.");
      });

    return () => {
      window.clearTimeout(timer);
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
        {next ? (
          <a href={next} className="mt-4 inline-flex h-11 items-center text-sm text-copper">
            Continue to the desk
          </a>
        ) : null}
        {error ? (
          <Link to="/login" className="mt-4 inline-flex h-11 items-center text-sm text-copper">
            Request a new link
          </Link>
        ) : null}
      </div>
    </main>
  );
}
