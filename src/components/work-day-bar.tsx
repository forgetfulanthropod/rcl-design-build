import { useState } from "react";
import {
  clockFromMinutes,
  inputToMinutes,
  labelSessions,
  minutesToInput,
  normalizeSession,
  sessionMinutes,
  type WorkSession,
} from "@/lib/work-sessions";

type Draft = { id?: string; start: string; end: string; projectId: string; projectName: string; notes: string };

const EMPTY: Draft = { start: "08:00", end: "16:00", projectId: "", projectName: "", notes: "" };

/**
 * The day's 24 hours. Each green block is a lettered session (a, b, c…) with a job and a start and end.
 * `canWrite` shows Add session. A row's Edit and Remove follow `canEditSession` (own hours vs someone else's).
 * `projects` is a job list (id + name). When `freeText` is set, the project is typed instead.
 */
export function WorkDayBar({
  sessions,
  projects,
  freeText = false,
  canWrite,
  canEditSession,
  dayLabel,
  onSave,
  onDelete,
}: {
  sessions: WorkSession[];
  projects: { id: string; name: string }[];
  freeText?: boolean;
  canWrite: boolean;
  /** Defaults to canWrite for every row. */
  canEditSession?: (session: WorkSession) => boolean;
  dayLabel?: string;
  onSave: (input: { id?: string; projectId: string | null; projectName: string; startMin: number; endMin: number; notes: string }) => Promise<void> | void;
  onDelete: (id: string) => Promise<void> | void;
}) {
  const labeled = labelSessions(sessions);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const total = labeled.reduce((sum, session) => sum + sessionMinutes(session), 0);
  const editable = (session: WorkSession) => (canEditSession ? canEditSession(session) : canWrite);
  const aria =
    labeled.length === 0
      ? "No hours logged yet"
      : `Hours worked: ${labeled.map((s) => `${s.letter} ${s.projectName} ${clockFromMinutes(s.startMin)} to ${clockFromMinutes(s.endMin)}`).join(", ")}`;

  function begin(session?: (typeof labeled)[number]) {
    setError("");
    setDraft(
      session
        ? {
            id: session.id,
            start: minutesToInput(session.startMin),
            end: minutesToInput(session.endMin === 1440 ? 23 * 60 + 59 : session.endMin),
            projectId: session.projectId ?? "",
            projectName: session.projectName === "Untitled" ? "" : session.projectName,
            notes: session.notes,
          }
        : { ...EMPTY, projectId: projects[0]?.id ?? "", projectName: projects[0]?.name ?? "" },
    );
    setOpen(true);
  }

  async function save() {
    const startMin = inputToMinutes(draft.start);
    const endMin = inputToMinutes(draft.end);
    if (startMin == null || endMin == null) {
      setError("Enter a start and end time.");
      return;
    }
    const projectName = freeText ? draft.projectName : (projects.find((p) => p.id === draft.projectId)?.name ?? "");
    const parsed = normalizeSession({ startMin, endMin, projectName, notes: draft.notes });
    if (!parsed.ok) {
      setError(parsed.error);
      return;
    }
    setBusy(true);
    setError("");
    try {
      await onSave({
        id: draft.id,
        projectId: freeText ? null : draft.projectId,
        projectName: parsed.value.projectName,
        startMin: parsed.value.startMin,
        endMin: parsed.value.endMin,
        notes: parsed.value.notes,
      });
      setOpen(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Couldn't save that session.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-md border border-line bg-surface p-4" data-testid="day-bar" data-source={freeText ? "local" : "server"} aria-label="Hours worked">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex items-baseline justify-between gap-2 text-sm">
            <span className="font-medium">
              Hours worked
              {dayLabel ? <span className="ml-2 font-normal text-muted">{dayLabel}</span> : null}
            </span>
            <span className="tabular-nums text-muted" data-testid="hours-total">
              {total === 0 ? "0h" : clockSpan(total)}
            </span>
          </div>
          <div className="relative h-9 rounded-md bg-raised" role="img" aria-label={aria}>
            {labeled.map((session) => (
              <div
                key={session.id}
                className="absolute top-1 bottom-1 overflow-hidden rounded-sm bg-[#1f8a4c] text-[11px] font-semibold leading-7 text-white"
                style={{
                  left: `${(session.startMin / 1440) * 100}%`,
                  width: `${Math.max(((session.endMin - session.startMin) / 1440) * 100, 0.8)}%`,
                }}
                title={`${session.letter} ${session.projectName}`}
              >
                <span className="px-1">{session.letter}</span>
              </div>
            ))}
          </div>
          <div className="mt-1 flex justify-between text-[11px] tabular-nums text-muted" aria-hidden="true">
            <span>12a</span>
            <span>6a</span>
            <span>12p</span>
            <span>6p</span>
            <span>12a</span>
          </div>
        </div>
        {canWrite ? (
          <button
            type="button"
            data-testid="add-session"
            className="mt-6 inline-flex h-11 shrink-0 items-center rounded-md border border-line bg-raised px-3 text-sm font-medium"
            onClick={() => (open && !draft.id ? setOpen(false) : begin())}
          >
            Add session
          </button>
        ) : null}
      </div>

      {labeled.length > 0 ? (
        <ul className="mt-3 grid gap-2" data-testid="session-list">
          {labeled.map((session) => (
            <li key={session.id} data-testid="session-row" className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm">
              <span className="font-semibold text-[#8fbfa4]">{session.letter}</span>
              <span className="tabular-nums text-muted">
                {clockFromMinutes(session.startMin)}–{clockFromMinutes(session.endMin)}
              </span>
              <span className="font-medium">{session.projectName}</span>
              {session.notes ? <span className="text-muted">{session.notes}</span> : null}
              {session.userName ? <span className="text-muted">{session.userName}</span> : null}
              {editable(session) ? (
                <span className="ml-auto flex gap-2">
                  <button type="button" className="text-sm text-copper" data-testid="edit-session" onClick={() => begin(session)}>
                    Edit
                  </button>
                  <button
                    type="button"
                    className="text-sm text-muted"
                    data-testid="remove-session"
                    onClick={() => {
                      void Promise.resolve(onDelete(session.id)).catch((cause: unknown) =>
                        setError(cause instanceof Error ? cause.message : "Couldn't remove that session."),
                      );
                    }}
                  >
                    Remove
                  </button>
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      {open ? (
        <form
          data-testid="session-form"
          className="mt-3 grid gap-3 border-t border-line pt-3"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <div className="grid grid-cols-2 gap-3">
            <label className="text-sm">
              Start
              <input className="field mt-1" type="time" required value={draft.start} onChange={(event) => setDraft({ ...draft, start: event.target.value })} />
            </label>
            <label className="text-sm">
              End
              <input className="field mt-1" type="time" required value={draft.end} onChange={(event) => setDraft({ ...draft, end: event.target.value })} />
            </label>
          </div>
          {freeText ? (
            <label className="text-sm">
              Project / job
              <input
                className="field mt-1"
                required
                list="session-projects"
                value={draft.projectName}
                placeholder="Project A"
                onChange={(event) => setDraft({ ...draft, projectName: event.target.value })}
              />
              <datalist id="session-projects">
                {projects.map((project) => (
                  <option key={project.id || project.name} value={project.name} />
                ))}
              </datalist>
            </label>
          ) : (
            <label className="text-sm">
              Project / job
              <select
                className="field mt-1"
                required
                value={draft.projectId}
                onChange={(event) => setDraft({ ...draft, projectId: event.target.value })}
              >
                <option value="">Choose a job</option>
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="text-sm">
            Notes
            <textarea
              className="field mt-1 min-h-16"
              value={draft.notes}
              maxLength={500}
              placeholder="demolish fence"
              onChange={(event) => setDraft({ ...draft, notes: event.target.value })}
            />
          </label>
          {error ? (
            <p className="text-sm text-danger" role="alert">
              {error}
            </p>
          ) : null}
          <div className="flex gap-2">
            <button type="submit" className="inline-flex h-11 items-center rounded-md bg-[#1f8a4c] px-4 text-sm font-semibold text-white disabled:opacity-60" disabled={busy}>
              {busy ? "Saving…" : draft.id ? "Save session" : "Add to the day"}
            </button>
            <button type="button" className="inline-flex h-11 items-center rounded-md px-3 text-sm text-muted" onClick={() => setOpen(false)}>
              Cancel
            </button>
          </div>
        </form>
      ) : null}
    </section>
  );
}

function clockSpan(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}
