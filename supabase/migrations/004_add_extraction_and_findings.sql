alter table report_files
  add column if not exists content_type text;

alter table report_files
  add column if not exists file_size bigint;

alter table report_files
  add column if not exists extraction_status text
    check (extraction_status in ('pending','extracted','low_confidence','ocr_required','failed'));

alter table report_files
  add column if not exists extraction_method text;

alter table report_files
  add column if not exists extraction_confidence double precision;

alter table report_files
  add column if not exists extracted_chars integer;

alter table report_files
  add column if not exists extracted_text text;

create table if not exists analysis_findings (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references reports(id) on delete cascade,
  stage text not null check (stage in ('preview','full')),
  risk_id text not null,
  level text not null check (level in ('HIGH','MEDIUM','LOW')),
  title text not null,
  clause text,
  impact text not null,
  detail text not null,
  recommendation text not null,
  source_pages integer[],
  source_excerpt text,
  finding_origin text check (finding_origin in ('rule','ai')),
  rule_basis text,
  sort_order integer not null default 0,
  created_at timestamptz default now()
);

create index if not exists analysis_findings_report_id_idx on analysis_findings(report_id);
