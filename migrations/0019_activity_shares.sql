-- Private links to one activity-log day. A row exists only after someone asks
-- for a link. The token is the secret. Revoking sets revoked_at; the row stays
-- so a leaked token cannot be reissued by accident. Payload is the day with
-- location already removed. work_sessions is untouched.

create table if not exists activity_shares (
  id text primary key,
  token text not null unique,
  company_id text not null references companies (id) on delete cascade,
  user_id text not null,
  day date not null,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);
create index if not exists activity_shares_user_day_idx on activity_shares (user_id, day);
