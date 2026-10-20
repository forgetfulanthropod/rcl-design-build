-- Daily report as an ordered list of entries (text or photo), each time-stamped.
-- 0016 is left for timesheets (spec 02 · in progress); migrate.mjs applies files by name.
create table if not exists daily_report_entries (
  id text primary key,
  report_id text not null references daily_reports (id) on delete cascade,
  company_id text not null references companies (id) on delete cascade,
  user_id text not null,
  kind text not null check (kind in ('text', 'photo')),
  body text not null default '',
  photo_id text references daily_report_photos (id) on delete cascade,
  created_at timestamptz not null default now(),
  edited_at timestamptz,
  check ((kind = 'photo') = (photo_id is not null))
);
create index if not exists daily_report_entries_report_idx on daily_report_entries (report_id, created_at);
create unique index if not exists daily_report_entries_photo_idx on daily_report_entries (photo_id) where photo_id is not null;

-- Backfill: every existing report keeps its words and photos, now as entries (no data loss;
-- daily_reports.narrative and daily_report_photos are untouched). Same rule as legacyEntries()
-- in src/lib/report-entries.ts: the narrative is one text entry stamped at the first edit
-- (edited at the last edit when later); each photo is a photo entry stamped when it was added.
insert into daily_report_entries (id, report_id, company_id, user_id, kind, body, created_at, edited_at)
select 'legacy-text-' || r.id, r.id, r.company_id, r.user_id, 'text', r.narrative,
       coalesce(r.first_edit_at, r.created_at),
       case when r.last_edit_at > coalesce(r.first_edit_at, r.created_at) then r.last_edit_at end
from daily_reports r
where btrim(r.narrative) <> ''
on conflict (id) do nothing;

insert into daily_report_entries (id, report_id, company_id, user_id, kind, photo_id, created_at)
select 'legacy-photo-' || p.id, p.report_id, p.company_id, p.user_id, 'photo', p.id, p.created_at
from daily_report_photos p
on conflict do nothing;
