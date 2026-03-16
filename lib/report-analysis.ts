import {
  analyseFullContract,
  analyseFullContractFromSections,
  analysePreviewRisk,
  analysePreviewRiskFromSections,
  analysePreviewSnapshot,
  analysePreviewSnapshotFromSections,
  collectExtractionEvidence,
  type ExtractionEvidence,
  type RiskItem,
  type AnalysisStage,
  type Jurisdiction,
} from '@/lib/ai';
import { buildContractSections } from '@/lib/contract-structure';
import { generateRuleBasedFindings, mergeFindings, mergeRiskCounts } from '@/lib/contract-rules';
import { createServerClient } from '@/lib/supabase';
import type { ProcessingPhase } from '@/lib/report-state';

interface ReportRecord {
  id: string;
  paid: boolean;
  status: 'uploading' | 'processing' | 'complete' | 'error';
  contract_type: 'subcontract' | 'head_contract';
  jurisdiction: Jurisdiction;
  preview_data: Record<string, unknown> | null;
}

interface AnalysisJobOptions {
  reportId: string;
  stage: AnalysisStage;
  r2Keys?: string[];
  contractType?: 'subcontract' | 'head_contract';
  jurisdiction?: Jurisdiction;
}

const STEP_TIMEOUT_MS = 90_000;

export function scheduleAnalysisJob(options: AnalysisJobOptions) {
  setTimeout(() => {
    void runAnalysisJob(options).catch(error => {
      console.error(`Scheduled analysis job failed [${options.reportId}]:`, error);
    });
  }, 0);
}

export async function markAnalysisQueued(options: AnalysisJobOptions) {
  const supabase = createServerClient();
  const report = await fetchReportRecord(supabase, options.reportId);

  if (!report) {
    throw new Error('Report not found');
  }

  if (options.stage === 'full' && !report.paid) {
    throw new Error('Full analysis is only available after payment');
  }

  if (report.status === 'processing') {
    return { report, alreadyProcessing: true };
  }

  const now = new Date().toISOString();
  const { error } = await supabase
    .from('reports')
    .update({
      status: 'processing',
      analysis_stage: options.stage,
      error_message: null,
      processing_error: null,
      processing_phase: 'queued',
      processing_message: 'Analysis queued. Mason is about to start reading your documents.',
      processing_started_at: now,
      processing_updated_at: now,
    })
    .eq('id', options.reportId);

  if (error) {
    throw new Error('Failed to queue analysis');
  }

  return { report, alreadyProcessing: false };
}

async function runAnalysisJob(options: AnalysisJobOptions) {
  const supabase = createServerClient();
  const report = await fetchReportRecord(supabase, options.reportId);

  if (!report) {
    return;
  }

  const stage = options.stage;
  const contractType = options.contractType ?? report.contract_type;
  const jurisdiction = options.jurisdiction ?? report.jurisdiction ?? 'AU';
  const r2Keys = options.r2Keys?.length ? options.r2Keys : await getReportKeys(supabase, options.reportId);

  if (!r2Keys.length) {
    await failAnalysis(supabase, options.reportId, 'queued', 'No uploaded files found for this report');
    return;
  }

  if (stage === 'preview') {
    await runPreviewAnalysis(supabase, options.reportId, r2Keys, contractType, jurisdiction, report.preview_data);
    return;
  }

  await runFullAnalysis(supabase, options.reportId, r2Keys, contractType, jurisdiction);
}

