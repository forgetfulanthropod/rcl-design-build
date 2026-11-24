-- Dispatch board: where each person goes, starting at 8:00 AM.
-- Locations may point at an existing job (projects) or stand alone (shop, yard, a one-off site).
-- Full-time placements carry forward: the latest row on or before a day is that day's location.
-- Part-time placements exist only on the days someone is placed.

create table if not exists dispatch_locations (
  id text primary key,
  company_id text not null references companies (id) on delete cascade,
  project_id text references projects (id) on delete set null,
  name text not null,
  address text not null default '',
  notes text not null default '',
  sort integer not null default 0,
  archived boolean not null default false,
  created_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (char_length(name) between 1 and 120),
  check (char_length(address) <= 160),
  check (char_length(notes) <= 800)
);
create unique index if not exists dispatch_locations_project_idx
  on dispatch_locations (company_id, project_id)
  where project_id is not null;
create index if not exists dispatch_locations_company_idx on dispatch_locations (company_id, sort);

create table if not exists dispatch_day_notes (
  location_id text not null references dispatch_locations (id) on delete cascade,
  day date not null,
  notes text not null default '',
  updated_by text not null,
  updated_at timestamptz not null default now(),
  primary key (location_id, day),
  check (char_length(notes) <= 800)
);

create table if not exists dispatch_roster (
  company_id text not null references companies (id) on delete cascade,
  user_id text not null,
  kind text not null check (kind in ('full', 'part')),
  created_by text not null,
  created_at timestamptz not null default now(),
  primary key (company_id, user_id)
);

create table if not exists dispatch_placements (
  id text primary key,
  company_id text not null references companies (id) on delete cascade,
  user_id text not null,
  location_id text references dispatch_locations (id) on delete set null,
  day date not null,
  kind text not null check (kind in ('full', 'part')),
  placed_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, user_id, day)
);
create index if not exists dispatch_placements_company_day_idx on dispatch_placements (company_id, day);

-- A day's instruction for one person. Location instructions for a day live in dispatch_day_notes.
-- Empty is not stored: clearing deletes the row.
create table if not exists dispatch_person_notes (
  company_id text not null references companies (id) on delete cascade,
  user_id text not null,
  day date not null,
  notes text not null,
  updated_by text not null,
  updated_at timestamptz not null default now(),
  primary key (company_id, user_id, day),
  check (char_length(notes) between 1 and 800)
);

-- A change that makes a day's sheet dirty until that day is sent.
create table if not exists dispatch_changes (
  id text primary key,
  company_id text not null references companies (id) on delete cascade,
  day date not null,
  created_at timestamptz not null default now()
);
create index if not exists dispatch_changes_day_idx on dispatch_changes (company_id, day, created_at);

create table if not exists dispatch_day_sends (
  company_id text not null references companies (id) on delete cascade,
  day date not null,
  last_sent_at timestamptz,
  primary key (company_id, day)
);

-- One open send per company-day. Claiming flips status so a second worker cannot text twice.
create table if not exists dispatch_send_jobs (
  id text primary key,
  company_id text not null references companies (id) on delete cascade,
  day date not null,
  status text not null check (status in ('scheduled', 'sending', 'sent', 'cancelled')),
  send_at timestamptz not null,
  created_by text not null,
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  result_sent integer not null default 0,
  result_skipped integer not null default 0,
  result_configured boolean not null default false
);
create unique index if not exists dispatch_send_jobs_open_idx
  on dispatch_send_jobs (company_id, day)
  where status = 'scheduled';
