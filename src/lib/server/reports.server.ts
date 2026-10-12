import { createHash, randomUUID } from "node:crypto";
import { getSql, type Sql } from "@/lib/db";
import { can } from "@/lib/permissions";

const isPrincipal = (role: string) => can(role, "report.review");

const MAX_PHOTO_BYTES = 3 * 1024 * 1024;
const MAX_THUMB_BYTES = 200 * 1024;
const MAX_PHOTOS = 20;
const MAX_NARRATIVE = 8000;
const MIMES = new Set(["image/jpeg", "image/png", "image/webp"]);

export type ReportPhoto = { id: string; thumb: string; takenAt: string | null; createdAt: string };
export type DailyReport = {
  id: string | null;
  day: string;
  userId: string;
  userName: string;
  projectId: string | null;
  projectName: string;
  narrative: string;
  lunchMinutes: number | null;
  firstEditAt: string | null;
  lastEditAt: string | null;
  submittedAt: string | null;
  photos: ReportPhoto[];
};

function text(v: unknown): string {
  return v == null ? "" : String(v);
}
function iso(v: unknown): string | null {
  if (v == null) return null;
  const d = v instanceof Date ? v : new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
function dayString(v: unknown): string {
  return text(v).slice(0, 10);
}

export function isDay(day: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(day) && !Number.isNaN(Date.parse(`${day}T12:00:00Z`));
}

/** A field report can only be written for (about) today: within 36 h of server time, allowing for time zones. */
export function editableDay(day: string): string {
  if (!isDay(day)) throw new Error("Pick a day.");
  if (Math.abs(Date.parse(`${day}T12:00:00Z`) - Date.now()) > 36 * 3_600_000) {
    throw new Error("You can only write today's report.");
  }
  return day;
}

function decodeDataUrl(url: string, max: number): { mime: string; bytes: Buffer } {
  const m = /^data:([a-z/+-]+);base64,([A-Za-z0-9+/=]+)$/.exec(url);
  if (!m || !MIMES.has(m[1])) throw new Error("Photos must be JPEG, PNG, or WebP.");
  const bytes = Buffer.from(m[2], "base64");
  if (bytes.length === 0 || bytes.length > max) throw new Error("That photo is too large.");
  const ok =
    (m[1] === "image/jpeg" && bytes[0] === 0xff && bytes[1] === 0xd8) ||
    (m[1] === "image/png" && bytes.subarray(0, 4).toString("hex") === "89504e47") ||
    (m[1] === "image/webp" && bytes.subarray(8, 12).toString() === "WEBP");
  if (!ok) throw new Error("That file isn't a valid image.");
  return { mime: m[1], bytes };
}

type Member = { userId: string; companyId: string; role: string; name: string };

export async function member(sql: Sql, userId: string): Promise<Member> {
  const rows = await sql<{ company_id: string; role: string; name: string }>`
    select company_id, role, name from profiles where user_id = ${userId}
  `;
  if (!rows[0]) throw new Error("Finish company setup first.");
  return { userId, companyId: text(rows[0].company_id), role: text(rows[0].role), name: text(rows[0].name) };
}

async function requirePrincipal(sql: Sql, userId: string): Promise<Member> {
  const me = await member(sql, userId);
  if (!isPrincipal(me.role)) throw new Error("Only an owner or admin can review reports.");
  return me;
}

/** Ensures the report exists and stamps first/last edit. Refuses once submitted. */
async function touchReport(sql: Sql, me: Member, day: string): Promise<string> {
  await sql`
    insert into daily_reports (id, company_id, user_id, day, first_edit_at, last_edit_at)
    values (${randomUUID()}, ${me.companyId}, ${me.userId}, ${day}, now(), now())
    on conflict (user_id, day) do nothing
  `;
  const rows = await sql<{ id: string; submitted_at: unknown }>`
    select id, submitted_at from daily_reports where user_id = ${me.userId} and day = ${day}
  `;
  const r = rows[0];
  if (!r) throw new Error("Could not open today's report.");
  if (r.submitted_at) throw new Error("Today's report is already submitted.");
  await sql`
    update daily_reports set first_edit_at = coalesce(first_edit_at, now()), last_edit_at = now()
    where id = ${text(r.id)}
  `;
  return text(r.id);
}

type Row = Record<string, unknown>;

async function hydrate(sql: Sql, rows: Row[]): Promise<DailyReport[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => text(r.id));
  const photos = await sql.query<{ id: string; report_id: string; thumb: Uint8Array; taken_at: unknown; created_at: unknown }>(
    `select id, report_id, thumb, taken_at, created_at from daily_report_photos
     where report_id = any($1) order by created_at asc`,
    [ids],
  );
  return rows.map((r) => ({
    id: text(r.id),
    day: dayString(r.day),
    userId: text(r.user_id),
    userName: text(r.user_name),
    projectId: r.project_id ? text(r.project_id) : null,
    projectName: text(r.project_name),
    narrative: text(r.narrative),
    lunchMinutes: r.lunch_minutes == null ? null : Number(r.lunch_minutes),
    firstEditAt: iso(r.first_edit_at),
    lastEditAt: iso(r.last_edit_at),
    submittedAt: iso(r.submitted_at),
    photos: photos
      .filter((p) => text(p.report_id) === text(r.id))
      .map((p) => ({
        id: text(p.id),
        thumb: `data:image/jpeg;base64,${Buffer.from(p.thumb).toString("base64")}`,
        takenAt: iso(p.taken_at),
        createdAt: iso(p.created_at) ?? "",
      })),
  }));
}

