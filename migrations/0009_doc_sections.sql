alter table project_documents drop constraint if exists project_documents_kind_check;
alter table project_documents add constraint project_documents_kind_check
  check (kind in ('policy', 'bid', 'invoice', 'rfi', 'submittal', 'change_order'));
