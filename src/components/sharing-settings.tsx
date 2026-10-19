import { useCallback, useEffect, useState, type ReactNode } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import * as Switch from "@radix-ui/react-switch";
import {
  getReviewPreview,
  getSharingOverview,
  getSharingProject,
  listSharingAudit,
  markProjectReviewed,
  requestSharingReview,
  setCompanySharing,
  setProjectSharing,
} from "@/lib/server/fns";
import { Button, Chip, EmptyState, ErrorBanner, Skeleton } from "@/components/ui";
import { useOnline } from "@/lib/use-online";
import { SHARING_HELP, SHARING_KEYS, SHARING_LABEL, describeEffective, type EffectiveSnapshot, type SharingKey } from "@/lib/sharing";

type Overview = Awaited<ReturnType<typeof getSharingOverview>>;
type ProjectDetail = Awaited<ReturnType<typeof getSharingProject>>;
type Audit = Awaited<ReturnType<typeof listSharingAudit>>;
type Preview = Awaited<ReturnType<typeof getReviewPreview>>;
type Tab = "company" | "projects" | "log";

const errorText = (cause: unknown, fallback: string) => (cause instanceof Error ? cause.message : fallback);
const when = (value: string) =>
  value ? new Date(value).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "";
const day = (value: string) => (value ? new Date(value).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "");

const IMPACT: Record<SharingKey, { who: string; verb: string }> = {
  lead_budget_dollars: { who: "Leads", verb: "seeing dollars" },
  labor_doc_send: { who: "Labor", verb: "sending documents" },
};

/** "Leads see dollars: Off (company default)" / "Labor can send documents: On (this job)". */
function SnapshotRows({ snapshot }: { snapshot: EffectiveSnapshot }) {
  return (
    <ul className="grid gap-1" data-testid="snapshot">
      {SHARING_KEYS.map((key) => (
        <li key={key} className="text-base text-fg">
          {SHARING_LABEL[key]}: <strong>{snapshot[key].value ? "On" : "Off"}</strong>{" "}
          <span className="text-muted">({snapshot[key].source === "project" ? "this job" : "company default"})</span>
        </li>
      ))}
    </ul>
  );
}

function Confirm({
  open,
  title,
  children,
  confirm,
  busy,
  error,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  children: ReactNode;
  confirm: string;
  busy: boolean;
  error: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={(next) => (next ? null : onCancel())}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/60" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 grid w-[min(92vw,30rem)] -translate-x-1/2 -translate-y-1/2 gap-3 rounded-md border border-line bg-surface p-5">
          <Dialog.Title className="font-display text-xl text-fg">{title}</Dialog.Title>
          <Dialog.Description asChild>
            <div className="grid gap-3">{children}</div>
          </Dialog.Description>
          {error ? <ErrorBanner message={error} /> : null}
          <div className="flex justify-end gap-2">
            <Button type="button" tone="ghost" onClick={onCancel}>
              Cancel
            </Button>
            <Button type="button" disabled={busy} onClick={onConfirm}>
              {confirm}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/**
 * Settings → Sharing (spec 06 rev 3): Company defaults · Projects · Change log, and the per-job
 * page where ONE job is marked reviewed. Owner, Admin and superadmin only; the server enforces it.
 */
export function SharingSettings({
  projectId,
  onOpenProject,
  onChanged,
}: {
  projectId: string;
  onOpenProject: (id: string) => void;
  /** Something was saved (refresh the header badge). */
  onChanged?: () => void;
}) {
  const [tab, setTab] = useState<Tab>("company");
  const [notice, setNoticeText] = useState("");
  const setNotice = (text: string) => {
    setNoticeText(text);
    onChanged?.();
  };
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(""), 6000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  return (
    <div className="mx-auto grid max-w-4xl gap-4" data-testid="sharing-settings">
      <div className="flex gap-1 overflow-x-auto border-b border-line" role="tablist" aria-label="Sharing settings">
        {(
          [
            ["company", "Company defaults"],
            ["projects", "Projects"],
            ["log", "Change log"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={!projectId && tab === id}
            onClick={() => {
              setTab(id);
              onOpenProject("");
            }}
            className={`h-11 shrink-0 border-b-2 px-3 text-sm ${!projectId && tab === id ? "border-copper text-fg" : "border-transparent text-muted"}`}
          >
            {label}
          </button>
        ))}
      </div>
      {notice ? (
        <p role="status" className="rounded-md border border-pine bg-surface px-4 py-3 text-base text-fg" data-testid="sharing-status">
          {notice}
        </p>
      ) : null}
      {projectId ? (
        <ProjectSharing key={projectId} projectId={projectId} onBack={() => onOpenProject("")} onNotice={setNotice} />
      ) : tab === "company" ? (
        <CompanyDefaults onNotice={setNotice} />
      ) : tab === "projects" ? (
        <Projects onOpen={onOpenProject} />
      ) : (
        <ChangeLog />
      )}
    </div>
  );
}

function useLoad<T>(load: () => Promise<T>) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setError("");
    load()
      .then((next) => !cancelled && setData(next))
      .catch((cause: unknown) => !cancelled && setError(errorText(cause, "Could not load sharing settings.")));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt]);
  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  return { data, setData, error, retry };
}

