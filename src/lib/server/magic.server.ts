import { createHash, randomBytes, randomUUID } from "node:crypto";
import { getSql, type Sql } from "@/lib/db";
import { validateSource } from "@/lib/product";
import { absoluteUrl, isMailerConfigured, linkPreviewAllowed, sendEmail } from "@/lib/server/mailer.server";
import { isSmsConfigured, sendSms } from "@/lib/server/sms.server";
import { normalizeRole } from "@/lib/roles";
import { canReplayConsumedLink, safeRedirect } from "@/lib/sign-in-complete";

const SMS_DOMAIN = "crew.rcl.build";

export function normalizeEmail(raw: string): string | null {
  const email = raw.trim().toLowerCase();
  if (email.length > 160 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  return email;
}

export function normalizePhone(raw: string): string | null {
  let digits = raw.replace(/\D/g, "");
  if (digits.length === 10) digits = `1${digits}`;
  if (digits.length < 11 || digits.length > 15) return null;
  return `+${digits}`;
}

/** Account key for phone-only users. Identity only: texts go to the E.164 number, never here. */
export function phoneToEmail(phone: string): string {
  return `sms.${phone.replace(/\D/g, "")}@${SMS_DOMAIN}`;
}

export function isSyntheticEmail(email: string): boolean {
  return email.endsWith(`@${SMS_DOMAIN}`);
}

function sha(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function text(value: unknown): string {
  if (value == null) return "";
  return String(value);
}

type LinkDraft = {
  channel: "email" | "sms";
  destination: string;
  email: string;
  displayName: string | null;
  companyId: string | null;
  role: string | null;
  action: "approve" | "reject" | null;
  proposalId: string | null;
  redirectPath: string | null;
  minutes: number;
};

export async function insertMagicLink(input: LinkDraft): Promise<string> {
  const sql = await getSql();
  const token = randomBytes(24).toString("hex");
  const expires = new Date(Date.now() + input.minutes * 60_000).toISOString();
  await sql`
    insert into magic_links (
      id, token_hash, channel, destination, email, display_name, company_id, role,
      action, proposal_id, redirect_path, expires_at
    ) values (
      ${randomUUID()},
      ${sha(token)},
      ${input.channel},
      ${input.destination},
      ${input.email},
      ${input.displayName},
      ${input.companyId},
      ${input.role},
      ${input.action},
      ${input.proposalId},
      ${input.redirectPath},
      ${expires}
    )
  `;
  return `/m/${token}`;
}

export async function requestLoginLink(input: {
  channel: "email" | "sms";
  destination: string;
  name: string;
}): Promise<
  | {
      ok: true;
      /** Only present as a dev fallback when no mailer is configured. */
      previewPath?: string;
      emailed: boolean;
      channel: "email" | "sms";
      destination: string;
    }
  | { ok: false; error: string }
> {
  const name = input.name.trim().slice(0, 80);
  let email: string;
  let destination: string;
  if (input.channel === "email") {
    const parsed = normalizeEmail(input.destination);
    if (!parsed) return { ok: false, error: "Enter a valid email address." };
    email = parsed;
    destination = parsed;
  } else {
    const phone = normalizePhone(input.destination);
    if (!phone) return { ok: false, error: "Enter a mobile number with area code." };
    email = phoneToEmail(phone);
    destination = phone;
  }

  const sql = await getSql();
  const recent = await sql<{ n: number }>`
    select count(*) as n from magic_links
    where destination = ${destination}
      and created_at > now() - interval '15 minutes'
  `;
  const n = typeof recent[0]?.n === "number" ? recent[0].n : Number(recent[0]?.n ?? 0);
  if (n >= 5) return { ok: false, error: "Too many links. Wait a few minutes and try again." };

  const previewPath = await insertMagicLink({
    channel: input.channel,
    destination,
    email,
    displayName: name || null,
    companyId: null,
    role: null,
    action: null,
    proposalId: null,
    redirectPath: "/",
    minutes: 30,
  });
  if (input.channel === "email" && isMailerConfigured()) {
    const url = absoluteUrl(previewPath);
    const result = await sendEmail({
      to: destination,
      subject: "Your RCL Design-Build sign-in link",
      text: [
        name ? `Hi ${name},` : "Hi,",
        "",
        "Open this single-use link to sign in to RCL Design-Build. It expires in 30 minutes.",
        "",
        url,
        "",
        "If you did not ask for this, you can ignore this email.",
      ].join("\n"),
    });
    if (!result.ok) return { ok: false, error: "We could not send the email. Try again in a minute." };
    return { ok: true, emailed: true, channel: input.channel, destination };
  }
  if (input.channel === "sms" && isSmsConfigured()) {
    const result = await sendSms({
      to: destination,
      body: `RCL Design-Build sign-in link (single-use, expires in 30 min): ${absoluteUrl(previewPath)}`,
    });
    if (!result.ok) return { ok: false, error: "We could not send the text. Try again in a minute." };
    return { ok: true, emailed: false, channel: input.channel, destination };
  }
  if (!linkPreviewAllowed()) {
    return {
      ok: false,
      error:
        input.channel === "email"
          ? "Email sign-in isn't set up on this desk yet. Ask an admin, or sign in another way."
          : "Text sign-in isn't set up on this desk yet. Ask an admin, or sign in another way.",
    };
  }
  // Explicit dev preview (DEV_LINK_PREVIEW=true): show the link on screen.
  return { ok: true, emailed: false, previewPath, channel: input.channel, destination };
}

async function ensureUser(sql: Sql, email: string, name: string): Promise<string> {
  const found = await sql<{ id: string }>`
    select "id" from "user" where lower("email") = ${email}
  `;
  if (found[0]?.id) return found[0].id;
  const id = randomUUID();
  await sql`
    insert into "user" ("id", "name", "email", "emailVerified", "createdAt", "updatedAt")
    values (${id}, ${name.slice(0, 80)}, ${email}, true, now(), now())
  `;
  return id;
}

export async function applyDecision(
  sql: Sql,
  opts: {
    proposalId: string;
    companyId: string;
    userId: string;
    status: "approved" | "rejected";
  },
): Promise<{ ok: true; stagingToken: string; already: boolean } | { ok: false; error: string }> {
  const rows = await sql<{
    file_path: string;
    proposed_content: string;
    status: string;
    staging_token: string;
  }>`
    select file_path, proposed_content, status, staging_token
    from code_proposals
    where id = ${opts.proposalId} and company_id = ${opts.companyId}
  `;
  const row = rows[0];
  if (!row) return { ok: false, error: "That proposal is gone." };
  const stagingToken = text(row.staging_token);
  if (row.status !== "pending") return { ok: true, stagingToken, already: true };
  if (opts.status === "approved") {
    try {
      validateSource(text(row.file_path), text(row.proposed_content));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Invalid source";
      return { ok: false, error: message };
    }
    await sql`
      update source_files
      set content = ${text(row.proposed_content)}, updated_at = now()
      where company_id = ${opts.companyId} and path = ${text(row.file_path)}
    `;
  }
  await sql`
    update code_proposals
    set status = ${opts.status}, decided_at = now(), decided_by = ${opts.userId}
    where id = ${opts.proposalId} and status = 'pending'
  `;
  return { ok: true, stagingToken, already: false };
}

type ConsumedLink = {
  email: string;
  display_name: string | null;
  company_id: string | null;
  role: string | null;
  action: string | null;
  proposal_id: string | null;
  redirect_path: string | null;
  channel: string;
  destination: string;
};

function asDate(value: unknown): Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === "string" || typeof value === "number") {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  return null;
}

export async function consumeToken(raw: string): Promise<
  | { ok: true; sessionToken: string; redirect: string }
  | { ok: false; error: string }
> {
  if (!/^[a-f0-9]{48}$/.test(raw)) return { ok: false, error: "This link is not valid." };
  const sql = await getSql();
  const claimed = await sql<ConsumedLink>`
    update magic_links
    set consumed_at = now()
    where token_hash = ${sha(raw)}
      and consumed_at is null
      and expires_at > now()
    returning email, display_name, company_id, role, action, proposal_id, redirect_path, channel, destination
  `;
  let link = claimed[0];
  if (!link) {
    const prior = await sql<ConsumedLink & { consumed_at: unknown; expires_at: unknown }>`
      select email, display_name, company_id, role, action, proposal_id, redirect_path, channel, destination,
             consumed_at, expires_at
      from magic_links
      where token_hash = ${sha(raw)}
    `;
    const row = prior[0];
    const consumedAt = row ? asDate(row.consumed_at) : null;
    const expiresAt = row ? asDate(row.expires_at) : null;
    if (!row || !expiresAt || !canReplayConsumedLink(consumedAt, expiresAt, new Date())) {
      return { ok: false, error: "This link is expired or already used." };
    }
    link = row;
  }

  const email = text(link.email).toLowerCase();
  const name = text(link.display_name).trim() || email.split("@")[0] || "Crew";
  const userId = await ensureUser(sql, email, name);

  let userAgent: string | null = null;
  try {
    const { getRequest } = await import("@tanstack/react-start/server");
    userAgent = getRequest()?.headers.get("user-agent") ?? null;
  } catch {
    userAgent = null;
  }
  const sessionToken = randomBytes(32).toString("hex");
  await sql`
    insert into "session" (
      "id", "expiresAt", "token", "createdAt", "updatedAt", "ipAddress", "userAgent", "userId"
    ) values (
      ${randomUUID()},
      now() + interval '7 days',
      ${sessionToken},
      now(),
      now(),
      ${null},
      ${userAgent},
      ${userId}
    )
  `;

  const companyId = text(link.company_id);
  const role = normalizeRole(text(link.role));
  if (companyId && role) {
    const existing = await sql<{ user_id: string }>`
      select user_id from profiles where user_id = ${userId}
    `;
    const company = await sql<{ id: string }>`select id from companies where id = ${companyId}`;
    if (!existing[0] && company[0]) {
      const phone = link.channel === "sms" ? text(link.destination) : null;
      await sql`
        insert into profiles (user_id, company_id, name, email, phone, role)
        values (
          ${userId},
          ${companyId},
          ${name.slice(0, 80)},
          ${isSyntheticEmail(email) ? null : email},
          ${phone},
          ${role}
        )
      `;
    }
  }

  let redirect = safeRedirect(text(link.redirect_path) || "/");
  const action = text(link.action);
  const proposalId = text(link.proposal_id);
  if ((action === "approve" || action === "reject") && proposalId) {
    const prof = await sql<{ role: string; company_id: string }>`
      select role, company_id from profiles where user_id = ${userId}
    `;
    if (prof[0]?.role === "superadmin") {
      const decision = await applyDecision(sql, {
        proposalId,
        companyId: text(prof[0].company_id),
        userId,
        status: action === "approve" ? "approved" : "rejected",
      });
      if (decision.ok && decision.stagingToken) redirect = `/stage/${decision.stagingToken}`;
    }
  }

  return { ok: true, sessionToken, redirect };
}
