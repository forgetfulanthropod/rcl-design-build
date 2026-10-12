// Transactional SMS via Twilio Programmable Messaging
// (https://www.twilio.com/docs/messaging/api/message-resource#create-a-message-resource).
// Env: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN (secret), TWILIO_FROM (E.164 number or MG... Messaging Service SID).
// Never log message bodies or credentials.

export type SmsResult = { ok: true; id: string | null } | { ok: false; error: string };

export function isSmsConfigured(): boolean {
  return Boolean(
    process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_FROM,
  );
}

export function isE164(value: string): boolean {
  return /^\+[1-9]\d{7,14}$/.test(value);
}

export async function sendSms(input: { to: string; body: string }): Promise<SmsResult> {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_FROM;
  if (!sid || !token || !from) return { ok: false, error: "SMS not configured" };
  if (!isE164(input.to)) return { ok: false, error: "Recipient is not an E.164 number" };
  const form = new URLSearchParams({ To: input.to, Body: input.body.slice(0, 1500) });
  if (from.startsWith("MG")) form.set("MessagingServiceSid", from);
  else form.set("From", from);
  try {
    const res = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`,
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: form.toString(),
        signal: AbortSignal.timeout(10_000),
      },
    );
    const data = (await res.json().catch(() => ({}))) as { sid?: string; message?: string; code?: number };
    if (!res.ok) {
      const error = `Twilio ${res.status}${data.code ? ` (${data.code})` : ""}: ${String(data.message ?? res.statusText).slice(0, 200)}`;
      console.warn(`[sms] send failed (${error})`);
      return { ok: false, error };
    }
    return { ok: true, id: data.sid ?? null };
  } catch (cause) {
    const error = cause instanceof Error ? cause.message.slice(0, 200) : "Network error";
    console.warn(`[sms] send failed (${error})`);
    return { ok: false, error };
  }
}
