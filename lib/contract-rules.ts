import type { RiskItem, Jurisdiction } from '@/lib/ai';
import type { ContractSection } from '@/lib/contract-structure';

type PushFinding = (
  section: ContractSection,
  level: RiskItem['level'],
  title: string,
  impact: string,
  detail: string,
  recommendation: string
) => void;

export function generateRuleBasedFindings(
  sections: ContractSection[],
  jurisdiction: Jurisdiction
): RiskItem[] {
  const findings: RiskItem[] = [];
  let index = 1;

  const pushFinding: PushFinding = (section, level, title, impact, detail, recommendation) => {
    findings.push({
      id: `${jurisdiction}${String(index++).padStart(2, '0')}`,
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

  if (jurisdiction === 'AU') {
    collectAuFindings(sections, pushFinding);
  }

  if (jurisdiction === 'UK') {
    collectUkFindings(sections, pushFinding);
  }

  return dedupeRuleFindings(findings);
}

function collectAuFindings(sections: ContractSection[], pushFinding: PushFinding) {
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

    if (/(variation).{0,120}(no (claim|payment)|unless.*written|written direction only|only if approved in writing)/i.test(text)) {
      pushFinding(
        section,
        'HIGH',
        'Strict variation approval gate',
        'Variation work may be performed without any enforceable entitlement to time or money.',
        'This section appears to bar variation claims unless there is prior written direction or approval. In practice, subcontractors often carry out urgent instructed work before formal paperwork catches up, which creates a major recovery risk.',
        'Require payment and time entitlement for directed or reasonably inferred variations, with a fallback valuation mechanism if prior written approval is not obtained.'
      );
    }

    if (/(extension of time|eot|delay).{0,120}(sole remedy|exclusive remedy|barred|waive|waiver of damages)/i.test(text)) {
      pushFinding(
        section,
        'HIGH',
        'Delay remedy restriction',
        'Delay costs may be unrecoverable even where time impacts are real and substantial.',
        'The section appears to narrow delay remedies to EOT only, or otherwise exclude delay damages. That can leave a subcontractor carrying prolongation and disruption cost without compensation.',
        'Negotiate express entitlement to delay costs for principal or contractor-caused delay, and resist sole-remedy wording that limits relief to time only.'
      );
    }

    if (/(terminate|termination).{0,120}(for convenience|at any time for convenience)/i.test(text)) {
      pushFinding(
        section,
        'HIGH',
        'Termination for convenience risk',
        'The contractor may be able to end the subcontract without default while limiting what you can recover.',
        'A termination for convenience right can create major commercial exposure if the compensation regime does not clearly cover demobilisation, committed costs, and margin on omitted work.',
        'Limit convenience termination rights or require full recovery of work done, demobilisation, unavoidable commitments, and a fair margin or break fee.'
      );
    }

    if (/(terminate|termination).{0,120}(default|breach).{0,120}(immediately|without notice|at its absolute discretion)/i.test(text)) {
      pushFinding(
        section,
        'HIGH',
        'Aggressive default termination right',
        'The subcontract may allow rapid termination before a fair opportunity to remedy issues.',
        'This wording appears to allow swift or discretionary termination for default. That can materially shift bargaining power and expose you to backcharges and completion cost claims.',
        'Require objective default triggers, written notice, and a reasonable cure period before termination rights arise.'
      );
    }

    if (
      /(insurance).{0,120}(contract works|professional indemnity|broadform liability|public liability)/i.test(text) &&
      /(notwithstanding|regardless of|does not limit|in addition to indemnity)/i.test(text)
    ) {
      pushFinding(
        section,
        'MEDIUM',
        'Insurance does not cap liability',
        'Insurance obligations may sit alongside uncapped contractual liability.',
        'This section suggests insurance is required but does not limit liability exposure. That means your contractual risk may exceed available cover, especially where indemnities are broad.',
        'Add wording that liability is limited to the extent of required insurance where commercially appropriate, and align indemnity and insurance scopes.'
      );
    }

    if (/(proportionate liability|apportionment).{0,120}(excluded|does not apply|contract out)/i.test(text)) {
      pushFinding(
        section,
        'MEDIUM',
        'Proportionate liability exclusion',
        'You may be exposed to a greater share of loss than your actual responsibility justifies.',
        'This section appears to contract out of proportionate liability protections or otherwise remove apportionment concepts. That can materially increase exposure where multiple parties contribute to the same loss.',
        'Resist contracting out of proportionate liability protections and preserve apportionment wherever legally available.'
      );
    }

    if (
      /(security of payment|payment claim|reference date|adjudication)/i.test(text) &&
      /(waive|waiver|not entitled|must not|barred|exclusive remedy|sole remedy)/i.test(text)
    ) {
      pushFinding(
        section,
        'HIGH',
        'Security of Payment rights restriction',
        'The subcontract may try to narrow or undermine statutory payment claim and adjudication rights.',
        'This wording appears to restrict Security of Payment style rights or make contractual processes the exclusive payment remedy. In Australia, attempts to contract around statutory payment regimes can create major enforcement and cashflow risk.',
        'Preserve all statutory payment claim and adjudication rights expressly, and remove wording that makes the contract payment process the sole or exclusive remedy.'
      );
    }

    if (
      /(payment claim|progress claim|invoice).{0,160}(only on|only after|only following|only if supported by)/i.test(text) &&
      /(statutory declaration|timesheet|delivery docket|signed variation|supporting document|condition precedent)/i.test(text)
    ) {
      pushFinding(
        section,
        'MEDIUM',
        'Over-conditioned payment claim process',
        'Payment may be delayed or rejected for procedural reasons unrelated to the value of work done.',
        'The section appears to impose a heavily conditioned claim process requiring multiple supporting documents before a payment claim is valid. That can be used tactically to reject claims on form rather than substance.',
        'Require reasonable supporting information only, preserve the validity of payment claims despite minor defects, and avoid strict condition-precedent language for claim administration.'
      );
    }

    if (
      /(liquidated damages|lds|delay damages).{0,160}(\$|\d|per day|per week|deduct)/i.test(text) &&
      !/(cap|maximum|aggregate limit|up to)/i.test(text)
    ) {
      pushFinding(
        section,
        'HIGH',
        'Liquidated damages without clear cap',
        'Delay exposure may escalate without a defined commercial ceiling.',
        'This section appears to impose liquidated damages or delay deductions but does not clearly identify an overall cap. That can leave a subcontractor exposed to open-ended delay recovery claims.',
        'Set a clear aggregate cap for liquidated damages, link exposure to subcontractor-caused critical delay only, and exclude concurrent or upstream-caused delay.'
      );
    }

    if (
      /(defects liability|defects correction|maintenance period|defects period)/i.test(text) &&
      /(sole discretion|as directed|any time|extend|extended by|until satisfied)/i.test(text)
    ) {
      pushFinding(
        section,
        'MEDIUM',
        'Open-ended defects liability period',
        'Defect rectification exposure may continue longer than commercially expected.',
        'The section appears to allow the defects period to be extended broadly or controlled unilaterally. That can delay final release and keep retention or security tied up for longer than necessary.',
        'Require a fixed defects liability period, objective extension triggers, and prompt release of retention or security once defined obligations are met.'
      );
    }

    if (
      /(practical completion|final certificate|final payment|retention release).{0,160}(sole discretion|absolute discretion|opinion of the contractor|to the satisfaction of)/i.test(text)
    ) {
      pushFinding(
        section,
        'MEDIUM',
        'Subjective completion or release milestone',
        'Cash release and completion recognition may depend on subjective contractor judgment.',
        'This wording appears to make practical completion, final certification, or retention release depend heavily on the contractor\'s discretion or satisfaction. That can delay cash release and prolong disputes.',
        'Use objective completion criteria, deeming mechanisms for certification, and clear deadlines for retention and final payment release.'
      );
    }

    if (
      /(extension of time|eot|delay notice|notice of delay).{0,160}(all particulars|full particulars|strict compliance|condition precedent|barred)/i.test(text)
    ) {
      pushFinding(
        section,
        'HIGH',
        'Strict EOT claim mechanics',
        'Time relief may be lost if notice content or timing is not perfectly complied with.',
        'The section appears to impose strict EOT notice mechanics requiring detailed particulars as a condition precedent. In practice, that can bar legitimate relief even where delay is genuine and documented.',
        'Allow preliminary notice followed by later particulars, require actual prejudice before time rights are lost, and avoid strict condition-precedent wording for EOT claims.'
      );
    }

    if (
      /(concurrent delay|concurrency|concurrently delayed)/i.test(text) &&
      /(no extension of time|not entitled|barred|no delay costs|contractor may determine)/i.test(text)
    ) {
      pushFinding(
        section,
        'HIGH',
        'Harsh concurrent delay treatment',
        'Time and cost relief may be denied where multiple causes of delay overlap.',
        'This section appears to deal with concurrent delay in a way that can strip entitlement to EOT or delay costs even where contractor or principal-caused delay materially contributes to the outcome.',
        'Seek balanced concurrent delay wording, preserve entitlement where your delay is not the sole cause, and avoid blanket bars on time or cost relief.'
      );
    }

    if (
      /(variation).{0,180}(rates in the contract|schedule of rates|reasonable rates|contractor.?s valuation|contractor may value)/i.test(text) &&
      /(final and binding|absolute discretion|sole discretion|conclusive)/i.test(text)
    ) {
      pushFinding(
        section,
        'MEDIUM',
        'Variation valuation controlled by contractor',
        'The value of changed work may be set unilaterally with limited room to challenge it.',
        'This wording appears to give the contractor broad control over variation valuation, potentially using pre-set rates or discretionary assessment as a final measure. That can undercut recovery for changed scope.',
        'Require transparent valuation principles, a right to substantiate actual cost, and a dispute path if the contractor\'s assessment is not accepted.'
      );
    }

    if (
      /(suspend|suspension).{0,160}(at any time|for any reason|without liability|without compensation)/i.test(text)
    ) {
      pushFinding(
        section,
        'HIGH',
        'Broad suspension power without compensation',
        'Work may be stopped without corresponding entitlement to time or cost recovery.',
        'The section appears to allow the contractor to suspend the works broadly while limiting compensation. That creates cashflow, programming, and resourcing risk if crews and plant remain committed.',
        'Limit suspension rights to defined events, require prompt notice, and preserve entitlement to EOT, standby, demobilisation, and remobilisation costs.'
      );
    }

    if (
      /(bank guarantee|security|performance bond|unconditional undertaking).{0,180}(call upon|recourse to|have recourse|draw down|cash security)/i.test(text) &&
      !/(court order|adjudicator|arbitrator|finally determined|agreed debt|insolvency)/i.test(text)
    ) {
      pushFinding(
        section,
        'HIGH',
        'Unrestricted security call right',
        'The contractor may be able to draw on security before liability is properly determined.',
        'This wording appears to permit recourse to bank guarantees or other security without strong preconditions. That can create immediate cash and leverage pressure even where the underlying dispute is unresolved.',
        'Require recourse only for agreed amounts, insolvency, or finally determined debt, with prior notice and time to seek urgent relief before any call is made.'
      );
    }

    if (
      /(bank guarantee|security|retention).{0,180}(replace|increase|additional security|top up)/i.test(text)
    ) {
      pushFinding(
        section,
        'MEDIUM',
        'Security top-up exposure',
        'The subcontract may require extra security beyond the original commercial deal.',
        'This section appears to let the contractor demand replacement, increased, or additional security. That can strain working capital and create renegotiation pressure mid-project.',
        'Cap security at an agreed amount, restrict top-up triggers to objective events, and require prompt reduction and release milestones.'
      );
    }

    if (
      /(insolven|bankrupt|administrator|liquidator|receivership|external administration)/i.test(text) &&
      /(immediately due|set off all amounts|terminate immediately|suspend payment|withhold payment)/i.test(text)
    ) {
      pushFinding(
        section,
        'HIGH',
        'Insolvency-triggered enforcement pressure',
        'A financial event may trigger immediate termination, withholding, and accelerated recovery rights against you.',
        'This clause appears to give the contractor very strong remedies on insolvency-related events, including immediate termination or withholding. Even early warning events may materially shift leverage before liability is settled.',
        'Narrow insolvency triggers to clear formal events, require objective thresholds, and limit withholding or recovery rights to amounts properly due.'
      );
    }

    if (
      /(assign|assignment|novate|novation).{0,180}(without consent|at any time|to any person|contractor may assign)/i.test(text)
    ) {
      pushFinding(
        section,
        'MEDIUM',
        'One-way assignment or novation power',
        'The subcontract may be transferred away from the original counterparty without reciprocal control for you.',
        'This wording appears to let the contractor assign or novate the subcontract broadly while restricting your own transfer rights. That can expose you to a new counterparty with different financial or delivery risk.',
        'Require your prior consent for novation to a materially different counterparty, and resist one-way assignment rights without reasonable qualification.'
      );
    }

    if (
      /(subcontract|sub-let|sublet|sub-subcontract|delegate).{0,180}(must not|without prior consent|absolute discretion)/i.test(text)
    ) {
      pushFinding(
        section,
        'MEDIUM',
        'Strict subletting or delegation restriction',
        'Delivery flexibility may be constrained if specialist subcontracting or delegation needs arise.',
        'The section appears to prohibit subletting or delegation without broad contractor discretion. That can create delivery and resourcing risk if practical trade packaging changes are needed during the job.',
        'Allow reasonable specialist sub-subcontracting with prior notice, objective consent criteria, and deemed consent if no timely response is given.'
      );
    }

    if (
      /(latent condition|site condition|physical condition|concealed condition|unforeseen condition)/i.test(text) &&
      /(contractor not liable|subcontractor bears risk|deemed to have inspected|no claim|at its own cost)/i.test(text)
    ) {
      pushFinding(
        section,
        'HIGH',
        'Latent condition risk pushed downstream',
        'Unexpected site conditions may become your cost and time risk even if not reasonably discoverable.',
        'This clause appears to allocate latent or unforeseen site condition risk to the subcontractor, often by deeming full inspection and barring later claims. That can be a major pricing and contingency exposure.',
        'Carve out genuinely latent conditions from subcontractor risk, preserve time and cost relief for unforeseeable conditions, and avoid deeming language that overstates pre-contract inspection capability.'
      );
    }

    if (
      /(dispute|dispute resolution|expert determination|mediation|arbitration).{0,220}(continue to perform|condition precedent|no court|exclusive procedure|must first)/i.test(text)
    ) {
      pushFinding(
        section,
        'MEDIUM',
        'Dispute escalation bottleneck',
        'The dispute pathway may delay practical relief while requiring ongoing performance.',
        'This wording appears to impose a mandatory stepped dispute process or restrict access to urgent remedies. If combined with a continue-to-work obligation, it can weaken leverage while cashflow or liability issues remain unresolved.',
        'Preserve urgent interlocutory relief rights, set short timeframes for each escalation stage, and avoid open-ended continue-to-perform obligations during serious payment disputes.'
      );
    }
  }
}

function collectUkFindings(sections: ContractSection[], pushFinding: PushFinding) {
  for (const section of sections) {
    const text = section.content.toLowerCase();

    if (/(pay when paid|pay if paid|paid by the employer|paid by the client)/i.test(text)) {
      pushFinding(
        section,
        'HIGH',
        'Pay-when-paid risk',
        'Payment may be linked to upstream payment by the employer or main contractor.',
        'This wording appears to tie payment to an upstream receipt event. In the UK, pay-when-paid style provisions are heavily restricted and can create major cashflow risk if relied on operationally.',
        'Remove upstream-payment dependency and align payment timing with a clear due date, final date for payment, and a compliant notice regime.'
      );
    }

    if (
      /(payment notice|pay less notice|withholding notice|final date for payment)/i.test(text) &&
      /(sole remedy|exclusive remedy|waive|waiver|not entitled)/i.test(text)
    ) {
      pushFinding(
        section,
        'HIGH',
        'Payment notice regime restriction',
        'The subcontract may narrow statutory payment protections or make non-compliant notices harder to challenge.',
        'This clause appears to interfere with the contractual or statutory payment notice framework. In the UK, notice compliance is central to payment risk and defective wording can materially prejudice recovery.',
        'Preserve compliant payment notice and pay less notice mechanics, and avoid wording that waives statutory rights or makes the contractual route the sole remedy.'
      );
    }

    if (/indemnif(y|ies|ied).{0,80}(any|all).{0,80}(loss|damage|claim|liability)/i.test(section.content)) {
      pushFinding(
        section,
        'HIGH',
        'Broad indemnity exposure',
        'The indemnity may transfer a very wide scope of loss onto your business.',
        'The indemnity appears broad enough to go beyond your own breach or negligence, which can create disproportionate and potentially uninsured exposure.',
        'Limit the indemnity to loss caused by your breach, negligence, or wilful default and exclude indirect or employer-caused loss.'
      );
    }

    if (
      /(extension of time|eot|delay).{0,160}(condition precedent|strict compliance|barred|all particulars|full particulars)/i.test(text)
    ) {
      pushFinding(
        section,
        'HIGH',
        'Strict delay notice regime',
        'Relief for delay may be lost if notices are not served exactly as required.',
        'This clause appears to impose strict notice and particulars requirements for time relief. Under many UK forms, poorly handled notice machinery can significantly reduce recovery prospects.',
        'Allow prompt preliminary notice followed by later particulars, avoid automatic time bars without prejudice, and keep notice mechanics administratively workable.'
      );
    }

    if (
      /(loss and expense|direct loss and expense|prolongation|delay costs).{0,180}(excluded|sole remedy|not entitled|waive|waiver)/i.test(text)
    ) {
      pushFinding(
        section,
        'HIGH',
        'Loss and expense exclusion',
        'Delay-related cost recovery may be stripped out even where extension of time is available.',
        'This wording appears to narrow or exclude loss and expense recovery, leaving time relief as the only response to delay. That can materially undercompensate subcontractors for disruption and prolongation.',
        'Preserve express loss and expense entitlement for contractor or employer-caused delay and resist sole-remedy wording limited to time only.'
      );
    }

    if (
      /(set off|set-off|deduct|contra charge|back charge|backcharge)/i.test(text)
    ) {
      pushFinding(
        section,
        'MEDIUM',
        'Broad set-off or contra-charge rights',
        'Amounts otherwise due may be reduced without a tightly controlled process.',
        'The clause appears to permit deductions or contra charges on a broad basis. That can destabilise payment certainty if notice and valuation controls are weak.',
        'Require clear notice, valuation support, and limits on deductions to sums that are properly due and evidenced.'
      );
    }

    if (
      /(termination|terminate).{0,140}(for convenience|at any time for convenience)/i.test(text)
    ) {
      pushFinding(
        section,
        'HIGH',
        'Termination for convenience risk',
        'The subcontract may be ended without default while leaving you undercompensated.',
        'A convenience termination right can create significant exposure if payment on termination does not clearly cover work done, demobilisation, commitments, and margin.',
        'Limit convenience termination rights or require a clear compensation regime covering work done, demobilisation, unavoidable commitments, and a fair commercial recovery.'
      );
    }

    if (
      /(adjudication|dispute resolution|mediation|arbitration).{0,220}(exclusive|sole remedy|condition precedent|must first|no court)/i.test(text)
    ) {
      pushFinding(
        section,
        'MEDIUM',
        'Dispute pathway may slow urgent relief',
        'Mandatory escalation steps may delay practical enforcement or payment recovery.',
        'This clause appears to impose a strict dispute ladder or restrict direct recourse while issues escalate. In the UK, preserving effective adjudication and urgent interim relief rights is important.',
        'Keep adjudication rights clear, allow urgent interim relief, and set short, objective escalation timeframes.'
      );
    }
  }
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
    if (/^[A-Z]{2}\d+/.test(finding.id)) {
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
