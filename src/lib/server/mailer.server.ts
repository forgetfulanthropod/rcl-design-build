// Transactional email via Resend (https://resend.com/docs/api-reference/emails/send-email).
// Env: RESEND_API_KEY (secret), MAIL_FROM (e.g. "RCL <login@example.com>"), APP_ORIGIN (e.g. "https://rcl.grok.me").
// Never log message bodies or the API key.
import type { Sql } from "@/lib/db";
import { isSmsConfigured, sendSms } from "@/lib/server/sms.server";
import { DEMO_COMPANY_ID } from "@/lib/demo";

export type SendResult = { ok: true; id: string | null } | { ok: false; error: string };

export function isMailerConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY && process.env.MAIL_FROM);
}

export function appOrigin(): string {
  return (process.env.APP_ORIGIN ?? "").replace(/\/+$/, "");
}

/** Turns "/m/abc" into an absolute URL using APP_ORIGIN (left relative if unset). */
export function absoluteUrl(path: string): string {
  if (/^https?:\/\//.test(path)) return path;
  return `${appOrigin()}${path.startsWith("/") ? path : `/${path}`}`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/** Plain text to simple HTML, with URLs made clickable. */
export function textToHtml(text: string): string {
  return escapeHtml(text)
    .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1">$1</a>')
    .replace(/\n/g, "<br>");
}

export async function sendEmail(input: {
  to: string;
  subject: string;
  text: string;
  html?: string;
}): Promise<SendResult> {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.MAIL_FROM;
  if (!key || !from) return { ok: false, error: "Mailer not configured" };
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from,
        to: [input.to],
        subject: input.subject,
        text: input.text,
        html: input.html ?? textToHtml(input.text),
      }),
      signal: AbortSignal.timeout(10_000),
    });
    const data = (await res.json().catch(() => ({}))) as { id?: string; message?: string };
    if (!res.ok) {
      const error = `Resend ${res.status}: ${String(data.message ?? res.statusText).slice(0, 200)}`;
      console.warn(`[mailer] send failed (${error})`);
      return { ok: false, error };
    }
    return { ok: true, id: data.id ?? null };
  } catch (cause) {
    const error = cause instanceof Error ? cause.message.slice(0, 200) : "Network error";
    console.warn(`[mailer] send failed (${error})`);
    return { ok: false, error };
  }
}

/** Sends an outbound_messages row by email or SMS and records status (sent / failed / skipped). */
export async function deliverOutbound(
  sql: Sql,
  row: { id: string; channel: string; to: string; subject: string; body: string },
): Promise<void> {
  let status: string;
  let providerId: string | null = null;
  let error: string | null = null;
  const owner = await sql<{ company_id: string }>`select company_id from outbound_messages where id = ${row.id}`;
  if (owner[0]?.company_id === DEMO_COMPANY_ID) {
    // The debug demo company never sends real email or texts.
    status = "skipped";
    error = "Demo company";
  } else if (row.channel === "sms") {
    if (!isSmsConfigured()) {
      status = "skipped";
      error = "SMS not configured";
    } else {
      const result = await sendSms({ to: row.to, body: row.body });
      status = result.ok ? "sent" : "failed";
      providerId = result.ok ? result.id : null;
      error = result.ok ? null : result.error;
    }
  } else if (row.channel !== "email") {
    status = "skipped";
    error = `Unknown channel ${row.channel}`;
  } else if (!isMailerConfigured()) {
    status = "skipped";
    error = "Mailer not configured";
  } else {
    const result = await sendEmail({ to: row.to, subject: row.subject, text: row.body });
    if (result.ok) {
      status = "sent";
      providerId = result.id;
    } else {
      status = "failed";
      error = result.error;
    }
  }
  try {
    await sql`
      update outbound_messages
      set status = ${status}, provider_id = ${providerId}, error = ${error},
          sent_at = ${status === "sent" ? new Date().toISOString() : null}
      where id = ${row.id}
    `;
  } catch (cause) {
    console.warn(`[mailer] could not record status for ${row.id}`, cause instanceof Error ? cause.message : "");
  }
}

export { linkPreviewAllowed } from "@/lib/server/link-preview.server";
