import { randomUUID } from "node:crypto";
import { getSql, type Sql } from "@/lib/db";
import { DEMO_COMPANY_ID } from "@/lib/demo";
import {
  DOC_STATUSES,
  documentSubject,
  gmailComposeUrl,
  isDocKind,
  isMoneyDoc,
  statusAfterReply,
  statusAfterSend,
  type DocKind,
} from "@/lib/documents";
import { assertCan, assertCanWith, can, canWith } from "@/lib/permissions";
import { sharingFor, sharingForProjects } from "@/lib/server/sharing.server";
import { normalizeRole } from "@/lib/roles";
import { isMailerConfigured, sendEmail } from "@/lib/server/mailer.server";
import { member } from "@/lib/server/reports.server";

export type DocCard = {
  id: string;
  kind: DocKind;
  number: number;
  title: string;
  body: string;
  status: string;
  projectId: string | null;
  projectName: string;
  counterparty: string;
  counterpartyEmail: string;
  amount: number | null;
  updatedAt: string;
  /** Per document (spec 06): Labor can send only where "Labor can send documents" is on for its job. */
  canSend: boolean;
};

export type DocMessage = {
  id: string;
  documentId: string;
  direction: "out" | "in";
  channel: "resend" | "gmail";
  toEmail: string;
  fromEmail: string;
  subject: string;
  body: string;
  status: string;
  error: string;
  createdAt: string;
};

export type DocBoard = {
  documents: DocCard[];
  messages: DocMessage[];
  jobs: { id: string; name: string }[];
  moneyVisible: boolean;
  canCreate: boolean;
  /** Point-of-use hint where a setting (not the role) keeps Send off: Labor only. */
  sendOffHint: string;
  canStatus: boolean;
  canApproveMoney: boolean;
  resendReady: boolean;
};

function text(value: unknown): string {
  return value == null ? "" : String(value);
}

function iso(value: unknown): string {
  if (value == null) return "";
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? text(value) : date.toISOString();
}

function officeOnly(role: string, kind: string) {
  if (isDocKind(kind) && isMoneyDoc(kind) && !can(role, "money.view")) {
    throw new Error("Bids and invoices stay with the office.");
  }
}

async function board(sql: Sql, companyId: string, role: string): Promise<DocBoard> {
  const money = can(role, "money.view");
  const docs = await sql<{
    id: string;
    kind: string;
    number: number;
    title: string;
    body: string;
    status: string;
    project_id: string | null;
    project_name: string;
    counterparty: string;
    counterparty_email: string;
    amount: number | null;
    updated_at: unknown;
  }>`
    select d.id, d.kind, d.number, d.title, d.body, d.status, d.project_id,
           coalesce(p.name, '') as project_name, d.counterparty, d.counterparty_email,
           d.amount, d.updated_at
    from project_documents d
    left join projects p on p.id = d.project_id
    where d.company_id = ${companyId}
    order by d.updated_at desc
  `;
  const messages = await sql<{
    id: string;
    document_id: string;
    direction: string;
    channel: string;
    to_email: string;
    from_email: string;
    subject: string;
    body: string;
    status: string;
    error: string | null;
    created_at: unknown;
  }>`
    select id, document_id, direction, channel, to_email, from_email, subject, body, status, error, created_at
    from document_messages
    where company_id = ${companyId}
    order by created_at asc
  `;
  const jobs = await sql<{ id: string; name: string }>`
    select id, name from projects where company_id = ${companyId} and archived = false order by name asc
  `;
  const shown = docs.filter((row) => isDocKind(text(row.kind)) && (money || !isMoneyDoc(text(row.kind) as DocKind)));
  // One query for every job's effective settings (no N+1); "" is the company value for no-job docs.
  const sharing = await sharingForProjects(sql, companyId, shown.map((row) => text(row.project_id)));
  const documents = shown
    .map((row) => ({
      id: text(row.id),
      kind: text(row.kind) as DocKind,
      number: Number(row.number),
      title: text(row.title),
      body: text(row.body),
      status: text(row.status),
      projectId: row.project_id ? text(row.project_id) : null,
      projectName: text(row.project_name),
      counterparty: text(row.counterparty),
      counterpartyEmail: text(row.counterparty_email),
      amount: money && row.amount != null ? Number(row.amount) : null,
      updatedAt: iso(row.updated_at),
      canSend: canWith(role, "doc.send", sharing.get(text(row.project_id)) ?? sharing.get("")!),
    }));
  const visible = new Set(documents.map((doc) => doc.id));
  return {
    documents,
    messages: messages
      .filter((row) => visible.has(text(row.document_id)))
      .map((row) => ({
        id: text(row.id),
        documentId: text(row.document_id),
        direction: row.direction === "in" ? "in" as const : "out" as const,
        channel: row.channel === "gmail" ? "gmail" as const : "resend" as const,
        toEmail: text(row.to_email),
        fromEmail: text(row.from_email),
        subject: text(row.subject),
        body: text(row.body),
        status: text(row.status),
        error: text(row.error),
        createdAt: iso(row.created_at),
      })),
    jobs: jobs.map((job) => ({ id: text(job.id), name: text(job.name) })),
    moneyVisible: money,
    canCreate: can(role, "doc.create"),
    sendOffHint: normalizeRole(role) === "labor" ? "Sending is off for this job." : "",
    canStatus: can(role, "doc.status"),
    canApproveMoney: can(role, "co.status"),
    resendReady: isMailerConfigured(),
  };
}

