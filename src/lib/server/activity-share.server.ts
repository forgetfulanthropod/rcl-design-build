/**
 * Private activity-log links. Creating one requires the same permission as
 * sending a document. Reading uses the token. Location is not stored.
 * The work_sessions table is not written here.
 *
 * Relative imports so the PGLite tests can load this under node:test.
 */
import { randomBytes, randomUUID } from "node:crypto";
import type { Sql } from "../db.ts";
import { assertCan, ForbiddenError } from "../permissions.ts";
import { SHARE_UNAVAILABLE, mayShareActivity, sanitizeActivityShare, type ActivitySnapshot } from "../activity-share.ts";
import { sharingFor } from "./sharing.server.ts";

export { ForbiddenError, SHARE_UNAVAILABLE };

async function db(sql?: Sql): Promise<Sql> {
  if (sql) return sql;
  const { getSql } = await import("../db.ts");
  return getSql();
}

type Me = { userId: string; companyId: string; role: string };

async function member(sql: Sql, userId: string): Promise<Me> {
  const rows = await sql<{ company_id: string; role: string }>`
    select company_id, role from profiles where user_id = ${userId}
  `;
  if (!rows[0]) throw new Error("Finish company setup first.");
  return { userId, companyId: String(rows[0].company_id), role: String(rows[0].role) };
}

function payloadOf(value: unknown): ActivitySnapshot | null {
  const raw = typeof value === "string" ? JSON.parse(value) : value;
  const parsed = sanitizeActivityShare(raw);
  return parsed.ok ? parsed.value : null;
}

export async function createActivityShare(userId: string, input: unknown, sql?: Sql): Promise<{ token: string }> {
  const parsed = sanitizeActivityShare(input);
  if (!parsed.ok) throw new Error(parsed.error);
  const database = await db(sql);
  const me = await member(database, userId);
  const sharing = await sharingFor(database, me.companyId, null);
  if (!mayShareActivity(me.role, sharing)) throw new ForbiddenError("doc.send");
  const token = randomBytes(32).toString("base64url");
  const id = randomUUID();
  await database`
    update activity_shares set revoked_at = now()
    where user_id = ${me.userId} and day = ${parsed.value.day} and revoked_at is null
  `;
  await database`
    insert into activity_shares (id, token, company_id, user_id, day, payload)
    values (${id}, ${token}, ${me.companyId}, ${me.userId}, ${parsed.value.day}, ${JSON.stringify(parsed.value)}::jsonb)
  `;
  return { token };
}

/** The caller's own live link for a day, so a reload can copy it without minting another. */
export async function myActivityShare(userId: string, day: string, sql?: Sql): Promise<{ token: string } | null> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error("Pick a day.");
  const database = await db(sql);
  const me = await member(database, userId);
  const rows = await database<{ token: string }>`
    select token from activity_shares
    where user_id = ${me.userId} and company_id = ${me.companyId} and day = ${day} and revoked_at is null
    order by created_at desc
    limit 1
  `;
  return rows[0] ? { token: rows[0].token } : null;
}

export async function readActivityShare(token: string, sql?: Sql): Promise<ActivitySnapshot | null> {
  if (!/^[A-Za-z0-9_-]{20,80}$/.test(token)) return null;
  const database = await db(sql);
  const rows = await database<{ payload: unknown; revoked_at: unknown }>`
    select payload, revoked_at from activity_shares where token = ${token}
  `;
  if (!rows[0] || rows[0].revoked_at) return null;
  return payloadOf(rows[0].payload);
}

export async function revokeActivityShare(userId: string, token: string, sql?: Sql): Promise<{ ok: true }> {
  const database = await db(sql);
  const me = await member(database, userId);
  const rows = await database<{ id: string; user_id: string; company_id: string; revoked_at: unknown }>`
    select id, user_id, company_id, revoked_at from activity_shares where token = ${token}
  `;
  const row = rows[0];
  if (!row || row.company_id !== me.companyId) throw new Error(SHARE_UNAVAILABLE);
  if (row.user_id !== me.userId) assertCan(me.role, "report.review");
  if (!row.revoked_at) {
    await database`update activity_shares set revoked_at = now() where id = ${row.id} and company_id = ${me.companyId}`;
  }
  return { ok: true };
}
