import { useEffect, useState } from "react";
import { WorkDayBar } from "@/components/work-day-bar";
import { createWorkSession, deleteWorkSession, listWorkSessions, updateWorkSession } from "@/lib/server/fns";
import type { WorkSession } from "@/lib/work-sessions";

/** The signed-in person's sessions for a daily report, stored with the company. */
export function ReportWorkSessions({ day, jobs }: { day: string; jobs: { id: string; name: string }[] }) {
  const [sessions, setSessions] = useState<WorkSession[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    let live = true;
    listWorkSessions({ data: { day, scope: "mine" } })
      .then((rows) => {
        if (live) setSessions(rows);
      })
      .catch((cause: unknown) => {
        if (live) setError(cause instanceof Error ? cause.message : "Couldn't load work sessions.");
      });
    return () => {
      live = false;
    };
  }, [day]);

  return (
    <div className="grid gap-2">
      {error ? (
        <p className="text-sm text-danger" role="alert">
          {error}
        </p>
      ) : null}
      <WorkDayBar
        sessions={sessions}
        projects={jobs}
        canWrite
        onSave={async (input) => {
          if (!input.projectId) throw new Error("Choose a project.");
          const saved = input.id
            ? await updateWorkSession({
                data: { id: input.id, day, projectId: input.projectId, startMin: input.startMin, endMin: input.endMin, notes: input.notes },
              })
            : await createWorkSession({
                data: { day, projectId: input.projectId, startMin: input.startMin, endMin: input.endMin, notes: input.notes },
              });
          setSessions((list) => {
            const next = list.filter((session) => session.id !== saved.id);
            next.push(saved);
            return next;
          });
        }}
        onDelete={async (id) => {
          await deleteWorkSession({ data: { id } });
          setSessions((list) => list.filter((session) => session.id !== id));
        }}
      />
    </div>
  );
}