async function open(userId: string) {
  const sql = await getSql();
  const me = await member(sql, userId);
  if (!can(me.role, "doc.view")) assertCan(me.role, "doc.view");
  return { sql, me };
}

async function ownDoc(sql: Sql, companyId: string, id: string) {
  const rows = await sql<{
    id: string;
    kind: string;
    number: number;
    title: string;
    body: string;
    status: string;
    counterparty_email: string;
    project_id: string | null;
  }>`
    select id, kind, number, title, body, status, counterparty_email, project_id
    from project_documents where id = ${id} and company_id = ${companyId}
  `;
  const row = rows[0];
  if (!row) throw new Error("That document is gone.");
  return row;
}

export async function listDocuments(userId: string): Promise<DocBoard> {
  const { sql, me } = await open(userId);
  return board(sql, me.companyId, me.role);
}

export async function createDocument(
  userId: string,
  input: {
    kind: string;
    projectId: string;
    title: string;
    body: string;
    counterparty: string;
    counterpartyEmail: string;
    amount: number | null;
  },
): Promise<DocBoard> {
  const { sql, me } = await open(userId);
  assertCan(me.role, "doc.create");
  if (!isDocKind(input.kind)) throw new Error("Unknown document.");
  const kind = input.kind;
  officeOnly(me.role, kind);
  if (!can(me.role, "doc.status") && kind !== "rfi") {
    throw new Error("You can open an RFI. Policy and change orders are for a lead.");
  }
  if (kind === "invoice" && (input.amount == null || input.amount < 0)) throw new Error("An invoice needs an amount.");
  if (kind === "change_order" && can(me.role, "money.view") && (input.amount == null || input.amount < 0)) {
    throw new Error("A change order needs an amount.");
  }
  let projectId: string | null = null;
  if (input.projectId) {
    const job = await sql<{ id: string }>`
      select id from projects where id = ${input.projectId} and company_id = ${me.companyId} and archived = false
    `;
    if (!job[0]) throw new Error("That job isn't on this desk.");
    projectId = text(job[0].id);
  }
  const max = await sql<{ n: number }>`
    select coalesce(max(number), 0) as n from project_documents
    where company_id = ${me.companyId} and kind = ${kind} and coalesce(project_id, '') = ${projectId ?? ""}
  `;
  const keepsAmount = kind === "bid" || kind === "invoice" || kind === "change_order";
  await sql`
    insert into project_documents (
      id, company_id, project_id, kind, number, title, body, amount, status,
      counterparty, counterparty_email, created_by
    ) values (
      ${randomUUID()}, ${me.companyId}, ${projectId}, ${kind}, ${Number(max[0]?.n ?? 0) + 1},
      ${input.title}, ${input.body}, ${keepsAmount ? input.amount : null},
      ${DOC_STATUSES[kind][0]}, ${input.counterparty}, ${input.counterpartyEmail}, ${me.userId}
    )
  `;
  return board(sql, me.companyId, me.role);
}

