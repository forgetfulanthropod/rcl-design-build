alter table outbound_messages add column if not exists status text not null default 'queued';
alter table outbound_messages add column if not exists provider_id text;
alter table outbound_messages add column if not exists error text;
alter table outbound_messages add column if not exists sent_at timestamptz;
