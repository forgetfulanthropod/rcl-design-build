/**
 * Sharing settings (spec 06 rev 3). Every who-sees-what call is a setting that defaults to
 * sharing less: a company default plus a per-project override (null = inherit). Pure, so the
 * browser, the server and the tests share one resolution rule.
 */
export const SHARING_KEYS = ["lead_budget_dollars", "labor_doc_send"] as const;
export type SharingKey = (typeof SHARING_KEYS)[number];
export type Sharing = Record<SharingKey, boolean>;
export const SHARING_DEFAULTS: Sharing = { lead_budget_dollars: false, labor_doc_send: false };

export type ReviewStatus = "needed" | "reviewed";
export type ProjectSharing = { review: ReviewStatus; values: Partial<Record<SharingKey, boolean | null>> };

export const SHARING_LABEL: Record<SharingKey, string> = {
  lead_budget_dollars: "Leads see dollars",
  labor_doc_send: "Labor can send documents",
};

export const SHARING_HELP: Record<SharingKey, string> = {
  lead_budget_dollars:
    "Leads on the job see budget, actual and change-order dollars. When off they see hours only. Pay rates, bids and invoices always stay with the office.",
  labor_doc_send:
    "Labor can email the job's documents to outside parties (Send with Resend or Open in Gmail). When off, Labor reads Docs only. Subs never get this.",
};

export function isSharingKey(value: string): value is SharingKey {
  return (SHARING_KEYS as readonly string[]).includes(value);
}

/** The company's values; a missing row (or missing key) means the coded default, Off. */
export function companySharing(company: Partial<Sharing> | null | undefined): Sharing {
  const out = { ...SHARING_DEFAULTS };
  for (const key of SHARING_KEYS) {
    const value = company?.[key];
    if (typeof value === "boolean") out[key] = value;
  }
  return out;
}

/**
 * effective(key, project):
 *   no project                → company
 *   project review = needed   → company (overrides wait for "Mark reviewed")
 *   project override not null → project
 *   else                      → company
 */
export function resolveSharing(company: Partial<Sharing> | null | undefined, project: ProjectSharing | null | undefined): Sharing {
  return Object.fromEntries(SHARING_KEYS.map((key) => [key, effectiveOf(key, company, project).value])) as Sharing;
}

export type EffectiveSource = "company" | "project";
export type Effective = { value: boolean; source: EffectiveSource };
export type EffectiveSnapshot = Record<SharingKey, Effective>;

function effectiveOf(key: SharingKey, company: Partial<Sharing> | null | undefined, project: ProjectSharing | null | undefined): Effective {
  const base = companySharing(company)[key];
  if (!project || project.review === "needed") return { value: base, source: "company" };
  const override = project.values[key];
  return typeof override === "boolean" ? { value: override, source: "project" } : { value: base, source: "company" };
}

/** Effective value and source of every setting, as it is now. */
export function effectiveSnapshot(company: Partial<Sharing> | null | undefined, project: ProjectSharing | null | undefined): EffectiveSnapshot {
  return Object.fromEntries(SHARING_KEYS.map((key) => [key, effectiveOf(key, company, project)])) as EffectiveSnapshot;
}

/** What the job will use once it's marked reviewed: overrides apply, otherwise the company value. */
export function snapshotAfterReview(company: Partial<Sharing> | null | undefined, values: ProjectSharing["values"]): EffectiveSnapshot {
  return effectiveSnapshot(company, { review: "reviewed", values });
}

/** Stable, order-independent hash of a snapshot (FNV-1a over canonical JSON), for stale-confirm checks. */
export function snapshotHash(snapshot: EffectiveSnapshot): string {
  const canonical = JSON.stringify(SHARING_KEYS.map((key) => [key, snapshot[key].value, snapshot[key].source]));
  let hash = 0x811c9dc5;
  for (let i = 0; i < canonical.length; i += 1) {
    hash ^= canonical.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

/** "Off · company" / "On · this job". */
export function describeEffective(effective: Effective): string {
  return `${effective.value ? "On" : "Off"} · ${effective.source === "project" ? "this job" : "company"}`;
}

/** Audit encoding of a project override. */
export function overrideText(value: boolean | null): "true" | "false" | "inherit" {
  return value === null ? "inherit" : value ? "true" : "false";
}
