-- ─────────────────────────────────────────────────────────────────
-- Mason MVP — Database Schema
-- Run this in Supabase SQL Editor (Database > SQL Editor > New query)
-- ─────────────────────────────────────────────────────────────────

-- Enable UUID generation
create extension if not exists "pgcrypto";

-- ── Profiles ──────────────────────────────────────────────────────
create table if not exists profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  email        text not null,
  first_name   text not null,
  last_name    text not null,
  company_name text not null,
  country      text check (country in ('AU','UK','USA')),
  phone        text,
  website      text,
  created_at   timestamptz default now()
);

-- ── Reports ───────────────────────────────────────────────────────
create table if not exists reports (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid references auth.users(id) on delete set null,
  email             text not null,
  status            text not null default 'uploading'
                    check (status in ('uploading','processing','complete','error')),
  contract_type     text not null default 'subcontract'
                    check (contract_type in ('subcontract','head_contract')),
  jurisdiction      text not null default 'AU'
                    check (jurisdiction in ('AU','UK','USA')),
  analysis_stage    text not null default 'preview'
                    check (analysis_stage in ('preview','full')),
  file_count        integer not null default 0,
  preview_data      jsonb,
  full_data         jsonb,
  paid              boolean not null default false,
  stripe_session_id text,
  error_message     text,
  processing_phase  text
                    check (processing_phase in ('queued','extracting','summarising','counting','top_risk','complete','error')),
  processing_message text,
  processing_error  text,
  processing_started_at timestamptz,
  processing_updated_at timestamptz,
  created_at        timestamptz default now(),
  completed_at      timestamptz
);

-- ── Report files ──────────────────────────────────────────────────
create table if not exists report_files (
  id         uuid primary key default gen_random_uuid(),
  report_id  uuid not null references reports(id) on delete cascade,
  r2_key     text not null,
  filename   text not null,
  content_type text,
  file_size bigint,
  extraction_status text
            check (extraction_status in ('pending','extracted','low_confidence','ocr_required','failed')),
  extraction_method text,
  extraction_confidence double precision,
  extracted_chars integer,
  extracted_text text,
  created_at timestamptz default now()
);

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

-- ── Row Level Security ────────────────────────────────────────────

-- Profiles: users can read/update their own
alter table profiles enable row level security;
create policy "users read own profile"
  on profiles for select
  using (auth.uid() = id);
create policy "users update own profile"
  on profiles for update
  using (auth.uid() = id);

-- Reports: users can read their own reports + public can read by ID
alter table reports enable row level security;

-- Own reports
create policy "users read own reports"
  on reports for select
  using (auth.uid() = user_id);

-- Anyone with the report ID can view it (share-by-link pattern)
-- This allows unauthenticated access to the report page
create policy "public read reports by id"
  on reports for select
  using (true);  -- Restrict in production via app logic (only return non-sensitive data if unpaid)

-- Service role can do everything (bypasses RLS)
-- API routes use service role key — no additional policies needed

-- Report files: same as reports
alter table report_files enable row level security;
create policy "public read report files"
  on report_files for select
  using (true);

-- ── Indexes ───────────────────────────────────────────────────────
create index if not exists reports_user_id_idx on reports(user_id);
create index if not exists reports_email_idx   on reports(email);
create index if not exists reports_status_idx  on reports(status);
create index if not exists report_files_report_id_idx on report_files(report_id);
create index if not exists analysis_findings_report_id_idx on analysis_findings(report_id);
create index if not exists contract_sections_report_id_idx on contract_sections(report_id);
create index if not exists contract_sections_report_file_id_idx on contract_sections(report_file_id);