function CompanyDefaults({ onNotice }: { onNotice: (text: string) => void }) {
  const online = useOnline();
  const { data, error, retry } = useLoad<Overview>(() => getSharingOverview());
  const [pending, setPending] = useState<{ key: SharingKey; value: boolean } | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState("");

  if (error) return <ErrorBanner message={error} onRetry={retry} />;
  if (!data) return <Skeleton lines={2} label="Loading sharing settings" />;

  const impact = (key: SharingKey, value: boolean) => {
    const overriding = data.projects.filter((p) => p.review === "reviewed" && p.values[key] !== null).length;
    const following = data.projects.length - overriding;
    const { who, verb } = IMPACT[key];
    const jobs = (n: number) => `${n} job${n === 1 ? "" : "s"}`;
    return `${who} on ${jobs(following)} will ${value ? "start" : "stop"} ${verb}${overriding ? ` (${jobs(overriding)} override this)` : ""}.`;
  };

  async function save() {
    if (!pending) return;
    setBusy(true);
    setSaveError("");
    try {
      await setCompanySharing({ data: { key: pending.key, value: pending.value, note } });
      onNotice(`${SHARING_LABEL[pending.key]} is ${pending.value ? "On" : "Off"} for the company.`);
      setPending(null);
      setNote("");
      retry();
    } catch (cause) {
      setSaveError(errorText(cause, "Could not save that."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="grid gap-3" aria-label="Company defaults">
      {SHARING_KEYS.map((key) => (
        <article key={key} className="flex min-h-11 items-start justify-between gap-4 rounded-md border border-line bg-surface p-4" data-testid={`setting-${key}`}>
          <div className="grid gap-1">
            <label htmlFor={`company-${key}`} className="font-display text-lg text-fg">
              {SHARING_LABEL[key]}
            </label>
            <p className="text-sm text-muted">{SHARING_HELP[key]}</p>
            <p className="text-xs text-muted">Default: Off</p>
          </div>
          <Switch.Root
            id={`company-${key}`}
            checked={data.company[key]}
            disabled={!online || !data.canEdit}
            onCheckedChange={(value) => setPending({ key, value })}
            className="relative h-7 w-12 shrink-0 rounded-full border border-line bg-raised data-[state=checked]:bg-copper disabled:opacity-50"
          >
            <Switch.Thumb className="block size-5 translate-x-1 rounded-full bg-fg transition data-[state=checked]:translate-x-6" />
          </Switch.Root>
        </article>
      ))}
      <p className="text-sm text-muted">Projects inherit these unless overridden.</p>
      <Confirm
        open={Boolean(pending)}
        title={pending ? `Turn ${SHARING_LABEL[pending.key]} ${pending.value ? "on" : "off"}?` : ""}
        confirm="Save"
        busy={busy}
        error={saveError}
        onConfirm={() => void save()}
        onCancel={() => {
          setPending(null);
          setSaveError("");
        }}
      >
        <p className="text-base text-fg" data-testid="impact">
          {pending ? impact(pending.key, pending.value) : ""}
        </p>
        <label className="text-sm text-muted" htmlFor="sharing-note">
          Note (optional)
        </label>
        <input id="sharing-note" className="field" value={note} onChange={(event) => setNote(event.target.value)} />
      </Confirm>
    </section>
  );
}

function ReviewChip({ review }: { review: "needed" | "reviewed" }) {
  return review === "needed" ? <Chip hot>Sharing review needed</Chip> : <Chip>Reviewed</Chip>;
}

function Projects({ onOpen }: { onOpen: (id: string) => void }) {
  const { data, error, retry } = useLoad<Overview>(() => getSharingOverview());
  if (error) return <ErrorBanner message={error} onRetry={retry} />;
  if (!data) return <Skeleton lines={4} label="Loading projects" />;
  return (
    <div className="grid gap-4">
      <section className="grid gap-2" aria-label="Review queue" data-testid="review-queue">
        <h2 className="font-display text-lg text-fg">Review queue ({data.queue.length})</h2>
        {data.queue.length === 0 ? (
          <EmptyState title="Every job's sharing has been reviewed." />
        ) : (
          <ul className="grid gap-2">
            {data.queue.map((job) => (
              <li key={job.id} className="flex items-center justify-between gap-3 rounded-md border border-line bg-surface p-3" data-testid="queue-row">
                <div className="min-w-0">
                  <p className="truncate text-base text-fg">
                    {job.name}
                    {job.archived ? <span className="text-muted"> · archived</span> : null}
                  </p>
                  <p className="text-sm text-muted">
                    Created by {job.requestedBy || "someone"}
                    {job.requestedAt ? ` · ${day(job.requestedAt)}` : ""} · Using company defaults
                  </p>
                </div>
                <Button type="button" onClick={() => onOpen(job.id)} aria-label={`Review ${job.name}`}>
                  Review
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="grid gap-2" aria-label="All projects">
        <h2 className="font-display text-lg text-fg">All projects</h2>
        <div className="overflow-x-auto rounded-md border border-line">
          <table className="w-full min-w-[36rem] text-left text-sm">
            <thead className="text-muted">
              <tr>
                <th className="p-3 font-normal">Job</th>
                <th className="p-3 font-normal">Review</th>
                {SHARING_KEYS.map((key) => (
                  <th key={key} className="p-3 font-normal">
                    {SHARING_LABEL[key]}
                  </th>
                ))}
                <th className="p-3 font-normal">Last review</th>
              </tr>
            </thead>
            <tbody>
              {data.projects.map((job) => (
                <tr key={job.id} className="border-t border-line" data-testid="project-row">
                  <td className="p-3">
                    <button type="button" className="min-h-11 text-left text-fg underline" onClick={() => onOpen(job.id)}>
                      {job.name}
                    </button>
                  </td>
                  <td className="p-3">
                    <ReviewChip review={job.review} />
                  </td>
                  {SHARING_KEYS.map((key) => (
                    <td key={key} className="p-3 text-fg">
                      {describeEffective(job.effective[key])}
                    </td>
                  ))}
                  <td className="p-3 text-muted">{job.reviewedAt ? `${job.reviewedBy} · ${day(job.reviewedAt)}` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function TriState({
  label,
  companyValue,
  value,
  disabled,
  onChange,
}: {
  label: string;
  companyValue: boolean;
  value: boolean | null;
  disabled: boolean;
  onChange: (value: boolean | null) => void;
}) {
  const options: [string, boolean | null][] = [
    [`Use company default (${companyValue ? "On" : "Off"})`, null],
    ["On", true],
    ["Off", false],
  ];
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-1">
      {options.map(([text, option]) => (
        <button
          key={text}
          type="button"
          role="radio"
          aria-checked={value === option}
          disabled={disabled}
          onClick={() => onChange(option)}
          className={`min-h-11 rounded-md border px-3 text-sm disabled:opacity-50 ${value === option ? "border-copper bg-copper text-ink" : "border-line text-fg"}`}
        >
          {text}
        </button>
      ))}
    </div>
  );
}

function ProjectSharing({ projectId, onBack, onNotice }: { projectId: string; onBack: () => void; onNotice: (text: string) => void }) {
  const online = useOnline();
  const { data, setData, error, retry } = useLoad<ProjectDetail>(() => getSharingProject({ data: { projectId } }));
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState("");

  if (error) {
    return (
      <div className="grid gap-3" data-testid="sharing-missing">
        <ErrorBanner message={error} onRetry={retry} />
        <Button type="button" tone="ghost" onClick={onBack}>
          Back to projects
        </Button>
      </div>
    );
  }
  if (!data) return <Skeleton lines={3} label="Loading the job" />;
  const { project, company, audit } = data;

  async function change(key: SharingKey, value: boolean | null) {
    setBusy(true);
    setActionError("");
    try {
      setData(await setProjectSharing({ data: { projectId, key, value } }));
    } catch (cause) {
      setActionError(errorText(cause, "Could not save that."));
    } finally {
      setBusy(false);
    }
  }

  async function openReview() {
    setActionError("");
    try {
      setPreview(await getReviewPreview({ data: { projectId } }));
    } catch (cause) {
      setActionError(errorText(cause, "Could not open the review."));
    }
  }

  async function confirmReview() {
    if (!preview) return;
    setBusy(true);
    setActionError("");
    try {
      await markProjectReviewed({ data: { projectId, expectedSnapshotHash: preview.hash } });
      setPreview(null);
      onNotice(`${project.name} is reviewed.`);
      retry();
    } catch (cause) {
      setActionError(errorText(cause, "Could not mark it reviewed."));
    } finally {
      setBusy(false);
    }
  }

  async function reflag() {
    setBusy(true);
    setActionError("");
    try {
      setData(await requestSharingReview({ data: { projectId } }));
      onNotice(`${project.name} is back in the review queue.`);
    } catch (cause) {
      setActionError(errorText(cause, "Could not request a review."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="grid gap-4" data-testid="sharing-project" aria-label={`Sharing for ${project.name}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="font-display text-2xl text-fg">{project.name}</h2>
          <p className="text-sm text-muted">
            {project.phase}
            {project.archived ? " · archived" : ""}
          </p>
        </div>
        <Button type="button" tone="ghost" onClick={onBack}>
          All projects
        </Button>
      </div>
      {project.review === "needed" ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-copper bg-surface p-4" data-testid="review-banner">
          <p className="text-base text-fg">Sharing review needed. This job is using company defaults until you mark it reviewed.</p>
          {data.canReview ? (
            <Button type="button" disabled={!online || busy} onClick={() => void openReview()}>
              Mark reviewed
            </Button>
          ) : null}
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-3" data-testid="reviewed-line">
          <p className="text-base text-pine">
            Reviewed by {project.reviewedBy} · {when(project.reviewedAt)}
          </p>
          {data.canReview ? (
            <Button type="button" tone="ghost" disabled={!online || busy} onClick={() => void reflag()}>
              Request review again
            </Button>
          ) : null}
        </div>
      )}
      {actionError && !preview ? <ErrorBanner message={actionError} /> : null}
      {SHARING_KEYS.map((key) => (
        <article key={key} className="grid gap-2 rounded-md border border-line bg-surface p-4" data-testid={`project-${key}`}>
          <p className="font-display text-lg text-fg">{SHARING_LABEL[key]}</p>
          <p className="text-sm text-muted">{SHARING_HELP[key]}</p>
          <TriState
            label={SHARING_LABEL[key]}
            companyValue={company[key]}
            value={project.values[key]}
            disabled={!online || busy || !data.canEdit}
            onChange={(value) => void change(key, value)}
          />
          <p className="text-sm text-muted">
            Now: {describeEffective(project.effective[key])}
            {project.review === "needed" && project.values[key] !== null ? " · Applies after review" : ""}
          </p>
        </article>
      ))}
      <details className="rounded-md border border-line bg-surface p-4">
        <summary className="min-h-11 cursor-pointer text-base text-fg">Changes to this job ({audit.length})</summary>
        <AuditTable rows={audit} />
      </details>
      <Confirm
        open={Boolean(preview)}
        title={`Mark ${project.name} reviewed?`}
        confirm="Mark reviewed"
        busy={busy}
        error={actionError}
        onConfirm={() => void confirmReview()}
        onCancel={() => {
          setPreview(null);
          setActionError("");
        }}
      >
        <p className="text-sm text-muted">Effective settings after review:</p>
        {preview ? <SnapshotRows snapshot={preview.snapshot} /> : null}
        <p className="text-sm text-muted">This is recorded in the change log.</p>
      </Confirm>
    </section>
  );
}

const VALUE: Record<string, string> = { true: "On", false: "Off", inherit: "Company default", needed: "Review needed", reviewed: "Reviewed" };
const KEY_LABEL = (key: string) => (key === "review" ? "Sharing review" : (SHARING_LABEL as Record<string, string>)[key] ?? key);

function AuditTable({ rows }: { rows: Audit }) {
  if (rows.length === 0) return <EmptyState title="No sharing changes yet." />;
  return (
    <ul className="mt-2 grid gap-2" data-testid="audit">
      {rows.map((row) => (
        <li key={row.id} className="rounded-md border border-line p-3 text-sm" data-testid="audit-row">
          <p className="text-fg">
            {when(row.at)} · {row.who} ({row.role}) · {row.scope}
          </p>
          <p className="text-fg">
            {KEY_LABEL(row.key)}: {VALUE[row.oldValue] ?? (row.oldValue || "—")} → {VALUE[row.newValue] ?? row.newValue}
          </p>
          {row.note ? <p className="text-muted">{row.note}</p> : null}
          {row.snapshot ? (
            <details>
              <summary className="min-h-11 cursor-pointer text-copper">Settings at review</summary>
              <SnapshotRows snapshot={row.snapshot} />
            </details>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

function csvOf(rows: Audit): string {
  const cell = (value: string) => `"${value.replace(/"/g, '""')}"`;
  const head = ["When", "Who", "Role", "Scope", "Setting", "Old", "New", "Note", "Snapshot"];
  return [head, ...rows.map((r) => [r.at, r.who, r.role, r.scope, KEY_LABEL(r.key), r.oldValue, r.newValue, r.note, r.snapshot ? JSON.stringify(r.snapshot) : ""])]
    .map((line) => line.map((v) => cell(String(v))).join(","))
    .join("\n");
}

function ChangeLog() {
  const [filters, setFilters] = useState({ scope: "", key: "", person: "" });
  const [rows, setRows] = useState<Audit | null>(null);
  const [error, setError] = useState("");
  const overview = useLoad<Overview>(() => getSharingOverview());
  useEffect(() => {
    let cancelled = false;
    setError("");
    listSharingAudit({ data: filters })
      .then((next) => !cancelled && setRows(next))
      .catch((cause: unknown) => !cancelled && setError(errorText(cause, "Could not load the change log.")));
    return () => {
      cancelled = true;
    };
  }, [filters]);
  // Everyone who appears in the unfiltered log, so the Person list doesn't shrink as you filter.
  const [people, setPeople] = useState<[string, string][]>([]);
  useEffect(() => {
    if (rows && !filters.scope && !filters.key && !filters.person) setPeople([...new Map(rows.map((r) => [r.whoId, r.who])).entries()]);
  }, [rows, filters]);

  function download() {
    if (!rows) return;
    const url = URL.createObjectURL(new Blob([csvOf(rows)], { type: "text/csv" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "sharing-change-log.csv";
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <section className="grid gap-3" aria-label="Change log">
      <div className="flex flex-wrap items-end gap-2">
        <label className="grid gap-1 text-sm text-muted">
          Scope
          <select className="field" value={filters.scope} onChange={(e) => setFilters({ ...filters, scope: e.target.value })}>
            <option value="">All</option>
            <option value="company">Company</option>
            {(overview.data?.projects ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-sm text-muted">
          Setting
          <select className="field" value={filters.key} onChange={(e) => setFilters({ ...filters, key: e.target.value })}>
            <option value="">All</option>
            {SHARING_KEYS.map((key) => (
              <option key={key} value={key}>
                {SHARING_LABEL[key]}
              </option>
            ))}
            <option value="review">Sharing review</option>
          </select>
        </label>
        <label className="grid gap-1 text-sm text-muted">
          Person
          <select className="field" value={filters.person} onChange={(e) => setFilters({ ...filters, person: e.target.value })}>
            <option value="">All</option>
            {people.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <Button type="button" tone="ghost" disabled={!rows || rows.length === 0} onClick={download}>
          Download CSV
        </Button>
      </div>
      {error ? <ErrorBanner message={error} /> : rows ? <AuditTable rows={rows} /> : <Skeleton lines={3} label="Loading the change log" />}
    </section>
  );
}
