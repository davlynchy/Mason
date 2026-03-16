import type { RiskItem, Jurisdiction } from '@/lib/ai';
import type { ContractSection } from '@/lib/contract-structure';

type SectionType = ContractSection['sectionType'];

interface RuleDefinition {
  title: string;
  level: RiskItem['level'];
  impact: string;
  detail: string;
  recommendation: string;
  match: RegExp | RegExp[];
  allOf?: RegExp[];
  noneOf?: RegExp[];
  sectionTypes?: SectionType[];
  headingKeywords?: string[];
  contextKeywords?: Array<'payment' | 'termination' | 'delay' | 'variation' | 'security' | 'dispute' | 'insurance' | 'site'>;
  minScore?: number;
}

interface RuleContext {
  heading: string;
  label: string;
  payment: boolean;
  termination: boolean;
  delay: boolean;
  variation: boolean;
  security: boolean;
  dispute: boolean;
  insurance: boolean;
  site: boolean;
}

export function generateRuleBasedFindings(
  sections: ContractSection[],
  jurisdiction: Jurisdiction
): RiskItem[] {
  const rules = getRules(jurisdiction);
  if (!rules.length) return [];

  const findings: RiskItem[] = [];
  let index = 1;

  for (const section of sections) {
    const context = buildContext(section);

    for (const rule of rules) {
      if (!matchesRule(section, context, rule)) continue;

      findings.push({
        id: `${jurisdiction}${String(index++).padStart(2, '0')}`,
        level: rule.level,
        title: rule.title,
        clause: section.clauseNumber ? `Clause ${section.clauseNumber}` : section.heading ?? section.sectionLabel,
        impact: rule.impact,
        detail: rule.detail,
        recommendation: rule.recommendation,
        source_pages: section.pageStart ? buildPageRange(section.pageStart, section.pageEnd) : null,
        source_excerpt: section.content.slice(0, 280),
      });
    }
  }

  return dedupeRuleFindings(findings);
}

function getRules(jurisdiction: Jurisdiction): RuleDefinition[] {
  if (jurisdiction === 'AU') return AU_RULES;
  if (jurisdiction === 'UK') return UK_RULES;
  if (jurisdiction === 'USA') return US_RULES;
  return [];
}