const SELECT = `
  select r.id, r.day::text as day, r.user_id, coalesce(pr.name, '') as user_name, r.project_id,
         coalesce(p.name, '') as project_name, r.narrative, r.lunch_minutes,
         r.first_edit_at, r.last_edit_at, r.submitted_at
  from daily_reports r
  left join profiles pr on pr.user_id = r.user_id
  left join projects p on p.id = r.project_id`;

// ---------- field: my own report ----------

export async function getMyReport(userId: string, rawDay: string) {
  const day = editableDay(rawDay);
  const sql = await getSql();
  const me = await member(sql, userId);
  const rows = await sql.query<Row>(`${SELECT} where r.user_id = $1 and r.day = $2`, [userId, day]);
  const [found] = await hydrate(sql, rows);
  const jobs = await sql<{ id: string; name: string }>`
    select id, name from projects where company_id = ${me.companyId} and archived = false order by name
  `;
  return {
    report:
      found ??
      ({
        id: null, day, userId, userName: me.name, projectId: null, projectName: "", narrative: "",
        lunchMinutes: null, firstEditAt: null, lastEditAt: null, submittedAt: null, photos: [],
      } satisfies DailyReport),
    jobs: jobs.map((j) => ({ id: text(j.id), name: text(j.name) })),
  };
}

export async function saveMyReport(userId: string, input: { day: string; narrative: string; projectId: string }) {
  const day = editableDay(input.day);
  const sql = await getSql();
  const me = await member(sql, userId);
  let projectId: string | null = input.projectId || null;
  if (projectId) {
    const ok = await sql`select id from projects where id = ${projectId} and company_id = ${me.companyId}`;
    if (!ok[0]) projectId = null;
  }
  const id = await touchReport(sql, me, day);
  await sql`
    update daily_reports set narrative = ${input.narrative.slice(0, MAX_NARRATIVE)}, project_id = ${projectId}
    where id = ${id}
  `;
  return getMyReport(userId, day);
}

export async function addMyPhoto(
  userId: string,
  input: { day: string; image: string; thumb: string; width: number; height: number; takenAt: string },
) {
  const day = editableDay(input.day);
  const full = decodeDataUrl(input.image, MAX_PHOTO_BYTES);
  const thumb = decodeDataUrl(input.thumb, MAX_THUMB_BYTES);
  const sql = await getSql();
  const me = await member(sql, userId);
  const id = await touchReport(sql, me, day);
  const count = await sql<{ n: number }>`select count(*) as n from daily_report_photos where report_id = ${id}`;
  if (Number(count[0]?.n ?? 0) >= MAX_PHOTOS) throw new Error(`Up to ${MAX_PHOTOS} photos per day.`);
  await sql`
    insert into daily_report_photos (id, report_id, company_id, user_id, mime, bytes, thumb, size_bytes, width, height, taken_at)
    values (${randomUUID()}, ${id}, ${me.companyId}, ${userId}, ${full.mime}, ${full.bytes}, ${thumb.bytes},
            ${full.bytes.length}, ${Math.round(input.width) || null}, ${Math.round(input.height) || null}, ${iso(input.takenAt)})
  `;
  return getMyReport(userId, day);
}

export async function submitMyReport(userId: string, input: { day: string; lunchMinutes: number }) {
  const day = editableDay(input.day);
  const lunch = Number(input.lunchMinutes);
  if (!Number.isInteger(lunch) || lunch < 0 || lunch > 60) throw new Error("Lunch must be 0 to 60 minutes.");
  const sql = await getSql();
  const me = await member(sql, userId);
  const id = await touchReport(sql, me, day);
  const rows = await sql<{ narrative: string }>`select narrative from daily_reports where id = ${id}`;
  if (!text(rows[0]?.narrative).trim()) throw new Error("Write a few words about your day before submitting.");
  await sql`update daily_reports set lunch_minutes = ${lunch}, submitted_at = now(), last_edit_at = now() where id = ${id}`;
  return getMyReport(userId, day);
}

