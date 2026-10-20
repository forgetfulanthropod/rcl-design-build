-- Spec 06 rev 3 · Sharing settings and the per-job sharing review.
-- Every who-sees-what call is a setting that defaults to sharing less: a company default plus a
-- per-project override (null = inherit). Only Owner, Admin and superadmin change them, and every
-- change and every review is written to sharing_audit.
-- Numbered after the roadmap migrations 0010-0013; it doesn't depend on them, and the migrator
-- applies unapplied files by name, so 0014 can ship first.

create table if not exists company_settings (
  company_id text primary key references companies (id) on delete cascade,
  lead_budget_dollars boolean not null default false,
  labor_doc_send boolean not null default false,
  updated_by text,
  updated_at timestamptz not null default now()
);

create table if not exists project_settings (
  project_id text primary key references projects (id) on delete cascade,
  company_id text not null references companies (id) on delete cascade,
  lead_budget_dollars boolean,          -- null = inherit company
  labor_doc_send boolean,               -- null = inherit company
  sharing_review_status text not null default 'needed' check (sharing_review_status in ('needed', 'reviewed')),
  review_requested_at timestamptz not null default now(),
  review_requested_by text,
  reviewed_by text,
  reviewed_at timestamptz,
  updated_by text,
  updated_at timestamptz not null default now()
);
create index if not exists project_settings_review_idx on project_settings (company_id, sharing_review_status);

create table if not exists sharing_audit (
  id text primary key,
  company_id text not null references companies (id) on delete cascade,
  project_id text references projects (id) on delete set null,   -- null = company default
  setting_key text not null,            -- 'lead_budget_dollars' | 'labor_doc_send' | 'review'
  old_value text,
  new_value text,                       -- 'true' | 'false' | 'inherit' | 'needed' | 'reviewed'
  snapshot jsonb,                       -- review rows: effective settings (value + source) at review time
  changed_by text not null,
  changed_role text not null,
  note text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists sharing_audit_company_idx on sharing_audit (company_id, created_at desc);

-- Backfill (confirmed by Charlie, Oct 19): EVERY existing project, archived included, is flagged
-- 'needed' and runs on company defaults until an Owner/Admin/superadmin marks THAT job reviewed.
-- There is no bulk clear.
insert into project_settings (project_id, company_id, sharing_review_status, review_requested_by)
select id, company_id, 'needed', 'migration:0014' from projects
on conflict (project_id) do update set sharing_review_status = 'needed';
