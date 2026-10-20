-- Spec 02 · Timesheets. Hours per person, day, job and cost code, out of the daily report.
-- The spec names this 0011_time; it is numbered after 0015 because it adds trades.default_cost_code_id
-- (trades come from 0015, crew board) and migrations apply in filename order.

alter table companies add column if not exists timezone text not null default 'America/New_York';
alter table companies add column if not exists week_starts smallint not null default 1; -- Monday

create table if not exists cost_codes (
  id text primary key,
  company_id text not null references companies (id) on delete cascade,
  code text not null,
  name text not null,
  kind text not null check (kind in ('labor', 'material', 'sub', 'equipment', 'other', 'mixed')),
  active boolean not null default true,
  unique (company_id, code)
);

alter table trades add column if not exists default_cost_code_id text references cost_codes (id) on delete set null;

create table if not exists time_entries (
  id text primary key,
  company_id text not null references companies (id) on delete cascade,
  user_id text not null,
  day date not null,
  report_id text references daily_reports (id) on delete set null,
  project_id text references projects (id) on delete set null,
  cost_code_id text references cost_codes (id),
  start_at timestamptz,
  end_at timestamptz,
  lunch_minutes integer not null default 0,
  minutes integer not null check (minutes between 0 and 1440),
  source text not null check (source in ('derived', 'edited', 'manual')),
  status text not null default 'submitted' check (status in ('submitted', 'approved', 'rejected', 'exported')),
  reject_reason text,
  approved_by text,
  approved_at timestamptz,
  export_id text,
  edited_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists time_entries_company_day_idx on time_entries (company_id, day);
create index if not exists time_entries_report_idx on time_entries (report_id);

-- money.view only (rate.view / rate.edit).
create table if not exists pay_rates (
  company_id text not null references companies (id) on delete cascade,
  user_id text not null,
  effective_on date not null,
  rate_cents integer not null check (rate_cents >= 0),
  burden_pct numeric(5, 2) not null default 0,
  primary key (user_id, effective_on)
);

create table if not exists payroll_exports (
  id text primary key,
  company_id text not null references companies (id) on delete cascade,
  period_start date not null,
  period_end date not null,
  kind text not null check (kind in ('payroll', 'sub_hours')),
  row_count integer not null,
  created_by text not null,
  created_at timestamptz not null default now(),
  -- Re-download returns exactly what was handed to payroll.
  csv text not null default '',
  -- "Void export" (owner) keeps the row as the audit trail.
  voided_at timestamptz,
  voided_by text
);

alter table daily_reports add column if not exists start_at timestamptz; -- confirmed by the worker at submit
alter table daily_reports add column if not exists end_at timestamptz;
