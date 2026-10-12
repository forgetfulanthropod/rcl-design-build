-- Daily report: one per team member per day. Free-text narrative + photos + lunch minutes.
create table if not exists daily_reports (
  id text primary key,
  company_id text not null references companies (id) on delete cascade,
  user_id text not null,
  day date not null,
  project_id text references projects (id) on delete set null,
  narrative text not null default '',
  lunch_minutes integer check (lunch_minutes between 0 and 60),
  first_edit_at timestamptz,
  last_edit_at timestamptz,
  submitted_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, day)
);
create index if not exists daily_reports_company_day_idx on daily_reports (company_id, day);

-- Photos stored in Postgres (bytea): downscaled full image (<= 1600 px) and a thumbnail.
create table if not exists daily_report_photos (
  id text primary key,
  report_id text not null references daily_reports (id) on delete cascade,
  company_id text not null references companies (id) on delete cascade,
  user_id text not null,
  mime text not null,
  bytes bytea not null,
  thumb bytea not null,
  size_bytes integer not null,
  width integer,
  height integer,
  taken_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists daily_report_photos_report_idx on daily_report_photos (report_id);

-- Cached AI "needs attention" summaries, keyed by the exact report contents they read.
create table if not exists attention_summaries (
  id text primary key,
  company_id text not null references companies (id) on delete cascade,
  from_day date not null,
  to_day date not null,
  input_hash text not null,
  items text not null,
  model text not null,
  created_at timestamptz not null default now(),
  unique (company_id, from_day, to_day, input_hash)
);
