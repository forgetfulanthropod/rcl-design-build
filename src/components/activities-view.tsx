import { useEffect, useState } from "react";
import { approveActivity, createActivity, listActivities, overviewActivities, updateActivity } from "@/lib/server/fns";
import { localDay, longDay } from "@/components/today-report";
import { DocumentRail } from "@/components/documents-view";
import { JobSelect } from "@/components/job-select";
import { useCurrentJob } from "@/lib/use-current-job";
import { BigButton, Button, EmptyState, ErrorBanner, Skeleton } from "@/components/ui";

type Board = Awaited<ReturnType<typeof listActivities>>;
type Card = Board["activities"][number];

export function ActivitiesView({ onOpenDocs }: { onOpenDocs?: () => void }) {
  const today = localDay();
  const [day, setDay] = useState(today);
  const [board, setBoard] = useState<Board | null>(null);
  const [error, setError] = useState("");
  const [title, setTitle] = useState("");
  const [detail, setDetail] = useState("");
  const job = useCurrentJob();
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editDetail, setEditDetail] = useState("");
  const [editProject, setEditProject] = useState("");

  useEffect(() => {
    let cancelled = false;
    setError("");
    setBoard(null);
    listActivities({ data: { day } })
      .then((next) => {
        if (!cancelled) setBoard(next);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "Could not load activities.");
      });
    return () => {
      cancelled = true;
    };
  }, [day]);

  async function run(work: Promise<Board>, after?: () => void) {
    setBusy(true);
    setError("");
    try {
      setBoard(await work);
      after?.();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save that.");
    } finally {
      setBusy(false);
    }
  }

  function startEdit(card: Card) {
    setEditing(card.id);
    setEditTitle(card.title);
    setEditDetail(card.detail);
    setEditProject(card.projectId ?? "");
  }

  return (
    <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
    <div className="mx-auto grid w-full max-w-2xl gap-4 lg:mx-0 lg:max-w-none" data-testid="activities">
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => setDay(today)}
          className={`h-11 rounded-md border text-sm ${day === today ? "border-copper bg-copper text-ink" : "border-line text-fg"}`}
        >
          Today
        </button>
        <input
          type="date"
          aria-label="Activity day"
          className="field"
          value={day}
          onChange={(event) => setDay(event.target.value)}
        />
      </div>
      {error ? <ErrorBanner message={error} /> : null}
      {!board ? (
        <Skeleton lines={3} label="Loading activities" />
      ) : (
        <>
          {board.canEdit ? (
            <form
              className="grid gap-2 rounded-md border border-line bg-surface p-4"
              onSubmit={(event) => {
                event.preventDefault();
                if (!title.trim()) return;
                if (!job.projectId) return setError("Pick a job.");
                void run(createActivity({ data: { day, title, detail, projectId: job.projectId } }), () => {
                  setTitle("");
                  setDetail("");
                  job.reset();
                });
              }}
            >
              <label className="text-sm text-muted" htmlFor="act-title">
                Activity
              </label>
              <input
                id="act-title"
                className="field"
                value={title}
                placeholder="What needs doing"
                onChange={(event) => setTitle(event.target.value)}
              />
              <label className="text-sm text-muted" htmlFor="act-detail">
                Detail
              </label>
              <textarea
                id="act-detail"
                className="field min-h-20"
                value={detail}
                onChange={(event) => setDetail(event.target.value)}
              />
              <JobSelect id="act-job" jobs={board.jobs} value={job.projectId} onChange={job.setProjectId} currentHint={job.isCurrent} />
              <BigButton type="submit" disabled={busy || !title.trim() || !job.projectId}>
                Add activity
              </BigButton>
            </form>
          ) : null}
          {board.activities.length === 0 ? (
            <EmptyState title="No activities this day" body="Add the work for the crew. A lead approves it." />
          ) : (
            <ul className="grid gap-3">
              {board.activities.map((card) => {
                const locked = card.status === "approved" && !board.canApprove;
                const open = editing === card.id;
                return (
                  <li key={card.id} className="rounded-md border border-line bg-surface p-4" data-testid="activity-card">
                    {open ? (
                      <form
                        className="grid gap-2"
                        onSubmit={(event) => {
                          event.preventDefault();
                          void run(
                            updateActivity({
                              data: { id: card.id, title: editTitle, detail: editDetail, projectId: editProject },
                            }),
                            () => setEditing(null),
                          );
                        }}
                      >
                        <input className="field" aria-label="Activity title" value={editTitle} onChange={(event) => setEditTitle(event.target.value)} />
                        <textarea className="field min-h-20" aria-label="Activity detail" value={editDetail} onChange={(event) => setEditDetail(event.target.value)} />
                        <JobSelect id={`act-edit-job-${card.id}`} jobs={board.jobs} value={editProject} onChange={setEditProject} labelClassName="sr-only" />
                        <div className="grid grid-cols-2 gap-2">
                          <Button type="submit" disabled={busy || !editTitle.trim() || !editProject}>
                            Save
                          </Button>
                          <Button type="button" tone="ghost" onClick={() => setEditing(null)}>
                            Cancel
                          </Button>
                        </div>
                      </form>
                    ) : (
                      <>
                        <div className="flex items-start justify-between gap-3">
                          <h3 className="text-lg text-fg">{card.title}</h3>
                          <span className={`shrink-0 text-sm ${card.status === "approved" ? "text-copper" : "text-muted"}`}>
                            {card.status === "approved" ? "Approved" : "Open"}
                          </span>
                        </div>
                        {card.projectName ? <p className="mt-1 text-sm text-copper">{card.projectName}</p> : null}
                        {card.detail ? <p className="mt-2 whitespace-pre-wrap text-base leading-relaxed text-fg">{card.detail}</p> : null}
                        <p className="mt-2 text-sm text-muted">Added by {card.createdByName || "crew"}</p>
                        <div className="mt-3 grid grid-cols-2 gap-2">
                          {board.canEdit && !locked ? (
                            <Button type="button" tone="ghost" onClick={() => startEdit(card)}>
                              Edit
                            </Button>
                          ) : null}
                          {board.canApprove && card.status !== "approved" ? (
                            <Button type="button" disabled={busy} onClick={() => void run(approveActivity({ data: card.id }))}>
                              Approve
                            </Button>
                          ) : null}
                        </div>
                      </>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </div>
    {onOpenDocs ? <DocumentRail onOpen={onOpenDocs} /> : null}
    </div>
  );
}

function shift(day: string, days: number): string {
  const date = new Date(`${day}T12:00:00`);
  date.setDate(date.getDate() + days);
  return localDay(date);
}

type Overview = Awaited<ReturnType<typeof overviewActivities>>;

/** Owner and admin view: counts and the work, grouped by job. */
export function ActivityOverview({ onOpenDocs }: { onOpenDocs?: () => void }) {
  const today = localDay();
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [projectId, setProjectId] = useState("");
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [moreFilters, setMoreFilters] = useState(false);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setError("");
    overviewActivities({ data: { from: from <= to ? from : to, to: from <= to ? to : from, projectId } })
      .then((next) => {
        if (!cancelled) setData(next);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "Could not load the overview.");
      });
    return () => {
      cancelled = true;
    };
  }, [from, to, projectId, tick]);

  async function approve(id: string) {
    setBusy(true);
    setError("");
    try {
      await approveActivity({ data: id });
      setTick((n) => n + 1);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not approve that.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_18rem]">
    <div className="grid gap-4 lg:grid-cols-[18rem_1fr]" data-testid="activity-overview">
      <form className="grid content-start gap-2 rounded-md border border-line bg-surface p-4" onSubmit={(event) => event.preventDefault()} aria-label="Filter activities">
        <div className="grid grid-cols-3 gap-2">
          {[
            ["Today", today, today],
            ["Yesterday", shift(today, -1), shift(today, -1)],
            ["7 days", shift(today, -6), today],
          ].map(([label, start, end]) => (
            <button
              key={label}
              type="button"
              onClick={() => {
                setFrom(start);
                setTo(end);
              }}
              className={`h-11 rounded-md border text-sm ${from === start && to === end ? "border-copper bg-copper text-ink" : "border-line text-fg"}`}
            >
              {label}
            </button>
          ))}
        </div>
        <button
          type="button"
          className="h-11 rounded-md text-sm text-copper underline lg:hidden"
          aria-expanded={moreFilters}
          onClick={() => setMoreFilters((value) => !value)}
        >
          {moreFilters ? "Fewer filters" : "Dates and job"}
        </button>
        <div className={`${moreFilters ? "grid" : "hidden"} gap-2 lg:grid`}>
          <label className="text-sm text-muted" htmlFor="ov-from">From</label>
          <input id="ov-from" type="date" className="field" value={from} onChange={(event) => setFrom(event.target.value)} />
          <label className="text-sm text-muted" htmlFor="ov-to">To</label>
          <input id="ov-to" type="date" className="field" value={to} onChange={(event) => setTo(event.target.value)} />
          <label className="text-sm text-muted" htmlFor="ov-job">Job</label>
          <select id="ov-job" className="field" value={projectId} onChange={(event) => setProjectId(event.target.value)}>
            <option value="">All jobs</option>
            {data?.jobs.map((job) => (
              <option key={job.id} value={job.id}>
                {job.name}
              </option>
            ))}
          </select>
        </div>
      </form>
      <div className="grid content-start gap-3">
        {error ? <ErrorBanner message={error} /> : null}
        {!data ? (
          <Skeleton lines={4} label="Loading the overview" />
        ) : (
          <>
            <p className="text-sm text-muted" data-testid="activity-counts">
              {data.open} open · {data.approved} approved
              {data.groups.length ? ` · ${data.groups.length} job${data.groups.length === 1 ? "" : "s"}` : ""}
            </p>
            {data.groups.length === 0 ? (
              <EmptyState title="No activities in this range" body="Try another day or job. Leads and labor add the work." />
            ) : (
              data.groups.map((group) => (
                <section key={group.projectId ?? "none"} className="rounded-md border border-line bg-surface p-4">
                  <header className="flex flex-wrap items-baseline justify-between gap-2">
                    <h2 className="text-lg text-fg">{group.projectName}</h2>
                    <p className="text-sm text-muted">
                      {group.open} open · {group.approved} approved
                    </p>
                  </header>
                  <ul className="mt-3 grid gap-3">
                    {group.activities.map((item) => (
                      <li key={item.id} className="border-t border-line pt-3" data-testid="overview-activity">
                        <div className="flex items-start justify-between gap-3">
                          <h3 className="text-base text-fg">{item.title}</h3>
                          <span className={`shrink-0 text-sm ${item.status === "approved" ? "text-copper" : "text-muted"}`}>
                            {item.status === "approved" ? "Approved" : "Open"}
                          </span>
                        </div>
                        {item.detail ? <p className="mt-1 whitespace-pre-wrap text-base leading-relaxed text-fg">{item.detail}</p> : null}
                        <p className="mt-1 text-sm text-muted">
                          {longDay(item.day)} · {item.createdByName || "crew"}
                          {item.status === "approved" && item.approvedByName ? ` · approved by ${item.approvedByName}` : ""}
                        </p>
                        {data.canApprove && item.status !== "approved" ? (
                          <Button type="button" className="mt-2" disabled={busy} onClick={() => void approve(item.id)}>
                            Approve
                          </Button>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </section>
              ))
            )}
          </>
        )}
      </div>
    </div>
    {onOpenDocs ? <DocumentRail onOpen={onOpenDocs} /> : null}
    </div>
  );
}