const AU_RULES: RuleDefinition[] = [
  makeRule('Conditional payment risk', 'HIGH',
    'Payment may be delayed or withheld until the head contractor is paid upstream.',
    'The section appears to tie subcontractor payment to upstream payment or a condition precedent. In Australia this creates a serious cashflow and Security of Payment risk for subcontractors.',
    'Negotiate unconditional payment timing tied to your valid claim, not principal payment. Remove pay-if-paid or pay-when-paid language and preserve Security of Payment rights.',
    /(pay if paid|pay when paid|paid by the principal|condition precedent to payment)/i,
    { sectionTypes: ['clause', 'schedule'], headingKeywords: ['payment', 'claim'], contextKeywords: ['payment'], minScore: 2 }),
  makeRule('Broad indemnity exposure', 'HIGH',
    'The indemnity may shift a very wide range of losses onto your business.',
    'This wording appears broad enough to capture losses beyond your direct fault, which can create uninsured or commercially disproportionate liability.',
    'Limit the indemnity to losses caused by your breach, negligence, or wilful misconduct and exclude indirect, consequential, and principal-caused loss.',
    /indemnif(y|ies|ied).{0,80}(any|all).{0,80}(loss|damage|claim|liability)/i,
    { headingKeywords: ['indemn', 'liability'], contextKeywords: ['insurance'], minScore: 1 }),
  makeRule('Short notice time bar', 'HIGH',
    'A very short notice period may cause claims or EOT entitlements to be lost.',
    'This section appears to require very short notice for a claim-related event. Short contractual time bars are a common Australian subcontract risk because they can defeat otherwise valid entitlements.',
    'Negotiate a longer notice window, require actual prejudice before rights are lost, and avoid automatic barring language for late notice.',
    /within\s+([1-5])\s+(business\s+)?days?/i,
    { allOf: [/(notice|claim|variation|delay|extension of time|eot)/i], headingKeywords: ['notice', 'delay'], contextKeywords: ['delay', 'variation'], minScore: 2 }),
  makeRule('High retention percentage', 'MEDIUM',
    'Retention at this level may create avoidable cashflow pressure and delayed recovery.',
    'The section appears to set retention at a commercially heavy level unless balanced by clear release timing and a reasonable cap.',
    'Negotiate a lower retention cap, staged releases at practical completion, and a clear long-stop date for final release.',
    /retention.{0,80}?((?:5|[6-9]|\d{2,})(?:\.\d+)?)\s*%/i,
    { headingKeywords: ['retention', 'security'], contextKeywords: ['payment', 'security'], minScore: 2 }),
  makeRule('Broad set-off or backcharge rights', 'MEDIUM',
    'Amounts otherwise payable to you may be reduced unilaterally.',
    'This section appears to allow deductions, set-off, or backcharges without tight controls. That can materially affect payment certainty and dispute leverage.',
    'Require documented particulars, prior notice, objective valuation support, and limits on set-off to amounts that are finally determined or genuinely due.',
    /(set off|set-off|deduct from any amount|backcharge)/i,
    { headingKeywords: ['payment', 'deduction'], contextKeywords: ['payment'], minScore: 1 }),
  makeRule('Strict variation approval gate', 'HIGH',
    'Variation work may be performed without any enforceable entitlement to time or money.',
    'This section appears to bar variation claims unless there is prior written direction or approval.',
    'Require payment and time entitlement for directed or reasonably inferred variations, with a fallback valuation mechanism if prior written approval is not obtained.',
    /(variation).{0,120}(no (claim|payment)|unless.*written|written direction only|only if approved in writing)/i,
    { headingKeywords: ['variation'], contextKeywords: ['variation'], minScore: 2 }),
  makeRule('Delay remedy restriction', 'HIGH',
    'Delay costs may be unrecoverable even where time impacts are real and substantial.',
    'The section appears to narrow delay remedies to EOT only, or otherwise exclude delay damages.',
    'Negotiate express entitlement to delay costs for principal or contractor-caused delay, and resist sole-remedy wording that limits relief to time only.',
    /(extension of time|eot|delay).{0,120}(sole remedy|exclusive remedy|barred|waive|waiver of damages)/i,
    { headingKeywords: ['delay', 'extension of time'], contextKeywords: ['delay'], minScore: 2 }),
  makeRule('Termination for convenience risk', 'HIGH',
    'The contractor may be able to end the subcontract without default while limiting what you can recover.',
    'A termination for convenience right can create major commercial exposure if the compensation regime does not clearly cover demobilisation, committed costs, and margin on omitted work.',
    'Limit convenience termination rights or require full recovery of work done, demobilisation, unavoidable commitments, and a fair margin or break fee.',
    /(terminate|termination).{0,120}(for convenience|at any time for convenience)/i,
    { headingKeywords: ['termination'], contextKeywords: ['termination'], minScore: 2 }),
  makeRule('Security of Payment rights restriction', 'HIGH',
    'The subcontract may try to narrow or undermine statutory payment claim and adjudication rights.',
    'This wording appears to restrict Security of Payment style rights or make contractual processes the exclusive payment remedy.',
    'Preserve all statutory payment claim and adjudication rights expressly, and remove wording that makes the contract payment process the sole or exclusive remedy.',
    /(security of payment|payment claim|reference date|adjudication)/i,
    { allOf: [/(waive|waiver|not entitled|must not|barred|exclusive remedy|sole remedy)/i], headingKeywords: ['payment', 'adjudication'], contextKeywords: ['payment', 'dispute'], minScore: 2 }),
  makeRule('Liquidated damages without clear cap', 'HIGH',
    'Delay exposure may escalate without a defined commercial ceiling.',
    'This section appears to impose liquidated damages or delay deductions but does not clearly identify an overall cap.',
    'Set a clear aggregate cap for liquidated damages, link exposure to subcontractor-caused critical delay only, and exclude concurrent or upstream-caused delay.',
    /(liquidated damages|lds|delay damages).{0,160}(\$|\d|per day|per week|deduct)/i,
    { noneOf: [/(cap|maximum|aggregate limit|up to)/i], headingKeywords: ['liquidated damages', 'delay'], contextKeywords: ['delay'], minScore: 2 }),
  makeRule('Strict EOT claim mechanics', 'HIGH',
    'Time relief may be lost if notice content or timing is not perfectly complied with.',
    'The section appears to impose strict EOT notice mechanics requiring detailed particulars as a condition precedent.',
    'Allow preliminary notice followed by later particulars, require actual prejudice before time rights are lost, and avoid strict condition-precedent wording for EOT claims.',
    /(extension of time|eot|delay notice|notice of delay).{0,160}(all particulars|full particulars|strict compliance|condition precedent|barred)/i,
    { headingKeywords: ['extension of time', 'delay', 'notice'], contextKeywords: ['delay'], minScore: 2 }),
  makeRule('Harsh concurrent delay treatment', 'HIGH',
    'Time and cost relief may be denied where multiple causes of delay overlap.',
    'This section appears to deal with concurrent delay in a way that can strip entitlement to EOT or delay costs even where contractor or principal-caused delay materially contributes to the outcome.',
    'Seek balanced concurrent delay wording, preserve entitlement where your delay is not the sole cause, and avoid blanket bars on time or cost relief.',
    /(concurrent delay|concurrency|concurrently delayed)/i,
    { allOf: [/(no extension of time|not entitled|barred|no delay costs|contractor may determine)/i], headingKeywords: ['delay'], contextKeywords: ['delay'], minScore: 2 }),
  makeRule('Variation valuation controlled by contractor', 'MEDIUM',
    'The value of changed work may be set unilaterally with limited room to challenge it.',
    'This wording appears to give the contractor broad control over variation valuation.',
    'Require transparent valuation principles, a right to substantiate actual cost, and a dispute path if the contractor assessment is not accepted.',
    /(variation).{0,180}(rates in the contract|schedule of rates|reasonable rates|contractor.?s valuation|contractor may value)/i,
    { allOf: [/(final and binding|absolute discretion|sole discretion|conclusive)/i], headingKeywords: ['variation', 'valuation'], contextKeywords: ['variation'], minScore: 2 }),
  makeRule('Broad suspension power without compensation', 'HIGH',
    'Work may be stopped without corresponding entitlement to time or cost recovery.',
    'The section appears to allow the contractor to suspend the works broadly while limiting compensation.',
    'Limit suspension rights to defined events, require prompt notice, and preserve entitlement to EOT, standby, demobilisation, and remobilisation costs.',
    /(suspend|suspension).{0,160}(at any time|for any reason|without liability|without compensation)/i,
    { headingKeywords: ['suspension'], contextKeywords: ['termination', 'delay'], minScore: 1 }),
  makeRule('Unrestricted security call right', 'HIGH',
    'The contractor may be able to draw on security before liability is properly determined.',
    'This wording appears to permit recourse to bank guarantees or other security without strong preconditions.',
    'Require recourse only for agreed amounts, insolvency, or finally determined debt, with prior notice and time to seek urgent relief before any call is made.',
    /(bank guarantee|security|performance bond|unconditional undertaking).{0,180}(call upon|recourse to|have recourse|draw down|cash security)/i,
    { noneOf: [/(court order|adjudicator|arbitrator|finally determined|agreed debt|insolvency)/i], headingKeywords: ['security', 'guarantee', 'bond'], contextKeywords: ['security', 'dispute'], minScore: 2 }),
  makeRule('Insolvency-triggered enforcement pressure', 'HIGH',
    'A financial event may trigger immediate termination, withholding, and accelerated recovery rights against you.',
    'This clause appears to give the contractor very strong remedies on insolvency-related events, including immediate termination or withholding.',
    'Narrow insolvency triggers to clear formal events, require objective thresholds, and limit withholding or recovery rights to amounts properly due.',
    /(insolven|bankrupt|administrator|liquidator|receivership|external administration)/i,
    { allOf: [/(immediately due|set off all amounts|terminate immediately|suspend payment|withhold payment)/i], headingKeywords: ['insolvency', 'default', 'termination'], contextKeywords: ['termination', 'payment'], minScore: 2 }),
  makeRule('One-way assignment or novation power', 'MEDIUM',
    'The subcontract may be transferred away from the original counterparty without reciprocal control for you.',
    'This wording appears to let the contractor assign or novate the subcontract broadly while restricting your own transfer rights.',
    'Require your prior consent for novation to a materially different counterparty, and resist one-way assignment rights without reasonable qualification.',
    /(assign|assignment|novate|novation).{0,180}(without consent|at any time|to any person|contractor may assign)/i,
    { headingKeywords: ['assignment', 'novation'], minScore: 1 }),
  makeRule('Strict subletting or delegation restriction', 'MEDIUM',
    'Delivery flexibility may be constrained if specialist subcontracting or delegation needs arise.',
    'The section appears to prohibit subletting or delegation without broad contractor discretion.',
    'Allow reasonable specialist sub-subcontracting with prior notice, objective consent criteria, and deemed consent if no timely response is given.',
    /(subcontract|sub-let|sublet|sub-subcontract|delegate).{0,180}(must not|without prior consent|absolute discretion)/i,
    { headingKeywords: ['subcontracting', 'assignment'], minScore: 1 }),
  makeRule('Latent condition risk pushed downstream', 'HIGH',
    'Unexpected site conditions may become your cost and time risk even if not reasonably discoverable.',
    'This clause appears to allocate latent or unforeseen site condition risk to the subcontractor, often by deeming full inspection and barring later claims.',
    'Carve out genuinely latent conditions from subcontractor risk, preserve time and cost relief for unforeseeable conditions, and avoid deeming language that overstates pre-contract inspection capability.',
    /(latent condition|site condition|physical condition|concealed condition|unforeseen condition)/i,
    { allOf: [/(contractor not liable|subcontractor bears risk|deemed to have inspected|no claim|at its own cost)/i], headingKeywords: ['site conditions', 'latent conditions'], contextKeywords: ['site'], minScore: 2 }),
  makeRule('Dispute escalation bottleneck', 'MEDIUM',
    'The dispute pathway may delay practical relief while requiring ongoing performance.',
    'This wording appears to impose a mandatory stepped dispute process or restrict access to urgent remedies.',
    'Preserve urgent interlocutory relief rights, set short timeframes for each escalation stage, and avoid open-ended continue-to-perform obligations during serious payment disputes.',
    /(dispute|dispute resolution|expert determination|mediation|arbitration).{0,220}(continue to perform|condition precedent|no court|exclusive procedure|must first)/i,
    { headingKeywords: ['dispute', 'resolution'], contextKeywords: ['dispute'], minScore: 2 }),
];

