import type { RiskItem, Jurisdiction } from '@/lib/ai';
import type { ContractSection } from '@/lib/contract-structure';

export function generateRuleBasedFindings(
  sections: ContractSection[],
  jurisdiction: Jurisdiction
): RiskItem[] {
  if (jurisdiction !== 'AU') {
    return [];
  }

  const findings: RiskItem[] = [];
  let index = 1;

  const pushFinding = (
    section: ContractSection,
    level: RiskItem['level'],
    title: string,
    impact: string,
    detail: string,
    recommendation: string
  ) => {
    findings.push({
      id: `AU${String(index++).padStart(2, '0')}`,
      level,
      title,
      clause: section.clauseNumber ? `Clause ${section.clauseNumber}` : section.heading ?? section.sectionLabel,
      impact,
      detail,
      recommendation,
      source_pages: section.pageStart ? buildPageRange(section.pageStart, section.pageEnd) : null,
      source_excerpt: section.content.slice(0, 280),
    });
  };

  for (const section of sections) {
    const text = section.content.toLowerCase();

    if (/(pay if paid|pay when paid|paid by the principal|condition precedent to payment)/i.test(text)) {
      pushFinding(
        section,
        'HIGH',
        'Conditional payment risk',
        'Payment may be delayed or withheld until the head contractor is paid upstream.',
        'The section appears to tie subcontractor payment to upstream payment or a condition precedent. In Australia this creates a serious cashflow and Security of Payment risk for subcontractors.',
        'Negotiate unconditional payment timing tied to your valid claim, not principal payment. Remove pay-if-paid or pay-when-paid language and preserve Security of Payment rights.'
      );
    }

    if (/indemnif(y|ies|ied).{0,80}(any|all).{0,80}(loss|damage|claim|liability)/i.test(section.content)) {
      pushFinding(
        section,
        'HIGH',
        'Broad indemnity exposure',
        'The indemnity may shift a very wide range of losses onto your business.',
        'This wording appears broad enough to capture losses beyond your direct fault, which can create uninsured or commercially disproportionate liability.',
        'Limit the indemnity to losses caused by your breach, negligence, or wilful misconduct and exclude indirect, consequential, and principal-caused loss.'
      );
    }

    const noticeDaysMatch = section.content.match(/within\s+(\d+)\s+(business\s+)?days?/i);
    if (noticeDaysMatch) {
      const days = Number(noticeDaysMatch[1]);
      if (Number.isFinite(days) && days > 0 && days <= 5 && /(notice|claim|variation|delay|extension of time|eot)/i.test(text)) {
        pushFinding(
          section,
          'HIGH',
          'Short notice time bar',
          'A very short notice period may cause claims or EOT entitlements to be lost.',
          `This section appears to require notice within ${days} day(s) for a claim-related event. Short contractual time bars are a common Australian subcontract risk because they can defeat otherwise valid entitlements.`,
          'Negotiate a longer notice window, require actual prejudice before rights are lost, and avoid automatic barring language for late notice.'
        );
      }
    }

    const retentionMatch = section.content.match(/retention.{0,80}?(\d+(?:\.\d+)?)\s*%/i);
    if (retentionMatch) {
      const percent = Number(retentionMatch[1]);
      if (Number.isFinite(percent) && percent >= 5) {
        pushFinding(
          section,
          'MEDIUM',
          'High retention percentage',
          'Retention at this level may create avoidable cashflow pressure and delayed recovery.',
          `The section appears to set retention at about ${percent}%, which is commercially heavy for a subcontract package unless balanced by clear release timing and a reasonable cap.`,
          'Negotiate a lower retention cap, staged releases at practical completion, and a clear long-stop date for final release.'
        );
      }
    }

    if (/(set off|set-off|deduct from any amount|backcharge)/i.test(text)) {
      pushFinding(
        section,
        'MEDIUM',
        'Broad set-off or backcharge rights',
        'Amounts otherwise payable to you may be reduced unilaterally.',
        'This section appears to allow deductions, set-off, or backcharges without tight controls. That can materially affect payment certainty and dispute leverage.',
        'Require documented particulars, prior notice, objective valuation support, and limits on set-off to amounts that are finally determined or genuinely due.'
      );
    }
  }

  return dedupeRuleFindings(findings);
}

export function mergeFindings(ruleFindings: RiskItem[], aiFindings: RiskItem[]): RiskItem[] {
  const merged = [...ruleFindings];
  const seen = new Set(ruleFindings.map(makeFindingKey));

  for (const finding of aiFindings) {
    const key = makeFindingKey(finding);
    if (!seen.has(key)) {
      merged.push(finding);
      seen.add(key);
    }
  }

  return merged.sort((a, b) => riskLevelOrder(a.level) - riskLevelOrder(b.level));
}

export function mergeRiskCounts(
  aiCount: { high: number; medium: number; low: number },
  mergedFindings: RiskItem[]
) {
  const deterministicCount = { high: 0, medium: 0, low: 0 };

  for (const finding of mergedFindings) {
    if (finding.id.startsWith('AU')) {
      if (finding.level === 'HIGH') deterministicCount.high += 1;
      if (finding.level === 'MEDIUM') deterministicCount.medium += 1;
      if (finding.level === 'LOW') deterministicCount.low += 1;
    }
  }

  return {
    high: Math.max(aiCount.high, deterministicCount.high),
    medium: Math.max(aiCount.medium, deterministicCount.medium),
    low: Math.max(aiCount.low, deterministicCount.low),
  };
}

function dedupeRuleFindings(findings: RiskItem[]) {
  const unique: RiskItem[] = [];
  const seen = new Set<string>();

  for (const finding of findings) {
    const key = makeFindingKey(finding);
    if (!seen.has(key)) {
      unique.push(finding);
      seen.add(key);
    }
  }

  return unique;
}

function makeFindingKey(finding: RiskItem) {
  return `${finding.level}:${finding.clause ?? ''}:${finding.title.toLowerCase()}`;
}

function buildPageRange(pageStart: number, pageEnd: number | null) {
  const end = pageEnd ?? pageStart;
  const pages: number[] = [];
  for (let page = pageStart; page <= end; page++) {
    pages.push(page);
  }
  return pages;
}

function riskLevelOrder(level: RiskItem['level']) {
  return { HIGH: 0, MEDIUM: 1, LOW: 2 }[level];
}