async function runPreviewAnalysis(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  reportId: string,
  r2Keys: string[],
  contractType: 'subcontract' | 'head_contract',
  jurisdiction: Jurisdiction,
  existingPreviewData: Record<string, unknown> | null
) {
  try {
    const filenames = deriveFilenames(r2Keys);
    const previewData = existingPreviewData ?? {};

    const extractionEvidence = await collectExtractionEvidence(r2Keys, filenames, 'preview');
    await persistExtractionEvidence(supabase, reportId, extractionEvidence);
    const sections = buildContractSections(extractionEvidence);
    await replaceContractSections(supabase, reportId, extractionEvidence, sections);
    const ruleFindings = generateRuleBasedFindings(sections, jurisdiction);

    if (!previewData.executive_summary || !previewData.contract_details || !previewData.risk_count) {
      await updateProcessingState(supabase, reportId, {
        phase: 'extracting',
        message: 'Extracting readable text from your uploaded documents.',
        previewData,
      });

      await updateProcessingState(supabase, reportId, {
        phase: 'summarising',
        message: 'Writing your executive summary and contract details.',
        previewData,
      });

      const snapshot = await withStepTimeout(
        withPhase(
          'summarising',
          sections.length
            ? analysePreviewSnapshotFromSections(sections, contractType, jurisdiction)
            : analysePreviewSnapshot(r2Keys, filenames, contractType, jurisdiction)
        ),
        'summarising'
      );

      await updateProcessingState(supabase, reportId, {
        phase: 'counting',
        message: 'Mapping likely risk counts across the contract.',
        previewData: {
          ...previewData,
          ...snapshot,
        },
      });

      Object.assign(previewData, snapshot);
      previewData.risk_count = mergeRiskCounts(
        snapshot.risk_count,
        mergeFindings(ruleFindings, [])
      );
    }

    if (!previewData.preview_risk || ruleFindings.length) {
      await updateProcessingState(supabase, reportId, {
        phase: 'top_risk',
        message: 'Drafting the first key warning and negotiation recommendation.',
        previewData,
      });

      const previewRisk = await withStepTimeout(
        withPhase(
          'top_risk',
          sections.length
            ? analysePreviewRiskFromSections(sections, contractType, jurisdiction)
            : analysePreviewRisk(r2Keys, filenames, contractType, jurisdiction)
        ),
        'top_risk'
      );

      const mergedPreviewFindings = mergeFindings(
        ruleFindings,
        previewRisk ? annotateAiFindings([previewRisk]) : []
      );
      previewData.preview_risk = mergedPreviewFindings[0] ?? null;
      if (previewData.risk_count) {
        previewData.risk_count = mergeRiskCounts(
          previewData.risk_count as { high: number; medium: number; low: number },
          mergedPreviewFindings
        );
      }

      await replaceFindings(supabase, reportId, 'preview', mergedPreviewFindings);
    } else {
      await replaceFindings(
        supabase,
        reportId,
        'preview',
        previewData.preview_risk ? annotateStoredFindings([previewData.preview_risk as RiskItem]) : []
      );
    }

    const { error } = await supabase
      .from('reports')
      .update({
        status: 'complete',
        analysis_stage: 'preview',
        preview_data: {
          ...previewData,
          progress: {
            phase: 'complete',
            message: 'Fast preview ready.',
            completedSteps: ['Files uploaded', 'Summary generated', 'Risk counts mapped', 'Top risk explained'],
          },
        },
        processing_phase: 'complete',
        processing_message: 'Fast preview ready.',
        processing_error: null,
        processing_updated_at: new Date().toISOString(),
        completed_at: new Date().toISOString(),
      })
      .eq('id', reportId);

    if (error) {
      throw new Error('Failed to save preview analysis');
    }
  } catch (error) {
    const message = normaliseFailureMessage(error);
    const failedPhase = extractFailedPhase(error);
    await failAnalysis(supabase, reportId, failedPhase, message);
  }
}

async function runFullAnalysis(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  reportId: string,
  r2Keys: string[],
  contractType: 'subcontract' | 'head_contract',
  jurisdiction: Jurisdiction
) {
  try {
    const filenames = deriveFilenames(r2Keys);
    const extractionEvidence = await collectExtractionEvidence(r2Keys, filenames, 'full');
    await persistExtractionEvidence(supabase, reportId, extractionEvidence);
    const sections = buildContractSections(extractionEvidence);
    await replaceContractSections(supabase, reportId, extractionEvidence, sections);
    const ruleFindings = generateRuleBasedFindings(sections, jurisdiction);

    const { error: processingError } = await supabase
      .from('reports')
      .update({
        status: 'processing',
        analysis_stage: 'full',
        processing_phase: 'extracting',
        processing_message: 'Preparing the full contract review.',
        processing_error: null,
        processing_updated_at: new Date().toISOString(),
      })
      .eq('id', reportId);

    if (processingError) {
      throw new Error('Failed to mark full analysis as processing');
    }

    const fullData = await withStepTimeout(
      withPhase(
        'top_risk',
        sections.length
          ? analyseFullContractFromSections(sections, contractType, jurisdiction)
          : analyseFullContract(r2Keys, filenames, contractType, jurisdiction)
      ),
      'top_risk'
    );

    const mergedFullRisks = mergeFindings(ruleFindings, annotateAiFindings(fullData.risks));
    fullData.risks = mergedFullRisks;

    await replaceFindings(supabase, reportId, 'full', mergedFullRisks);

    const { error } = await supabase
      .from('reports')
      .update({
        status: 'complete',
        analysis_stage: 'full',
        full_data: fullData,
        processing_phase: 'complete',
        processing_message: 'Full report ready.',
        processing_error: null,
        processing_updated_at: new Date().toISOString(),
        completed_at: new Date().toISOString(),
      })
      .eq('id', reportId);

    if (error) {
      throw new Error('Failed to save full analysis');
    }
  } catch (error) {
    const message = normaliseFailureMessage(error);
    const failedPhase = extractFailedPhase(error);
    await failAnalysis(supabase, reportId, failedPhase, message);
  }
}