const UK_RULES: RuleDefinition[] = [
  makeRule('Pay-when-paid risk', 'HIGH',
    'Payment may be linked to upstream payment by the employer or main contractor.',
    'This wording appears to tie payment to an upstream receipt event. In the UK, pay-when-paid style provisions are heavily restricted and can create major cashflow risk if relied on operationally.',
    'Remove upstream-payment dependency and align payment timing with a clear due date, final date for payment, and a compliant notice regime.',
    /(pay when paid|pay if paid|paid by the employer|paid by the client)/i,
    { headingKeywords: ['payment', 'due date'], contextKeywords: ['payment'], minScore: 2 }),
  makeRule('Payment notice regime restriction', 'HIGH',
    'The subcontract may narrow statutory payment protections or make non-compliant notices harder to challenge.',
    'This clause appears to interfere with the contractual or statutory payment notice framework.',
    'Preserve compliant payment notice and pay less notice mechanics, and avoid wording that waives statutory rights or makes the contractual route the sole remedy.',
    /(payment notice|pay less notice|withholding notice|final date for payment)/i,
    { allOf: [/(sole remedy|exclusive remedy|waive|waiver|not entitled)/i], headingKeywords: ['payment', 'notice'], contextKeywords: ['payment'], minScore: 2 }),
  makeRule('Broad indemnity exposure', 'HIGH',
    'The indemnity may transfer a very wide scope of loss onto your business.',
    'The indemnity appears broad enough to go beyond your own breach or negligence, which can create disproportionate and potentially uninsured exposure.',
    'Limit the indemnity to loss caused by your breach, negligence, or wilful default and exclude indirect or employer-caused loss.',
    /indemnif(y|ies|ied).{0,80}(any|all).{0,80}(loss|damage|claim|liability)/i,
    { headingKeywords: ['indemn', 'liability'], contextKeywords: ['insurance'], minScore: 1 }),
  makeRule('Strict delay notice regime', 'HIGH',
    'Relief for delay may be lost if notices are not served exactly as required.',
    'This clause appears to impose strict notice and particulars requirements for time relief.',
    'Allow prompt preliminary notice followed by later particulars, avoid automatic time bars without prejudice, and keep notice mechanics administratively workable.',
    /(extension of time|eot|delay).{0,160}(condition precedent|strict compliance|barred|all particulars|full particulars)/i,
    { headingKeywords: ['delay', 'extension of time'], contextKeywords: ['delay'], minScore: 2 }),
  makeRule('Loss and expense exclusion', 'HIGH',
    'Delay-related cost recovery may be stripped out even where extension of time is available.',
    'This wording appears to narrow or exclude loss and expense recovery, leaving time relief as the only response to delay.',
    'Preserve express loss and expense entitlement for contractor or employer-caused delay and resist sole-remedy wording limited to time only.',
    /(loss and expense|direct loss and expense|prolongation|delay costs).{0,180}(excluded|sole remedy|not entitled|waive|waiver)/i,
    { headingKeywords: ['loss and expense', 'delay'], contextKeywords: ['delay'], minScore: 2 }),
  makeRule('Broad set-off or contra-charge rights', 'MEDIUM',
    'Amounts otherwise due may be reduced without a tightly controlled process.',
    'The clause appears to permit deductions or contra charges on a broad basis.',
    'Require clear notice, valuation support, and limits on deductions to sums that are properly due and evidenced.',
    /(set off|set-off|deduct|contra charge|back charge|backcharge)/i,
    { headingKeywords: ['payment', 'deduction'], contextKeywords: ['payment'], minScore: 1 }),
  makeRule('Termination for convenience risk', 'HIGH',
    'The subcontract may be ended without default while leaving you undercompensated.',
    'A convenience termination right can create significant exposure if payment on termination does not clearly cover work done, demobilisation, commitments, and margin.',
    'Limit convenience termination rights or require a clear compensation regime covering work done, demobilisation, unavoidable commitments, and a fair commercial recovery.',
    /(termination|terminate).{0,140}(for convenience|at any time for convenience)/i,
    { headingKeywords: ['termination'], contextKeywords: ['termination'], minScore: 2 }),
  makeRule('Dispute pathway may slow urgent relief', 'MEDIUM',
    'Mandatory escalation steps may delay practical enforcement or payment recovery.',
    'This clause appears to impose a strict dispute ladder or restrict direct recourse while issues escalate.',
    'Keep adjudication rights clear, allow urgent interim relief, and set short, objective escalation timeframes.',
    /(adjudication|dispute resolution|mediation|arbitration).{0,220}(exclusive|sole remedy|condition precedent|must first|no court)/i,
    { headingKeywords: ['dispute', 'adjudication'], contextKeywords: ['dispute'], minScore: 2 }),
];

