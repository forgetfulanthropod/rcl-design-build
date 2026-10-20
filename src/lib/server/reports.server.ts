import { createHash, randomUUID } from "node:crypto";
import { getSql, type Sql } from "@/lib/db";
import { can, ForbiddenError } from "@/lib/permissions";
import { legacyEntries, type ReportEntry, type TextEdit } from "@/lib/report-entries";
import { addPhotoEntry, backfillEntries, entriesFor, pdfFlags, saveTextEntries } from "./entries.server";

const isPrincipal = (role: string) => can(role, "report.review");

const MAX_PHOTO_BYTES = 3 * 1024 * 1024;
const MAX_THUMB_BYTES = 200 * 1024;
const MAX_PHOTOS = 20;
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
  /** The report as written: text and photo entries in time order (photo entries match `photos` by id). */
  entries: ReportEntry[];
  /** Whether the viewer may download this report as a PDF (see mayDownloadPdf). */
  canPdf: boolean;
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
  const id = await openReport(sql, me, day);
  // A report from before entries (or the demo seed) gets its entries first, so nothing is lost.
  await backfillEntries(sql, id);
  return id;
}

async function openReport(sql: Sql, me: Member, day: string): Promise<string> {
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

async function hydrate(sql: Sql, rows: Row[], viewer: Member): Promise<DailyReport[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => text(r.id));
  const entries = await entriesFor(sql, ids);
  const flags = await pdfFlags(
    sql,
    viewer,
    rows.map((r) => ({ id: text(r.id), userId: text(r.user_id), projectId: r.project_id ? text(r.project_id) : null })),
  );
  const photos = await sql.query<{ id: string; report_id: string; thumb: Uint8Array; taken_at: unknown; created_at: unknown }>(
    `select id, report_id, thumb, taken_at, created_at from daily_report_photos
     where report_id = any($1) order by created_at asc`,
    [ids],
  );
  return rows.map((r, i) => {
    const own = photos
      .filter((p) => text(p.report_id) === text(r.id))
      .map((p) => ({
        id: text(p.id),
        thumb: `data:image/jpeg;base64,${Buffer.from(p.thumb).toString("base64")}`,
        takenAt: iso(p.taken_at),
        createdAt: iso(p.created_at) ?? "",
      }));
    const stored = entries.get(text(r.id)) ?? [];
    return {
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
    photos: own,
    // Reports not yet backfilled (demo seed) read the same entries the backfill would write.
    entries: stored.length
      ? stored
      : legacyEntries(
          {
            id: text(r.id),
            narrative: text(r.narrative),
            firstEditAt: iso(r.first_edit_at),
            lastEditAt: iso(r.last_edit_at),
            createdAt: iso(r.created_at) ?? "",
          },
          own,
        ),
    canPdf: flags[i] ?? false,
    };
  });
}

const SELECT = `
  select r.id, r.day::text as day, r.user_id, coalesce(pr.name, '') as user_name, r.project_id,
         coalesce(p.name, '') as project_name, r.narrative, r.lunch_minutes,
         r.first_edit_at, r.last_edit_at, r.submitted_at, r.created_at
  from daily_reports r
  left join profiles pr on pr.user_id = r.user_id
  left join projects p on p.id = r.project_id`;

// ---------- field: my own report ----------

export async function getMyReport(userId: string, rawDay: string) {
  const day = editableDay(rawDay);
  const sql = await getSql();
  const me = await member(sql, userId);
  const rows = await sql.query<Row>(`${SELECT} where r.user_id = $1 and r.day = $2`, [userId, day]);
  const [found] = await hydrate(sql, rows, me);
  const jobs = await sql<{ id: string; name: string }>`
    select id, name from projects where company_id = ${me.companyId} and archived = false order by name
  `;
  return {
    report:
      found ??
      ({
        id: null, day, userId, userName: me.name, projectId: null, projectName: "", narrative: "",
        lunchMinutes: null, firstEditAt: null, lastEditAt: null, submittedAt: null, photos: [], entries: [],
        canPdf: (await pdfFlags(sql, me, [{ id: null, userId, projectId: null }]))[0],
      } satisfies DailyReport),
    jobs: jobs.map((j) => ({ id: text(j.id), name: text(j.name) })),
  };
}