async function updateProcessingState(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  reportId: string,
  {
    phase,
    message,
    previewData,
  }: {
    phase: ProcessingPhase;
    message: string;
    previewData?: Record<string, unknown> | null;
  }
) {
  const { error } = await supabase
    .from('reports')
    .update({
      status: 'processing',
      analysis_stage: 'preview',
      preview_data: previewData,
      processing_phase: phase,
      processing_message: message,
      processing_error: null,
      processing_updated_at: new Date().toISOString(),
    })
    .eq('id', reportId);

  if (error) {
    throw new Error('Failed to save preview progress');
  }
}

async function failAnalysis(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  reportId: string,
  phase: ProcessingPhase,
  message: string
) {
  await supabase
    .from('reports')
    .update({
      status: 'error',
      error_message: message,
      processing_phase: 'error',
      processing_message: `Analysis failed during ${phase}.`,
      processing_error: message,
      processing_updated_at: new Date().toISOString(),
    })
    .eq('id', reportId);
}

async function fetchReportRecord(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  reportId: string
): Promise<ReportRecord | null> {
  const { data, error } = await supabase
    .from('reports')
    .select('id, paid, status, contract_type, jurisdiction, preview_data')
    .eq('id', reportId)
    .single();

  if (error || !data) {
    return null;
  }

  return data as ReportRecord;
}

async function getReportKeys(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  reportId: string
): Promise<string[]> {
  const { data, error } = await supabase
    .from('report_files')
    .select('r2_key')
    .eq('report_id', reportId)
    .order('created_at', { ascending: true });

  if (error || !data) {
    return [];
  }

  return data.map((row: { r2_key: string }) => row.r2_key);
}

function deriveFilenames(r2Keys: string[]): string[] {
  return r2Keys.map((key: string) => {
    const parts = key.split('/');
    const raw = parts[parts.length - 1] ?? key;
    return raw.replace(/^\d+_/, '');
  });
}

async function withStepTimeout<T>(promise: Promise<T>, phase: ProcessingPhase): Promise<T> {
  let timer: NodeJS.Timeout | undefined;

  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error(`STEP_TIMEOUT:${phase}`));
        }, STEP_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

function extractFailedPhase(error: unknown): ProcessingPhase {
  if (error instanceof Error && error.message.startsWith('STEP_TIMEOUT:')) {
    return error.message.replace('STEP_TIMEOUT:', '') as ProcessingPhase;
  }

  if (error instanceof Error && error.message.startsWith('STEP_FAILED:')) {
    return error.message.split(':')[1] as ProcessingPhase;
  }

  return 'error';
}

async function withPhase<T>(phase: ProcessingPhase, promise: Promise<T>): Promise<T> {
  try {
    return await promise;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Analysis step failed';
    throw new Error(`STEP_FAILED:${phase}:${message}`);
  }
}

function normaliseFailureMessage(error: unknown): string {
  if (!(error instanceof Error)) {
    return 'Analysis failed';
  }

  if (error.message.startsWith('STEP_TIMEOUT:')) {
    const phase = error.message.replace('STEP_TIMEOUT:', '');
    return `Analysis timed out during ${phase}.`;
  }

  if (error.message.startsWith('STEP_FAILED:')) {
    const [, , ...rest] = error.message.split(':');
    return rest.join(':') || 'Analysis step failed';
  }

  return error.message;
}