const US_RULES: RuleDefinition[] = [
  makeRule('Pay-if-paid payment risk', 'HIGH',
    'Payment may be conditioned on owner or upstream payment before you are paid.',
    'This clause appears to make payment contingent on upstream receipt or approval. In the United States, enforceability varies by state, but the commercial cashflow risk is often severe for subcontractors.',
    'Negotiate pay-when-paid timing language instead of true pay-if-paid conditions, preserve prompt payment rights, and remove clauses that make owner payment a strict condition precedent.',
    /(pay if paid|condition precedent to payment|only if contractor is paid|only if owner pays|paid by owner)/i,
    { headingKeywords: ['payment', 'progress payment'], contextKeywords: ['payment'], minScore: 2 }),
  makeRule('No-damages-for-delay risk', 'HIGH',
    'You may receive time only, with no compensation for prolonged or disrupted work.',
    'This wording appears to bar or heavily limit recovery of delay costs, even where delay is caused by others.',
    'Preserve delay cost entitlement for owner-, contractor-, or design-caused delay and resist no-damages-for-delay language except in very narrow circumstances.',
    /(no damages for delay|sole remedy.{0,40}extension of time|extension of time.{0,40}sole remedy)/i,
    { headingKeywords: ['delay', 'claims'], contextKeywords: ['delay'], minScore: 2 }),
  makeRule('Broad indemnity exposure', 'HIGH',
    'The indemnity may shift losses beyond your own fault or insurable scope.',
    'The clause appears broad enough to capture losses outside your direct negligence or breach, which can create disproportionate and potentially uninsured exposure depending on state anti-indemnity rules.',
    'Limit indemnity to loss caused by your negligence, breach, or willful misconduct and align the indemnity with applicable anti-indemnity law and insurance coverage.',
    /indemnif(y|ies|ied).{0,80}(any|all).{0,80}(loss|damage|claim|liability)/i,
    { headingKeywords: ['indemn', 'liability'], contextKeywords: ['insurance'], minScore: 1 }),
  makeRule('Lien or bond rights waiver', 'HIGH',
    'You may be giving up key security rights that support payment recovery.',
    'This clause appears to waive mechanic lien, bond claim, or similar payment security rights in advance.',
    'Avoid advance waiver of lien or bond rights, limit waivers to amounts actually received, and keep payment security rights available until funds clear.',
    /(waive|waiver).{0,120}(lien|bond claim|mechanic.?s lien|payment bond|stop notice)/i,
    { headingKeywords: ['lien', 'bond', 'payment security'], contextKeywords: ['payment', 'security'], minScore: 2 }),
  makeRule('Broad set-off or chargeback rights', 'MEDIUM',
    'Amounts otherwise due may be reduced through unilateral offsets or backcharges.',
    'This clause appears to allow broad offsets, chargebacks, or deductions without a tightly controlled dispute or valuation process.',
    'Require notice, supporting detail, and limits on offsets to sums that are undisputed, finally determined, or clearly evidenced.',
    /(set off|set-off|offset|backcharge|chargeback|deduct from any amount)/i,
    { headingKeywords: ['payment', 'offset'], contextKeywords: ['payment'], minScore: 1 }),
  makeRule('Termination for convenience risk', 'HIGH',
    'The subcontract may be ended without default while limiting your recovery on termination.',
    'A termination for convenience right can significantly shift commercial risk if the compensation regime excludes overhead, profit, committed materials, or demobilisation cost.',
    'Require a clear termination compensation regime covering work performed, stored materials, demobilisation, unavoidable commitments, and a fair margin where appropriate.',
    /(terminate|termination).{0,120}(for convenience|at any time for convenience|without cause)/i,
    { headingKeywords: ['termination'], contextKeywords: ['termination'], minScore: 2 }),
  makeRule('Unrestricted recourse to security or retainage', 'MEDIUM',
    'Security or retainage may be withheld or applied before liability is properly resolved.',
    'This wording appears to allow broad recourse to retainage, bonds, or other security without strong procedural limits.',
    'Require notice, objective grounds, and limited recourse triggers tied to agreed sums, default after cure opportunity, or finally determined liability.',
    /(retainage|security|bond|letter of credit).{0,160}(recourse|draw|apply|withhold|call upon)/i,
    { headingKeywords: ['retainage', 'security', 'bond'], contextKeywords: ['payment', 'security'], minScore: 2 }),
  makeRule('Dispute process may delay practical relief', 'MEDIUM',
    'Mandatory escalation steps may slow enforcement while requiring continued performance.',
    'This clause appears to force a stepped dispute process or restrict immediate remedies.',
    'Preserve emergency relief rights, define short escalation timeframes, and avoid open-ended continue-to-perform obligations where payment or major default issues are unresolved.',
    /(dispute|mediation|arbitration|litigation).{0,220}(must first|condition precedent|exclusive remedy|continue to perform|no court)/i,
    { headingKeywords: ['dispute', 'resolution'], contextKeywords: ['dispute'], minScore: 2 }),
];

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
  const deterministic = { high: 0, medium: 0, low: 0 };
  for (const finding of mergedFindings) {
    if (/^[A-Z]{2,3}\d+/.test(finding.id)) {
      if (finding.level === 'HIGH') deterministic.high += 1;
      if (finding.level === 'MEDIUM') deterministic.medium += 1;
      if (finding.level === 'LOW') deterministic.low += 1;
    }
  }
  return {
    high: Math.max(aiCount.high, deterministic.high),
    medium: Math.max(aiCount.medium, deterministic.medium),
    low: Math.max(aiCount.low, deterministic.low),
  };
}

