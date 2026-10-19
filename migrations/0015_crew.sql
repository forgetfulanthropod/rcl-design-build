-- Spec 01 · Crew & skills board.
-- Who works where, on which day: trades, certifications, assignments, unavailability.
-- Numbered after 0014 (sharing). Does not depend on 0010–0013.

create table if not exists trades (
  id text primary key,
  company_id text not null references companies (id) on delete cascade,
  name text not null,
  color text,
  sort integer not null default 0,
  unique (company_id, name)
);

create table if not exists person_trades (
  company_id text not null references companies (id) on delete cascade,
  user_id text not null,
  trade_id text not null references trades (id) on delete cascade,
  level text not null default 'journeyman' check (level in ('apprentice', 'journeyman', 'lead')),
  primary key (user_id, trade_id)
);

create table if not exists cert_types (
  id text primary key,
  company_id text not null references companies (id) on delete cascade,
  name text not null,
  validity_months integer,
  unique (company_id, name)
);

create table if not exists person_certs (
  id text primary key,
  company_id text not null references companies (id) on delete cascade,
  user_id text not null,
  cert_type_id text not null references cert_types (id) on delete cascade,
  number text not null default '',
  issued_on date,
  expires_on date,
  verified_by text,
  verified_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists person_certs_expires_idx on person_certs (company_id, expires_on);

create table if not exists job_requirements (
  project_id text not null references projects (id) on delete cascade,
  company_id text not null references companies (id) on delete cascade,
  cert_type_id text not null references cert_types (id) on delete cascade,
  primary key (project_id, cert_type_id)
);

create table if not exists job_leads (
  project_id text not null references projects (id) on delete cascade,
  user_id text not null,
  primary key (project_id, user_id)
);

create table if not exists crew_assignments (
  id text primary key,
  company_id text not null references companies (id) on delete cascade,
  user_id text not null,
  project_id text not null references projects (id) on delete cascade,
  day date not null,
  part text not null default 'full' check (part in ('full', 'am', 'pm')),
  activity_id text references activities (id) on delete set null,
  note text not null default '',
  status text not null default 'draft' check (status in ('draft', 'published')),
  assigned_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, day, part)
);
create index if not exists crew_assignments_day_idx on crew_assignments (company_id, day);

create table if not exists person_unavailability (
  id text primary key,
  company_id text not null references companies (id) on delete cascade,
  user_id text not null,
  from_day date not null,
  to_day date not null,
  reason text not null check (reason in ('pto', 'sick', 'training', 'other')),
  status text not null default 'confirmed' check (status in ('requested', 'confirmed', 'declined')),
  note text not null default '',
  created_by text not null,
  created_at timestamptz not null default now()
);

alter table profiles add column if not exists sub_company text;
alter table profiles add column if not exists active boolean not null default true;
alter table profiles add column if not exists employee_number text;