async function persistExtractionEvidence(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  reportId: string,
  evidence: ExtractionEvidence[]
) {
  for (const item of evidence) {
    const { error } = await supabase
      .from('report_files')
      .update({
        extraction_status: item.extractionStatus,
        extraction_method: item.extractionMethod,
        extraction_confidence: item.extractionConfidence,
        extracted_chars: item.extractedChars,
        extracted_text: item.extractedText,
      })
      .eq('report_id', reportId)
      .eq('r2_key', item.r2Key);

    if (error) {
      console.error(`Failed to persist extraction evidence for ${item.filename}:`, error);
    }
  }
}

async function replaceFindings(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  reportId: string,
  stage: 'preview' | 'full',
  risks: RiskItem[]
) {
  const { error: deleteError } = await supabase
    .from('analysis_findings')
    .delete()
    .eq('report_id', reportId)
    .eq('stage', stage);

  if (deleteError) {
    console.error(`Failed to clear ${stage} findings:`, deleteError);
    return;
  }

  if (!risks.length) {
    return;
  }

  const rows = risks.map((risk, index) => ({
    report_id: reportId,
    stage,
    risk_id: risk.id,
    level: risk.level,
    title: risk.title,
    clause: risk.clause,
    impact: risk.impact,
    detail: risk.detail,
    recommendation: risk.recommendation,
    source_pages: risk.source_pages ?? null,
    source_excerpt: risk.source_excerpt ?? null,
    finding_origin: risk.finding_origin ?? inferFindingOrigin(risk),
    rule_basis: risk.rule_basis ?? null,
    sort_order: index,
  }));

  const { error: insertError } = await supabase
    .from('analysis_findings')
    .insert(rows);

  if (insertError) {
    console.error(`Failed to store ${stage} findings:`, insertError);
  }
}

function annotateAiFindings(risks: RiskItem[]): RiskItem[] {
  return risks.map(risk => ({
    ...risk,
    finding_origin: risk.finding_origin ?? 'ai',
    rule_basis: risk.rule_basis ?? null,
  }));
}

function annotateStoredFindings(risks: RiskItem[]): RiskItem[] {
  return risks.map(risk => ({
    ...risk,
    finding_origin: risk.finding_origin ?? inferFindingOrigin(risk),
    rule_basis: risk.rule_basis ?? null,
  }));
}

function inferFindingOrigin(risk: RiskItem): 'rule' | 'ai' {
  return /^[A-Z]{2,3}\d+/.test(risk.id) ? 'rule' : 'ai';
}

async function replaceContractSections(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  reportId: string,
  evidence: ExtractionEvidence[],
  sections: ReturnType<typeof buildContractSections>
) {
  const { data: reportFiles, error: filesError } = await supabase
    .from('report_files')
    .select('id, r2_key, filename')
    .eq('report_id', reportId);

  if (filesError || !reportFiles) {
    console.error(`Failed to load report files for sectioning [${reportId}]:`, filesError);
    return;
  }

  const fileIdByKey = new Map<string, string>(
    reportFiles.map((file: { id: string; r2_key: string }) => [file.r2_key, file.id])
  );

  const { error: deleteError } = await supabase
    .from('contract_sections')
    .delete()
    .eq('report_id', reportId);

  if (deleteError) {
    console.error(`Failed to clear contract sections [${reportId}]:`, deleteError);
    return;
  }

  if (!sections.length) {
    return;
  }

  const rows = sections.map(section => {
    const matchingEvidence = evidence.find(item => item.filename === section.filename);

    return {
      report_id: reportId,
      report_file_id: matchingEvidence ? fileIdByKey.get(matchingEvidence.r2Key) ?? null : null,
      filename: section.filename,
      section_type: section.sectionType,
      section_label: section.sectionLabel,
      clause_number: section.clauseNumber,
      heading: section.heading,
      page_start: section.pageStart,
      page_end: section.pageEnd,
      content: section.content,
      sort_order: section.sortOrder,
    };
  });

  const { error: insertError } = await supabase
    .from('contract_sections')
    .insert(rows);

  if (insertError) {
    console.error(`Failed to store contract sections [${reportId}]:`, insertError);
  }
}