/**
 * Save the editor: the job, plus its text entries (new, changed, or cleared; see planTextSave).
 * Returns the report and the id each new text entry got, by the editor's key.
 */
export async function saveMyReport(userId: string, input: { day: string; texts: TextEdit[]; projectId: string }) {
  const day = editableDay(input.day);
  const sql = await getSql();
  const me = await member(sql, userId);
  let projectId: string | null = input.projectId || null;
  if (projectId) {
    const ok = await sql`select id from projects where id = ${projectId} and company_id = ${me.companyId}`;
    if (!ok[0]) projectId = null;
  }
  const id = await touchReport(sql, me, day);
  await sql`update daily_reports set project_id = ${projectId} where id = ${id}`;
  const keys = await saveTextEntries(sql, me, id, input.texts);
  return { ...(await getMyReport(userId, day)), keys };
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
  const photoId = randomUUID();
  await sql`
    insert into daily_report_photos (id, report_id, company_id, user_id, mime, bytes, thumb, size_bytes, width, height, taken_at)
    values (${photoId}, ${id}, ${me.companyId}, ${userId}, ${full.mime}, ${full.bytes}, ${thumb.bytes},
            ${full.bytes.length}, ${Math.round(input.width) || null}, ${Math.round(input.height) || null}, ${iso(input.takenAt)})
  `;
  await addPhotoEntry(sql, me, id, photoId);
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
  const me = await member(sql, userId);
  const rows = await sql.query<Row>(`${SELECT} where r.user_id = $1 order by r.day desc limit 60`, [userId]);
  return hydrate(sql, rows, me);
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
  const reports = await hydrate(sql, rows, me);
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

// ---------- PDF download ----------

/**
 * Everything the report PDF shows, for a viewer allowed to download it (mayDownloadPdf):
 * the author's own report by day, or any report in the company by id for Owner/Admin. Only
 * job, day, author, edit times, lunch and entries; never any money. The browser builds the PDF
 * (src/lib/report-pdf.ts) and fetches full photos through getReportPhoto.
 */
export async function reportPdfData(userId: string, input: { reportId?: string; day?: string }) {
  const sql = await getSql();
  const me = await member(sql, userId);
  let report: DailyReport | undefined;
  if (input.reportId) {
    const rows = await sql.query<Row>(`${SELECT} where r.id = $1 and r.company_id = $2`, [input.reportId, me.companyId]);
    [report] = await hydrate(sql, rows, me);
    if (!report) throw new Error("Report not found.");
  } else {
    report = (await getMyReport(userId, input.day ?? "")).report;
  }
  if (!report.canPdf) throw new ForbiddenError("doc.send");
  return {
    day: report.day,
    userName: report.userName,
    projectName: report.projectName,
    firstEditAt: report.firstEditAt,
    lastEditAt: report.lastEditAt,
    lunchMinutes: report.lunchMinutes,
    submittedAt: report.submittedAt,
    entries: report.entries,
  };
}

// ---------- AI attention summary ----------

import { ATTENTION_SYSTEM as SYSTEM, attentionPayload, parseAttention, planAttention, type AttentionItem, type ModelCall } from "@/lib/attention";
export type { AttentionItem } from "@/lib/attention";

export type AttentionResult = {
  status: "ok" | "no-key" | "error" | "empty" | "pending";
  items: AttentionItem[];
  cached: boolean;
  /** An older summary for this range; the reports have changed since. A fresh one is on its way. */
  stale: boolean;
  generatedAt: string | null;
  reportCount: number;
};

/**
 * AI attention summary. Reads only the narrative columns (no photos, jobs or people), so the
 * cache check is a couple of small queries. With `cachedOnly` it never calls the model: it
 * returns an exact hit, the latest older summary for the range (`stale`), or `pending`.
 */
export async function attentionSummary(
  userId: string,
  input: { from: string; to: string; refresh?: boolean; cachedOnly?: boolean },
  callModel: ModelCall,
): Promise<AttentionResult> {
  if (!isDay(input.from) || !isDay(input.to)) throw new Error("Pick dates.");
  const sql = await getSql();
  const me = await requirePrincipal(sql, userId);
  const rows = await sql.query<Row>(
    `select r.id, r.day::text as day, coalesce(pr.name, '') as user_name, coalesce(p.name, '') as project_name, r.narrative
     from daily_reports r
     left join profiles pr on pr.user_id = r.user_id
     left join projects p on p.id = r.project_id
     where r.company_id = $1 and r.day between $2 and $3 and btrim(r.narrative) <> ''
     order by r.day desc, user_name asc`,
    [me.companyId, input.from, input.to],
  );
  const { payload, withText } = attentionPayload(
    rows.map((r) => ({
      id: text(r.id),
      day: dayString(r.day),
      userName: text(r.user_name),
      projectName: text(r.project_name),
      narrative: text(r.narrative),
    })),
  );
  const reportCount = withText.length;
  const hash = createHash("sha256").update(payload).digest("hex");
  const hits = reportCount
    ? await sql<{ items: string; created_at: unknown; input_hash: string }>`
        select items, created_at, input_hash from attention_summaries
        where company_id = ${me.companyId} and from_day = ${input.from} and to_day = ${input.to}
        order by (input_hash = ${hash}) desc, created_at desc
        limit 1
      `
    : [];
  const hit = hits[0];
  const exactHit = Boolean(hit && text(hit.input_hash) === hash);
  const plan = planAttention({
    reportCount,
    exactHit,
    latestHit: Boolean(hit),
    refresh: Boolean(input.refresh),
    cachedOnly: Boolean(input.cachedOnly),
  });
  const base = { cached: false, stale: false, generatedAt: null, reportCount };
  if (plan.kind === "empty") return { ...base, status: "empty", items: [], reportCount: 0 };
  if ((plan.kind === "cached" || plan.kind === "stale") && hit) {
    return {
      status: "ok",
      items: JSON.parse(text(hit.items)) as AttentionItem[],
      cached: true,
      stale: plan.kind === "stale",
      generatedAt: iso(hit.created_at),
      reportCount,
    };
  }
  if (!process.env.XAI_API_KEY) return { ...base, status: "no-key", items: [] };
  if (plan.kind === "pending") return { ...base, status: "pending", items: [] };
  let raw: string | null = null;
  try {
    raw = await callModel(SYSTEM, payload.slice(0, 60_000));
  } catch {
    raw = null;
  }
  if (raw == null) return { ...base, status: "error", items: [] };
  const items = parseAttention(raw, withText);
  await sql`
    insert into attention_summaries (id, company_id, from_day, to_day, input_hash, items, model)
    values (${randomUUID()}, ${me.companyId}, ${input.from}, ${input.to}, ${hash}, ${JSON.stringify(items)}, ${"grok-4.5"})
    on conflict (company_id, from_day, to_day, input_hash) do update set items = excluded.items, created_at = now()
  `;
  return { ...base, status: "ok", items, generatedAt: new Date().toISOString() };
}

/** One report by id, for /reports/$reportId (spec 05 · F1). Principals only, own company only. */
export async function reviewReport(userId: string, id: string): Promise<DailyReport> {
  const sql = await getSql();
  const me = await requirePrincipal(sql, userId);
  const rows = await sql.query<Row>(`${SELECT} where r.company_id = $1 and r.id = $2`, [me.companyId, id]);
  const [report] = await hydrate(sql, rows);
  if (!report) throw new Error("Report not found.");
  return report;
}

/** Report-based hints for the form job default (spec 05 · F3). See src/lib/current-job.ts. */
export async function jobHints(userId: string, day: string): Promise<import("@/lib/current-job").JobHints> {
  const sql = await getSql();
  const me = await member(sql, userId);
  const reports = await sql<{ day: unknown; project_id: string | null }>`
    select r.day, r.project_id from daily_reports r
    join projects p on p.id = r.project_id and p.archived = false
    where r.company_id = ${me.companyId} and r.user_id = ${me.userId} and r.project_id is not null
      and r.day between (${day}::date - 14) and ${day}::date
    order by r.day desc
    limit 2
  `;
  const active = await sql<{ id: string }>`
    select id from projects where company_id = ${me.companyId} and archived = false order by name asc
  `;
  const first = reports[0];
  const isToday = first ? dayString(first.day) === day : false;
  return {
    todayJobId: isToday && first ? text(first.project_id) : null,
    recentJobId: first ? text(first.project_id) : null,
    activeJobIds: active.map((row) => text(row.id)),
  };
}