export async function listMyReports(userId: string) {
  const sql = await getSql();
  const rows = await sql.query<Row>(`${SELECT} where r.user_id = $1 order by r.day desc limit 60`, [userId]);
  return hydrate(sql, rows);
}

// ---------- principals: review ----------

export async function reviewReports(userId: string, input: { from: string; to: string; projectId: string; personId: string }) {
  if (!isDay(input.from) || !isDay(input.to)) throw new Error("Pick dates.");
  const sql = await getSql();
  const me = await requirePrincipal(sql, userId);
  const params: unknown[] = [me.companyId, input.from, input.to];
  let where = "r.company_id = $1 and r.day between $2 and $3";
  if (input.projectId) {
    params.push(input.projectId);
    where += ` and r.project_id = $${params.length}`;
  }
  if (input.personId) {
    params.push(input.personId);
    where += ` and r.user_id = $${params.length}`;
  }
  const rows = await sql.query<Row>(`${SELECT} where ${where} order by r.day desc, user_name asc`, params);
  const reports = await hydrate(sql, rows);
  const jobs = await sql<{ id: string; name: string }>`select id, name from projects where company_id = ${me.companyId} order by name`;
  const people = await sql<{ user_id: string; name: string; role: string }>`
    select user_id, name, role from profiles where company_id = ${me.companyId} order by name
  `;
  return {
    reports,
    jobs: jobs.map((j) => ({ id: text(j.id), name: text(j.name) })),
    people: people.map((p) => ({ id: text(p.user_id), name: text(p.name), role: text(p.role) })),
  };
}

/** Full-size photo, for the photo's owner or a principal in the same company. */
export async function readPhoto(userId: string, photoId: string) {
  const sql = await getSql();
  const me = await member(sql, userId);
  const rows = await sql<{ mime: string; bytes: Uint8Array; user_id: string }>`
    select mime, bytes, user_id from daily_report_photos where id = ${photoId} and company_id = ${me.companyId}
  `;
  const p = rows[0];
  if (!p) return null;
  if (text(p.user_id) !== userId && !isPrincipal(me.role)) return null;
  return { mime: text(p.mime), bytes: Buffer.from(p.bytes) };
}

// ---------- AI attention summary ----------

import { ATTENTION_SYSTEM as SYSTEM, parseAttention, type AttentionItem, type ModelCall } from "@/lib/attention";
export type { AttentionItem } from "@/lib/attention";

export async function attentionSummary(
  userId: string,
  input: { from: string; to: string; refresh?: boolean },
  callModel: ModelCall,
): Promise<{ status: "ok" | "no-key" | "error" | "empty"; items: AttentionItem[]; cached: boolean; generatedAt: string | null; reportCount: number }> {
  const { reports } = await reviewReports(userId, { from: input.from, to: input.to, projectId: "", personId: "" });
  const withText = reports.filter((r) => r.narrative.trim());
  if (withText.length === 0) return { status: "empty", items: [], cached: false, generatedAt: null, reportCount: 0 };
  const sql = await getSql();
  const me = await member(sql, userId);
  const payload = withText
    .map((r) => `[report ${r.id}] ${r.day} · ${r.userName}${r.projectName ? ` · ${r.projectName}` : ""}\n${r.narrative.trim()}`)
    .join("\n\n");
  const hash = createHash("sha256").update(payload).digest("hex");
  if (!input.refresh) {
    const hit = await sql<{ items: string; created_at: unknown }>`
      select items, created_at from attention_summaries
      where company_id = ${me.companyId} and from_day = ${input.from} and to_day = ${input.to} and input_hash = ${hash}
    `;
    if (hit[0]) {
      return { status: "ok", items: JSON.parse(text(hit[0].items)) as AttentionItem[], cached: true, generatedAt: iso(hit[0].created_at), reportCount: withText.length };
    }
  }
  if (!process.env.XAI_API_KEY) return { status: "no-key", items: [], cached: false, generatedAt: null, reportCount: withText.length };
  let raw: string | null = null;
  try {
    raw = await callModel(SYSTEM, payload.slice(0, 60_000));
  } catch {
    raw = null;
  }
  if (raw == null) return { status: "error", items: [], cached: false, generatedAt: null, reportCount: withText.length };
  const items = parseAttention(raw, withText);
  await sql`
    insert into attention_summaries (id, company_id, from_day, to_day, input_hash, items, model)
    values (${randomUUID()}, ${me.companyId}, ${input.from}, ${input.to}, ${hash}, ${JSON.stringify(items)}, ${"grok-4.5"})
    on conflict (company_id, from_day, to_day, input_hash) do update set items = excluded.items, created_at = now()
  `;
  return { status: "ok", items, cached: false, generatedAt: new Date().toISOString(), reportCount: withText.length };
}
