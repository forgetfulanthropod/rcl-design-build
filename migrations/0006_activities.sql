-- Site activities for a day. Labor adds and edits open ones. A lead approves them.
create table if not exists activities (
  id text primary key,
  company_id text not null references companies (id) on delete cascade,
  project_id text references projects (id) on delete set null,
  day date not null,
  title text not null,
  detail text not null default '',
  status text not null default 'open' check (status in ('open', 'approved')),
  created_by text not null,
  updated_by text,
  approved_by text,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists activities_company_day_idx on activities (company_id, day);
