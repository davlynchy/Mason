alter table reports
  add column if not exists processing_phase text
    check (processing_phase in ('queued','extracting','summarising','counting','top_risk','complete','error'));

alter table reports
  add column if not exists processing_message text;

alter table reports
  add column if not exists processing_error text;

alter table reports
  add column if not exists processing_started_at timestamptz;

alter table reports
  add column if not exists processing_updated_at timestamptz;
