import {
  analyseFullContract,
  analysePreviewRisk,
  analysePreviewSnapshot,
  type AnalysisStage,
  type Jurisdiction,
} from '@/lib/ai';
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
          analysePreviewSnapshot(r2Keys, filenames, contractType, jurisdiction)
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
    }

    if (!previewData.preview_risk) {
      await updateProcessingState(supabase, reportId, {
        phase: 'top_risk',
        message: 'Drafting the first key warning and negotiation recommendation.',
        previewData,
      });

      const previewRisk = await withStepTimeout(
        withPhase(
          'top_risk',
          analysePreviewRisk(r2Keys, filenames, contractType, jurisdiction)
        ),
        'top_risk'
      );

      previewData.preview_risk = previewRisk;
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
        analyseFullContract(r2Keys, deriveFilenames(r2Keys), contractType, jurisdiction)
      ),
      'top_risk'
    );

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