export async function setDocumentStatus(userId: string, input: { id: string; status: string }): Promise<DocBoard> {
  const { sql, me } = await open(userId);
  assertCan(me.role, "doc.status");
  const doc = await ownDoc(sql, me.companyId, input.id);
  const kind = text(doc.kind);
  if (!isDocKind(kind)) throw new Error("Unknown document.");
  officeOnly(me.role, kind);
  if (!DOC_STATUSES[kind].includes(input.status)) throw new Error("That status doesn't fit this document.");
  if (kind === "change_order" && (input.status === "Approved" || input.status === "Rejected")) {
    assertCan(me.role, "co.status");
  }
  if (kind === "invoice" && (input.status === "Paid" || input.status === "Void")) assertCan(me.role, "money.view");
  await sql`
    update project_documents set status = ${input.status}, updated_at = now()
    where id = ${input.id} and company_id = ${me.companyId}
  `;
  return board(sql, me.companyId, me.role);
}

export async function sendDocument(
  userId: string,
  input: { id: string; channel: string; to: string; note: string },
): Promise<{ board: DocBoard; gmailUrl: string | null }> {
  const { sql, me } = await open(userId);
  if (input.channel !== "resend" && input.channel !== "gmail") throw new Error("Pick Resend or Gmail.");
  const channel = input.channel;
  const doc = await ownDoc(sql, me.companyId, input.id);
  assertCanWith(me.role, "doc.send", await sharingFor(sql, me.companyId, doc.project_id ? text(doc.project_id) : null));
  const kind = text(doc.kind);
  if (!isDocKind(kind)) throw new Error("Unknown document.");
  officeOnly(me.role, kind);
  const subject = documentSubject(kind, Number(doc.number), text(doc.title));
  const body = [text(doc.body), input.note].filter(Boolean).join("\n\n");
  let status = "queued";
  let providerId: string | null = null;
  let error: string | null = null;
  let gmailUrl: string | null = null;
  if (me.companyId === DEMO_COMPANY_ID) {
    status = "skipped";
    error = "Demo company";
    if (channel === "gmail") gmailUrl = gmailComposeUrl(input.to, subject, body);
  } else if (channel === "gmail") {
    status = "ready";
    gmailUrl = gmailComposeUrl(input.to, subject, body);
  } else if (!isMailerConfigured()) {
    status = "skipped";
    error = "Resend is not configured";
  } else {
    const result = await sendEmail({ to: input.to, subject, text: body });
    status = result.ok ? "sent" : "failed";
    providerId = result.ok ? result.id : null;
    error = result.ok ? null : result.error;
  }
  await sql`
    insert into document_messages (
      id, document_id, company_id, direction, channel, to_email, subject, body, provider_id, status, error, created_by
    ) values (
      ${randomUUID()}, ${text(doc.id)}, ${me.companyId}, ${"out"}, ${channel}, ${input.to},
      ${subject}, ${body}, ${providerId}, ${status}, ${error}, ${me.userId}
    )
  `;
  const next = statusAfterSend(kind, text(doc.status));
  await sql`
    update project_documents
    set status = ${next}, counterparty_email = ${input.to}, updated_at = now()
    where id = ${text(doc.id)} and company_id = ${me.companyId}
  `;
  return { board: await board(sql, me.companyId, me.role), gmailUrl };
}

export async function fileDocumentReply(
  userId: string,
  input: { id: string; channel: "resend" | "gmail"; fromEmail: string; body: string },
): Promise<DocBoard> {
  const { sql, me } = await open(userId);
  const doc = await ownDoc(sql, me.companyId, input.id);
  assertCanWith(me.role, "doc.send", await sharingFor(sql, me.companyId, doc.project_id ? text(doc.project_id) : null));
  const kind = text(doc.kind);
  if (!isDocKind(kind)) throw new Error("Unknown document.");
  officeOnly(me.role, kind);
  const subject = `Re: ${documentSubject(kind, Number(doc.number), text(doc.title))}`;
  await sql`
    insert into document_messages (
      id, document_id, company_id, direction, channel, from_email, subject, body, status, created_by
    ) values (
      ${randomUUID()}, ${text(doc.id)}, ${me.companyId}, ${"in"}, ${input.channel}, ${input.fromEmail},
      ${subject}, ${input.body}, ${"received"}, ${me.userId}
    )
  `;
  const next = statusAfterReply(kind, text(doc.status));
  await sql`
    update project_documents set status = ${next}, updated_at = now()
    where id = ${text(doc.id)} and company_id = ${me.companyId}
  `;
  return board(sql, me.companyId, me.role);
}
