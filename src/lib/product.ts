export const COPY_PATH = "src/product/copy.ts";
export const WORKFLOW_PATH = "src/product/workflows.ts";
export const ALLOWED_PATHS = [COPY_PATH, WORKFLOW_PATH] as const;
export type SourcePath = (typeof ALLOWED_PATHS)[number];

export const COPY_SOURCE = `// src/product/copy.ts
// Live product copy. Foreman may replace this file; an admin approves it on staging.
export const copy = {
  "companyMark": "RCL",
  "productName": "RCL Design-Build",
  "tagline": "Design, build, and service from one desk.",
  "deskGreeting": "The job is the source of truth.",
  "fieldLabel": "Field service",
  "jobsLabel": "Jobs"
};
`;

export const WORKFLOW_SOURCE = `// src/product/workflows.ts
// Statuses, phases, and trades the desk actually renders.
export const workflows = {
  "projectPhases": ["Precon", "Design", "Permit", "Build", "Closeout"],
  "workOrderStatuses": ["New", "Scheduled", "En route", "On site", "Complete", "Invoiced"],
  "priorities": ["Emergency", "High", "Normal", "Low"],
  "rfiStatuses": ["Open", "Ball in court", "Answered", "Closed"],
  "coStatuses": ["Draft", "Submitted", "Approved", "Rejected"],
  "trades": ["Electrical", "Plumbing", "HVAC", "Carpentry", "Concrete", "Roofing", "Finish"]
};
`;

export type CopyConfig = {
  companyMark: string;
  productName: string;
  tagline: string;
  deskGreeting: string;
  fieldLabel: string;
  jobsLabel: string;
};

export type WorkflowConfig = {
  projectPhases: string[];
  workOrderStatuses: string[];
  priorities: string[];
  rfiStatuses: string[];
  coStatuses: string[];
  trades: string[];
};

const COPY_KEYS: (keyof CopyConfig)[] = [
  "companyMark",
  "productName",
  "tagline",
  "deskGreeting",
  "fieldLabel",
  "jobsLabel",
];

const WORKFLOW_KEYS: (keyof WorkflowConfig)[] = [
  "projectPhases",
  "workOrderStatuses",
  "priorities",
  "rfiStatuses",
  "coStatuses",
  "trades",
];

export function parseModule(source: string): Record<string, unknown> {
  const start = source.indexOf("{");
  const end = source.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("Source has no object literal");
  const value: unknown = JSON.parse(source.slice(start, end + 1));
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Source must export one JSON object");
  }
  return value as Record<string, unknown>;
}

function asShortString(value: unknown, label: string, max: number): string {
  if (typeof value !== "string") throw new Error(`${label} must be a string`);
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > max) throw new Error(`${label} must be 1–${max} characters`);
  return trimmed;
}

function asStringList(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 12) {
    throw new Error(`${label} must be 1–12 entries`);
  }
  return value.map((item, i) => asShortString(item, `${label}[${i}]`, 40));
}

export function parseCopy(source: string): CopyConfig {
  const raw = parseModule(source);
  const copy = {} as CopyConfig;
  for (const key of COPY_KEYS) copy[key] = asShortString(raw[key], key, 140);
  return copy;
}

export function parseWorkflows(source: string): WorkflowConfig {
  const raw = parseModule(source);
  const workflows = {} as WorkflowConfig;
  for (const key of WORKFLOW_KEYS) workflows[key] = asStringList(raw[key], key);
  return workflows;
}

export function validateSource(path: string, content: string): SourcePath {
  if (content.length > 8000) throw new Error("File is too large");
  if (path === COPY_PATH) {
    if (!content.includes("export const copy")) throw new Error("copy.ts must export copy");
    parseCopy(content);
    return COPY_PATH;
  }
  if (path === WORKFLOW_PATH) {
    if (!content.includes("export const workflows")) {
      throw new Error("workflows.ts must export workflows");
    }
    parseWorkflows(content);
    return WORKFLOW_PATH;
  }
  throw new Error("That file is not on the allowlist");
}

export function renderCopy(copy: CopyConfig): string {
  return `// src/product/copy.ts
// Live product copy. Foreman may replace this file; an admin approves it on staging.
export const copy = ${JSON.stringify(copy, null, 2)};
`;
}

export function renderWorkflows(workflows: WorkflowConfig): string {
  return `// src/product/workflows.ts
// Statuses, phases, and trades the desk actually renders.
export const workflows = ${JSON.stringify(workflows, null, 2)};
`;
}

export function defaultCopy(): CopyConfig {
  return parseCopy(COPY_SOURCE);
}

export function defaultWorkflows(): WorkflowConfig {
  return parseWorkflows(WORKFLOW_SOURCE);
}
