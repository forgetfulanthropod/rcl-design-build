import { useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { WorkDayBar } from "@/components/work-day-bar";
import { photoCaptionHeading } from "@/lib/photo-caption";
import { SHARE_UNAVAILABLE, type ActivitySnapshot } from "@/lib/activity-share";
import { getActivityShare } from "@/lib/server/fns";
import type { WorkSession } from "@/lib/work-sessions";

export const Route = createFileRoute("/share/$token")({
  head: () => ({
    meta: [
      { title: "Shared day" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: SharedDay,
});

function clock(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function SharedDay() {
  const { token } = Route.useParams();
  const [share, setShare] = useState<ActivitySnapshot | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let live = true;
    getActivityShare({ data: token })
      .then((result) => {
        if (!live) return;
        if (!result.ok) setError(result.error || SHARE_UNAVAILABLE);
        else setShare(result.share);
      })
      .catch(() => {
        if (live) setError(SHARE_UNAVAILABLE);
      });
    return () => {
      live = false;
    };
  }, [token]);

  const sessions: WorkSession[] = (share?.sessions ?? []).map((session) => ({
    id: session.id,
    day: share?.day ?? "",
    projectId: null,
    projectName: session.project,
    startMin: session.startMin,
    endMin: session.endMin,
    notes: session.notes,
  }));

  return (
    <main className="mx-auto max-w-lg px-4 py-8">
      <p className="text-sm text-muted">Shared day</p>
      <h1 className="mt-1 text-2xl font-semibold">{share ? share.day : "Activity log"}</h1>
      {error ? (
        <p className="mt-6 text-sm text-muted" role="status">
          {error}
        </p>
      ) : null}
      {share ? (
        <div className="mt-6 grid gap-4">
          {sessions.length > 0 ? (
            <WorkDayBar sessions={sessions} projects={[]} canWrite={false} onSave={() => {}} onDelete={() => {}} />
          ) : null}
          {share.entries.map((entry) =>
            entry.kind === "photo" ? (
              <figure key={entry.id} className="rounded border border-line bg-raised p-3" data-testid="photo-caption">
                {entry.project ? <p className="mb-1 text-xs text-muted">{entry.project}</p> : null}
                {entry.image ? <img src={entry.image} alt="" className="max-h-48 rounded" /> : null}
                <figcaption className="mt-2">
                  <p className="text-sm font-medium tabular-nums" data-testid="photo-caption-time">
                    {photoCaptionHeading({ takenAt: entry.takenAt, takenSource: entry.takenSource }, clock) || "Time not recorded"}
                  </p>
                  {entry.body ? <p className="mt-1 whitespace-pre-wrap">{entry.body}</p> : null}
                </figcaption>
              </figure>
            ) : (
              <div key={entry.id} className="rounded border border-line bg-raised p-3">
                <p className="mb-1 text-xs text-muted">
                  {entry.ts ? clock(entry.ts) : ""}
                  {entry.project ? ` · ${entry.project}` : ""}
                </p>
                <p className="whitespace-pre-wrap">{entry.body}</p>
              </div>
            ),
          )}
        </div>
      ) : null}
      <p className="mt-8 text-sm">
        <Link to="/tracking" className="text-copper">
          Activity log
        </Link>
      </p>
    </main>
  );
}