function makeRule(
  title: string,
  level: RiskItem['level'],
  impact: string,
  detail: string,
  recommendation: string,
  match: RegExp | RegExp[],
  options: Omit<RuleDefinition, 'title' | 'level' | 'impact' | 'detail' | 'recommendation' | 'match'>
): RuleDefinition {
  return { title, level, impact, detail, recommendation, match, ...options };
}

function matchesRule(section: ContractSection, context: RuleContext, rule: RuleDefinition) {
  const patterns = Array.isArray(rule.match) ? rule.match : [rule.match];
  if (!patterns.some(pattern => pattern.test(section.content))) return false;
  if (rule.allOf && !rule.allOf.every(pattern => pattern.test(section.content))) return false;
  if (rule.noneOf && rule.noneOf.some(pattern => pattern.test(section.content))) return false;
  return scoreRuleContext(section, context, rule) >= (rule.minScore ?? 1);
}

function scoreRuleContext(section: ContractSection, context: RuleContext, rule: RuleDefinition) {
  let score = 0;
  if (!rule.sectionTypes || rule.sectionTypes.includes(section.sectionType)) score += 1;
  if (rule.headingKeywords?.some(keyword => includesKeyword(context.heading, keyword) || includesKeyword(context.label, keyword))) score += 1;
  if (rule.contextKeywords?.some(keyword => context[keyword])) score += 1;
  return score;
}

