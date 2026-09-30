import { useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { decideProposal, getStaging, loadDesk } from "@/lib/server/fns";
import { lineDiff } from "@/lib/diff";
import { parseCopy, parseWorkflows } from "@/lib/product";
import { Mark } from "@/components/mark";
import { Button, Chip } from "@/components/ui";

export const Route = createFileRoute("/stage/$token")({ component: Stage });

type Proposal = {
  id: string;
  title: string;
  summary: string;
  filePath: string;
  baseContent: string;
  proposedContent: string;
  status: string;
  createdAt: string;
  companyName: string;
};

function Stage() {
  const { token } = Route.useParams();
  const { user, isPending } = useCurrentUserState();
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [error, setError] = useState("");
  const [admin, setAdmin] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");

  useEffect(() => {
    let cancelled = false;
    getStaging({ data: token })
      .then((result) => {
        if (cancelled) return;
        if (!result.ok) setError(result.error);
        else setProposal(result.proposal);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "Could not open staging.");
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  useEffect(() => {
    if (!user) return;
    loadDesk()
      .then((desk) => {
        if (!desk.needsSetup && desk.profile.role === "admin") setAdmin(true);
      })
      .catch(() => setAdmin(false));
  }, [user]);

  async function decide(status: "approved" | "rejected") {
    if (!proposal) return;
    setBusy(true);
    setNote("");
    try {
      await decideProposal({ data: { id: proposal.id, status } });
      setProposal({ ...proposal, status });
      setNote(status === "approved" ? "Live source updated." : "Rejected. Live source unchanged.");
    } catch (cause) {
      setNote(cause instanceof Error ? cause.message : "Could not record the decision.");
    } finally {
      setBusy(false);
    }
  }

  const diff = proposal ? lineDiff(proposal.baseContent, proposal.proposedContent) : [];
  let preview: { tagline?: string; phases?: string[]; statuses?: string[] } = {};
  if (proposal) {
    try {
      if (proposal.filePath.endsWith("copy.ts")) preview = { tagline: parseCopy(proposal.proposedContent).tagline };
      if (proposal.filePath.endsWith("workflows.ts")) {
        const next = parseWorkflows(proposal.proposedContent);
        preview = { phases: next.projectPhases, statuses: next.workOrderStatuses };
      }
    } catch {
      preview = {};
    }
  }

  return (
    <main className="mx-auto min-h-dvh max-w-5xl px-5 py-6">
      <header className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Mark />
          <div>
            <p className="text-xs uppercase tracking-widest text-copper">Staging build</p>
            <h1 className="text-2xl">{proposal?.title || "Review"}</h1>
          </div>
        </div>
        <Link to="/" className="text-sm text-muted">
          Desk
        </Link>
      </header>
      {error ? <p className="mt-6 text-danger">{error}</p> : null}
      {!proposal && !error ? <p className="mt-6 text-muted">Opening the staged source…</p> : null}
      {proposal ? (
        <div className="mt-6 grid gap-4 md:grid-cols-[1fr_0.8fr]">
          <section className="rounded-md border border-line bg-surface p-4">
            <div className="flex flex-wrap items-center gap-2">
              <Chip hot={proposal.status === "pending"}>{proposal.status}</Chip>
              <span className="text-sm text-muted">{proposal.filePath}</span>
            </div>
            <p className="mt-3 leading-relaxed text-fg">{proposal.summary}</p>
            <p className="mt-1 text-sm text-muted">{proposal.companyName}</p>
            <pre className="mt-4 max-h-[28rem] overflow-auto rounded-md bg-bg p-3 text-xs leading-relaxed">
              {diff.map((line, index) => (
                <div
                  key={`${line.kind}-${index}`}
                  className={
                    line.kind === "add" ? "text-pine" : line.kind === "del" ? "text-danger" : "text-muted"
                  }
                >
                  {line.kind === "add" ? "+ " : line.kind === "del" ? "− " : "  "}
                  {line.text || " "}
                </div>
              ))}
            </pre>
          </section>
          <aside className="grid content-start gap-4">
            <section className="rounded-md border border-copper bg-surface p-4">
              <p className="text-xs uppercase tracking-widest text-copper">If approved</p>
              {preview.tagline ? <p className="mt-3 font-display text-2xl">{preview.tagline}</p> : null}
              {preview.phases ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  {preview.phases.map((phase) => (
                    <Chip key={phase}>{phase}</Chip>
                  ))}
                </div>
              ) : null}
              {preview.statuses ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  {preview.statuses.map((status) => (
                    <Chip key={status}>{status}</Chip>
                  ))}
                </div>
              ) : null}
            </section>
            {proposal.status === "pending" && admin ? (
              <div className="grid grid-cols-2 gap-2">
                <Button disabled={busy} onClick={() => void decide("approved")}>
                  Approve
                </Button>
                <Button tone="ghost" disabled={busy} onClick={() => void decide("rejected")}>
                  Reject
                </Button>
              </div>
            ) : null}
            {proposal.status === "pending" && !admin && !isPending ? (
              <p className="text-sm text-muted">
                {user
                  ? "You can read this staging build. Only an admin can merge it."
                  : "Sign in as an admin to approve, or use the approve link from the text or email."}
              </p>
            ) : null}
            {!user && !isPending ? (
              <Link to="/login" className="text-sm text-copper">
                Sign in
              </Link>
            ) : null}
            {note ? <p className="text-sm text-pine">{note}</p> : null}
          </aside>
        </div>
      ) : null}
    </main>
  );
}
