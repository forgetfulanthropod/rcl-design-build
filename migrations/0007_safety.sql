-- Safety checks from the personal safety assessment:
-- orientation, daily job safety analysis, 30-day inspection, training schedule.
create table if not exists safety_orientations (
  company_id text not null references companies (id) on delete cascade,
  user_id text not null,
  attended boolean not null,
  attended_on date,
  updated_by text not null,
  updated_at timestamptz not null default now(),
  primary key (company_id, user_id)
);

create table if not exists job_safety_analyses (
  id text primary key,
  company_id text not null references companies (id) on delete cascade,
  project_id text references projects (id) on delete set null,
  day date not null,
  hazards text not null default '',
  controls text not null default '',
  status text not null default 'open' check (status in ('open', 'approved')),
  created_by text not null,
  approved_by text,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists jsa_company_day_idx on job_safety_analyses (company_id, day);

create table if not exists safety_inspections (
  id text primary key,
  company_id text not null references companies (id) on delete cascade,
  project_id text references projects (id) on delete set null,
  inspected_on date not null,
  notes text not null default '',
  recorded_by text not null,
  created_at timestamptz not null default now()
);
create index if not exists safety_inspections_company_idx on safety_inspections (company_id, inspected_on);

create table if not exists safety_training (
  id text primary key,
  company_id text not null references companies (id) on delete cascade,
  user_id text,
  title text not null,
  due_on date,
  completed_on date,
  created_by text not null,
  created_at timestamptz not null default now()
);
create index if not exists safety_training_company_idx on safety_training (company_id);
