/** Client side of the form job default (spec 05 · F3). */
import { useEffect, useState } from "react";
import { getJobHints } from "@/lib/server/fns";
import { LAST_JOB_KEY, resolveCurrentJob, type CurrentJobSource, type JobHints } from "@/lib/current-job";

function lastPicked(): string | null {
  try {
    return window.localStorage.getItem(LAST_JOB_KEY);
  } catch {
    return null; // storage blocked: fall through to the next rule
  }
}

export function rememberJob(id: string) {
  if (!id) return;
  try {
    window.localStorage.setItem(LAST_JOB_KEY, id);
  } catch {
    // storage blocked: the server hints still apply
  }
}

function localDay(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

let cached: Promise<JobHints> | null = null;
/** Hints are per page load: one request however many forms ask. */
function hints(): Promise<JobHints> {
  cached ??= getJobHints({ data: { day: localDay() } }).catch((error: unknown) => {
    cached = null;
    throw error;
  });
  return cached;
}

/** The current job id ("" for none), for forms that manage their own state. */
export async function currentJobId(): Promise<string> {
  return resolveCurrentJob(await hints(), lastPicked()).id;
}

/**
 * Job state for a form, preselected with the user's current job (spec 05 · F3).
 * `initial` (an existing record's job) wins when given.
 */
export function useCurrentJob(initial?: string | null) {
  const [projectId, setProjectId] = useState(initial ?? "");
  const [source, setSource] = useState<CurrentJobSource>("none");
  useEffect(() => {
    if (initial) return;
    let cancelled = false;
    hints()
      .then((next) => {
        if (cancelled) return;
        const current = resolveCurrentJob(next, lastPicked());
        setSource(current.source);
        setProjectId((value) => value || current.id);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const pick = (id: string) => {
    setProjectId(id);
    rememberJob(id);
  };
  /** Back to the current job after a successful save. */
  const reset = () => {
    void hints().then((next) => setProjectId(resolveCurrentJob(next, lastPicked()).id));
  };
  return { projectId, setProjectId: pick, reset, source, isCurrent: source !== "none" };
}

