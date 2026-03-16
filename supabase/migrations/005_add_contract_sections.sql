create table if not exists contract_sections (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references reports(id) on delete cascade,
  report_file_id uuid references report_files(id) on delete cascade,
  filename text not null,
  section_type text not null check (section_type in ('document_intro','clause','schedule','annexure','page_block')),
  section_label text,
  clause_number text,
  heading text,
  page_start integer,
  page_end integer,
  content text not null,
  sort_order integer not null default 0,
  created_at timestamptz default now()
);

create index if not exists contract_sections_report_id_idx on contract_sections(report_id);
create index if not exists contract_sections_report_file_id_idx on contract_sections(report_file_id);
