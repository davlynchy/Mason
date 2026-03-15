alter table profiles
  add column if not exists country text check (country in ('AU','UK','USA'));

alter table reports
  add column if not exists jurisdiction text not null default 'AU'
    check (jurisdiction in ('AU','UK','USA'));

alter table reports
  add column if not exists analysis_stage text not null default 'preview'
    check (analysis_stage in ('preview','full'));
