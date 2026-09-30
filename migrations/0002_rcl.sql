-- RCL Design-Build: company desk, field service, comms, and foreman code review.

create table if not exists companies (
  id text primary key,
  name text not null,
  created_at timestamptz not null default now()
);

create table if not exists profiles (
  user_id text primary key,
  company_id text not null references companies (id) on delete cascade,
  name text not null,
  email text,
  phone text,
  role text not null,
  created_at timestamptz not null default now()
);
create index if not exists profiles_company_idx on profiles (company_id);

create table if not exists source_files (
  company_id text not null references companies (id) on delete cascade,
  path text not null,
  content text not null,
  updated_at timestamptz not null default now(),
  primary key (company_id, path)
);

create table if not exists projects (
  id text primary key,
  company_id text not null references companies (id) on delete cascade,
  name text not null,
  client_name text not null,
  address text not null,
  phase text not null,
  contract_value integer not null default 0,
  summary text not null default '',
  archived boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists projects_company_idx on projects (company_id);

create table if not exists milestones (
  id text primary key,
  company_id text not null references companies (id) on delete cascade,
  project_id text not null references projects (id) on delete cascade,
  name text not null,
  due_on date,
  done boolean not null default false
);
create index if not exists milestones_project_idx on milestones (project_id);

create table if not exists sheets (
  id text primary key,
  company_id text not null references companies (id) on delete cascade,
  project_id text not null references projects (id) on delete cascade,
  number text not null,
  title text not null,
  revision text not null,
  discipline text not null
);
create index if not exists sheets_project_idx on sheets (project_id);

create table if not exists rfis (
  id text primary key,
  company_id text not null references companies (id) on delete cascade,
  project_id text not null references projects (id) on delete cascade,
  number integer not null,
  title text not null,
  question text not null,
  status text not null,
  created_by text not null,
  created_at timestamptz not null default now()
);
create index if not exists rfis_company_idx on rfis (company_id);

create table if not exists change_orders (
  id text primary key,
  company_id text not null references companies (id) on delete cascade,
  project_id text not null references projects (id) on delete cascade,
  number integer not null,
  title text not null,
  amount integer not null,
  status text not null,
  created_by text not null,
  created_at timestamptz not null default now()
);
create index if not exists change_orders_company_idx on change_orders (company_id);

create table if not exists daily_logs (
  id text primary key,
  company_id text not null references companies (id) on delete cascade,
  project_id text not null references projects (id) on delete cascade,
  log_date date not null,
  crew integer not null default 0,
  weather text not null default '',
  notes text not null,
  created_by text not null,
  created_at timestamptz not null default now()
);
create index if not exists daily_logs_company_idx on daily_logs (company_id);

create table if not exists work_orders (
  id text primary key,
  company_id text not null references companies (id) on delete cascade,
  project_id text references projects (id) on delete set null,
  customer text not null,
  site text not null,
  title text not null,
  trade text not null,
  priority text not null,
  status text not null,
  assigned_user_id text,
  notes text not null default '',
  created_by text not null,
  created_at timestamptz not null default now()
);
create index if not exists work_orders_company_idx on work_orders (company_id);

create table if not exists foreman_messages (
  id text primary key,
  company_id text not null references companies (id) on delete cascade,
  user_id text not null,
  role text not null,
  body text not null,
  proposal_id text,
  created_at timestamptz not null default now()
);
create index if not exists foreman_messages_user_idx on foreman_messages (company_id, user_id);

create table if not exists code_proposals (
  id text primary key,
  company_id text not null references companies (id) on delete cascade,
  author_user_id text not null,
  title text not null,
  summary text not null,
  file_path text not null,
  base_content text not null,
  proposed_content text not null,
  status text not null,
  staging_token text not null unique,
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by text
);
create index if not exists code_proposals_company_idx on code_proposals (company_id);

create table if not exists outbound_messages (
  id text primary key,
  company_id text not null references companies (id) on delete cascade,
  sender_user_id text,
  recipient_user_id text,
  channel text not null,
  to_address text not null,
  subject text not null,
  body text not null,
  link_path text,
  kind text not null,
  created_at timestamptz not null default now()
);
create index if not exists outbound_company_idx on outbound_messages (company_id);

create table if not exists magic_links (
  id text primary key,
  token_hash text not null unique,
  channel text not null,
  destination text not null,
  email text not null,
  display_name text,
  company_id text,
  role text,
  action text,
  proposal_id text,
  redirect_path text,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists magic_links_destination_idx on magic_links (destination, created_at);
