-- Document pipeline: bids, RFIs, submittals, and change orders, with a mail thread.
create table if not exists project_documents (
  id text primary key,
  company_id text not null references companies (id) on delete cascade,
  project_id text references projects (id) on delete set null,
  kind text not null check (kind in ('bid', 'rfi', 'submittal', 'change_order')),
  number integer not null,
  title text not null,
  body text not null default '',
  amount integer,
  status text not null,
  counterparty text not null default '',
  counterparty_email text not null default '',
  created_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists project_documents_company_idx on project_documents (company_id, kind, updated_at desc);

create table if not exists document_messages (
  id text primary key,
  document_id text not null references project_documents (id) on delete cascade,
  company_id text not null references companies (id) on delete cascade,
  direction text not null check (direction in ('out', 'in')),
  channel text not null check (channel in ('resend', 'gmail')),
  to_email text not null default '',
  from_email text not null default '',
  subject text not null,
  body text not null,
  provider_id text,
  status text not null,
  error text,
  created_by text,
  created_at timestamptz not null default now()
);
create index if not exists document_messages_doc_idx on document_messages (document_id, created_at);
