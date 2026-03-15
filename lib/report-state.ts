import { createServerClient } from '@/lib/supabase';

export type ProcessingPhase =
  | 'queued'
  | 'extracting'
  | 'summarising'
  | 'counting'
  | 'top_risk'
  | 'complete'
  | 'error';

export interface SerializedReport {
  id: string;
  status: 'uploading' | 'processing' | 'complete' | 'error';
  paid: boolean;
  contractType: 'subcontract' | 'head_contract';
  jurisdiction: 'AU' | 'UK' | 'USA';
  analysisStage: 'preview' | 'full';
  previewData: Record<string, unknown> | null;
  fullData: Record<string, unknown> | null;
  errorMessage: string | null;
  processingPhase: ProcessingPhase | null;
  processingMessage: string | null;
  processingError: string | null;
  processingStartedAt: string | null;
  processingUpdatedAt: string | null;
}

const REPORT_SELECT = [
  'id',
  'status',
  'paid',
  'contract_type',
  'jurisdiction',
  'analysis_stage',
  'preview_data',
  'full_data',
  'error_message',
  'processing_phase',
  'processing_message',
  'processing_error',
  'processing_started_at',
  'processing_updated_at',
].join(', ');

export async function getSerializedReport(reportId: string): Promise<SerializedReport | null> {
  const supabase = createServerClient();
  const { data, error } = await supabase
    .from('reports')
    .select(REPORT_SELECT)
    .eq('id', reportId)
    .single();

  if (error || !data) {
    return null;
  }

  return serializeReport(data);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function serializeReport(data: any): SerializedReport {
  return {
    id: data.id,
    status: data.status,
    paid: data.paid,
    contractType: data.contract_type,
    jurisdiction: data.jurisdiction,
    analysisStage: data.analysis_stage,
    previewData: data.preview_data,
    fullData: data.paid ? data.full_data : null,
    errorMessage: data.error_message,
    processingPhase: data.processing_phase,
    processingMessage: data.processing_message,
    processingError: data.processing_error,
    processingStartedAt: data.processing_started_at,
    processingUpdatedAt: data.processing_updated_at,
  };
}
