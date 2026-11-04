-- Work sessions: a block of hours on one job, for one person, on one calendar day.
-- These paint the 24-hour bar and the lettered PDF caption. 0016 stays reserved for timesheets.
-- Photos also record where their clock came from: the camera (exif) or, only when the camera
-- wrote nothing, the file's last-modified time (file). Existing taken_at rows stay camera time.

alter table daily_report_photos
  add column if not exists taken_source text check (taken_source in ('exif', 'file'));

create table if not exists work_sessions (
  id text primary key,
  company_id text not null references companies (id) on delete cascade,
  user_id text not null,
  project_id text references projects (id) on delete set null,
  day date not null,
  start_min integer not null check (start_min between 0 and 1439),
  end_min integer not null check (end_min between 1 and 1440),
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_min > start_min),
  check (char_length(notes) <= 500)
);
create index if not exists work_sessions_company_day_idx on work_sessions (company_id, day);
create index if not exists work_sessions_user_day_idx on work_sessions (user_id, day);
