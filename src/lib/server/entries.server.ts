/**
 * Daily report entries (text or photo, time-stamped) and who may download a report as a PDF.
 *
 * Relative imports (not "@/") so the PGLite server tests can load this file under node:test.
 * Every function takes the `sql` to run on; reports.server passes the app's.
 */
import { randomUUID } from "node:crypto";
import type { Sql } from "../db.ts";
import { can, canWith } from "../permissions.ts";
import { MAX_ENTRIES, planTextSave, sortEntries, type ReportEntry, type TextEdit } from "../report-entries.ts";
import { sharingFor } from "./sharing.server.ts";

const text = (v: unknown) => (v == null ? "" : String(v));
const iso = (v: unknown): string | null => {
  if (v == null) return null;
  const d = v instanceof Date ? v : new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

type Me = { userId: string; companyId: string; role: string };
type EntryRow = { id: string; report_id: string; kind: string; body: string; photo_id: string | null; created_at: unknown; edited_at: unknown };

function toEntry(row: EntryRow): ReportEntry {
  return {
    id: text(row.id),
    kind: row.kind === "photo" ? "photo" : "text",
    body: text(row.body),
    photoId: row.photo_id ? text(row.photo_id) : null,
    createdAt: iso(row.created_at) ?? "",
    editedAt: iso(row.edited_at),
  };
}

/** Entries for many reports in one query, each list in time order. */
export async function entriesFor(sql: Sql, reportIds: string[]): Promise<Map<string, ReportEntry[]>> {
  const out = new Map<string, ReportEntry[]>(reportIds.map((id) => [id, []]));
  if (reportIds.length === 0) return out;
  const rows = await sql.query<EntryRow>(
    `select id, report_id, kind, body, photo_id, created_at, edited_at from daily_report_entries
     where report_id = any($1::text[]) order by created_at asc, id collate "C" asc`,
    [reportIds],
  );
  for (const row of rows) out.get(text(row.report_id))?.push(toEntry(row));
  for (const [id, list] of out) out.set(id, sortEntries(list));
  return out;
}

/**
 * A report written without entries (the demo seed, or a row from before migration 0017 that a
 * deploy raced) gets them now, by the same rule as the migration. Only runs when it has none,
 * so it never duplicates; `on conflict do nothing` makes concurrent calls safe.
 */
export async function backfillEntries(sql: Sql, reportId: string): Promise<void> {
  const has = await sql<{ n: number }>`select count(*)::int as n from daily_report_entries where report_id = ${reportId}`;
  if (Number(has[0]?.n ?? 0) > 0) return;
  await sql`
    insert into daily_report_entries (id, report_id, company_id, user_id, kind, body, created_at, edited_at)
    select 'legacy-text-' || r.id, r.id, r.company_id, r.user_id, 'text', r.narrative,
           coalesce(r.first_edit_at, r.created_at),
           case when r.last_edit_at > coalesce(r.first_edit_at, r.created_at) then r.last_edit_at end
    from daily_reports r where r.id = ${reportId} and btrim(r.narrative) <> ''
    on conflict (id) do nothing
  `;
  await sql`
    insert into daily_report_entries (id, report_id, company_id, user_id, kind, photo_id, created_at)
    select 'legacy-photo-' || p.id, p.report_id, p.company_id, p.user_id, 'photo', p.id, p.created_at
    from daily_report_photos p where p.report_id = ${reportId}
    on conflict do nothing
  `;
}

/** Keep daily_reports.narrative equal to narrativeOf(entries) for the review, AI summary and submit check. */
export async function syncNarrative(sql: Sql, reportId: string): Promise<void> {
  await sql`
    update daily_reports set narrative = coalesce((
      select string_agg(btrim(e.body), E'\n\n' order by e.created_at, e.id collate "C")
      from daily_report_entries e
      where e.report_id = ${reportId} and e.kind = 'text' and btrim(e.body) <> ''
    ), '')
    where id = ${reportId}
  `;
}

async function entryCount(sql: Sql, reportId: string): Promise<number> {
  const rows = await sql<{ n: number }>`select count(*)::int as n from daily_report_entries where report_id = ${reportId}`;
  return Number(rows[0]?.n ?? 0);
}

/**
 * Apply the editor's text (see planTextSave). Returns the id each new entry got, by client key,
 * so the editor keeps the same field (and the keyboard) on screen.
 */
export async function saveTextEntries(sql: Sql, me: Me, reportId: string, edits: TextEdit[]): Promise<Record<string, string>> {
  const current = (await entriesFor(sql, [reportId])).get(reportId) ?? [];
  const plan = planTextSave(current, edits);
  if (current.length - plan.remove.length + plan.insert.length > MAX_ENTRIES) {
    throw new Error(`Up to ${MAX_ENTRIES} entries per day.`);
  }
  const keys: Record<string, string> = {};
  for (const id of plan.remove) {
    await sql`delete from daily_report_entries where id = ${id} and report_id = ${reportId} and kind = 'text'`;
  }
  for (const u of plan.update) {
    await sql`
      update daily_report_entries set body = ${u.body}, edited_at = now()
      where id = ${u.id} and report_id = ${reportId} and kind = 'text'
    `;
  }
  for (const ins of plan.insert) {
    const id = randomUUID();
    await sql`
      insert into daily_report_entries (id, report_id, company_id, user_id, kind, body)
      values (${id}, ${reportId}, ${me.companyId}, ${me.userId}, 'text', ${ins.body})
    `;
    keys[ins.key] = id;
  }
  if (plan.insert.length || plan.update.length || plan.remove.length) await syncNarrative(sql, reportId);
  return keys;
}

export async function addPhotoEntry(sql: Sql, me: Me, reportId: string, photoId: string): Promise<void> {
  if ((await entryCount(sql, reportId)) >= MAX_ENTRIES) throw new Error(`Up to ${MAX_ENTRIES} entries per day.`);
  await sql`
    insert into daily_report_entries (id, report_id, company_id, user_id, kind, photo_id)
    values (${randomUUID()}, ${reportId}, ${me.companyId}, ${me.userId}, 'photo', ${photoId})
  `;
}

/**
 * Who may download a report as a PDF: Owner/Admin/superadmin any report in the company
 * (report.review); the author their own report only where they may send that job's documents
 * (doc.send, spec 06): Lead always, Labor only where "Labor can send documents" is on, Subs never.
 * A PDF is a document that can go to anyone, so it follows the same sharing rule.
 */
export function mayDownloadPdf(role: string, own: boolean, sharing: Parameters<typeof canWith>[2]): boolean {
  if (can(role, "report.review")) return true;
  return own && can(role, "report.write") && canWith(role, "doc.send", sharing);
}

/** mayDownloadPdf for many reports (one sharing lookup per distinct job). */
export async function pdfFlags(
  sql: Sql,
  me: Me,
  reports: { id: string | null; userId: string; projectId: string | null }[],
): Promise<boolean[]> {
  if (can(me.role, "report.review")) return reports.map(() => true);
  const cache = new Map<string, Awaited<ReturnType<typeof sharingFor>>>();
  const out: boolean[] = [];
  for (const r of reports) {
    const own = r.userId === me.userId;
    if (!own) {
      out.push(false);
      continue;
    }
    const key = r.projectId ?? "";
    if (!cache.has(key)) cache.set(key, await sharingFor(sql, me.companyId, r.projectId));
    out.push(mayDownloadPdf(me.role, own, cache.get(key)!));
  }
  return out;
}