function buildContext(section: ContractSection): RuleContext {
  const heading = `${section.heading ?? ''} ${section.sectionLabel ?? ''}`.toLowerCase();
  const lead = section.content.slice(0, 400).toLowerCase();
  const combined = `${heading} ${lead}`;
  return {
    heading,
    label: (section.sectionLabel ?? '').toLowerCase(),
    payment: /(payment|invoice|claim|progress|retention|set off|set-off|due date|pay less|pay-?when|pay-?if|lien|bond|retainage)/i.test(combined),
    termination: /(termination|terminate|default|convenience|suspension|suspend|insolvenc)/i.test(combined),
    delay: /(delay|extension of time|eot|prolongation|liquidated damages|loss and expense|concurrent)/i.test(combined),
    variation: /(variation|change order|change directive|valuation|rates)/i.test(combined),
    security: /(security|bank guarantee|bond|retainage|retention|letter of credit)/i.test(combined),
    dispute: /(dispute|adjudication|mediation|arbitration|expert determination|litigation)/i.test(combined),
    insurance: /(insurance|indemnity|liability|additional insured|proportionate liability)/i.test(combined),
    site: /(site|latent condition|physical condition|concealed|unforeseen)/i.test(combined),
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
  for (let page = pageStart; page <= end; page++) pages.push(page);
  return pages;
}

function riskLevelOrder(level: RiskItem['level']) {
  return { HIGH: 0, MEDIUM: 1, LOW: 2 }[level];
}

function includesKeyword(haystack: string, keyword: string) {
  return haystack.includes(keyword.toLowerCase());
}
