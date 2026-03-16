alter table analysis_findings
  add column if not exists finding_origin text
    check (finding_origin in ('rule','ai'));

alter table analysis_findings
  add column if not exists rule_basis text;
