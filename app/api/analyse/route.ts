import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';
import {
  analyseFullContract,
  analysePreviewRisk,
  analysePreviewSnapshot,
  type AnalysisStage,
  type Jurisdiction,
} from '@/lib/ai';

export const maxDuration = 300;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const reportId = body.reportId as string | undefined;
    const requestedKeys = body.r2Keys as string[] | undefined;
    const requestedContractType = body.contractType as 'subcontract' | 'head_contract' | undefined;
    const requestedJurisdiction = body.jurisdiction as Jurisdiction | undefined;
    const requestedStage = (body.stage as AnalysisStage | undefined) ?? 'preview';

    if (!reportId) {
      return NextResponse.json({ error: 'Missing reportId' }, { status: 400 });
    }

    const supabase = createServerClient();
    const { data: report, error: reportError } = await supabase
      .from('reports')
      .select('id, paid, contract_type, jurisdiction, preview_data, full_data')
      .eq('id', reportId)
      .single();

    if (reportError || !report) {
      return NextResponse.json({ error: 'Report not found' }, { status: 404 });
    }

    if (requestedStage === 'full' && !report.paid) {
      return NextResponse.json({ error: 'Full analysis is only available after payment' }, { status: 403 });
    }

    const contractType = requestedContractType ?? report.contract_type;
    const jurisdiction = requestedJurisdiction ?? report.jurisdiction ?? 'AU';

    const r2Keys = requestedKeys?.length
      ? requestedKeys
      : await getReportKeys(supabase, reportId);

    if (!r2Keys.length) {
      return NextResponse.json({ error: 'No uploaded files found for this report' }, { status: 400 });
    }

    const { error: statusError } = await supabase
      .from('reports')
      .update({ status: 'processing', error_message: null })
      .eq('id', reportId);

    if (statusError) {
      console.error(`reports processing update error [${reportId}]:`, statusError);
      return NextResponse.json({ error: 'Failed to mark report as processing' }, { status: 500 });
    }

    if (requestedKeys?.length) {
      const reportFiles = r2Keys.map((key: string) => ({
        report_id: reportId,
        r2_key: key,
        filename: key.split('/').pop() ?? key,
      }));

      await supabase.from('report_files').delete().eq('report_id', reportId);
      const { error: filesError } = await supabase.from('report_files').insert(reportFiles);
      if (filesError) {
        console.error(`report_files insert error [${reportId}]:`, filesError);
        return NextResponse.json({ error: 'Failed to save uploaded file references' }, { status: 500 });
      }
    }

    const analysisResult = await runAnalysis(
      supabase,
      reportId,
      r2Keys,
      contractType,
      jurisdiction,
      requestedStage
    );

    if (analysisResult.status === 'error') {
      return NextResponse.json({ error: analysisResult.error }, { status: 500 });
    }

    return NextResponse.json({ status: 'complete', stage: requestedStage });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    console.error('Analyse route error:', err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
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

async function runAnalysis(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  reportId: string,
  r2Keys: string[],
  contractType: 'subcontract' | 'head_contract',
  jurisdiction: Jurisdiction,
  stage: AnalysisStage
): Promise<{ status: 'complete' | 'error'; error?: string }> {
  try {
    const filenames = r2Keys.map((key: string) => {
      const parts = key.split('/');
      const raw = parts[parts.length - 1] ?? key;
      return raw.replace(/^\d+_/, '');
    });

    if (stage === 'preview') {
      await updatePreviewState(supabase, reportId, {
        progress: {
          phase: 'summary',
          message: 'Reading your contract and extracting the core commercial terms.',
          completedSteps: ['Files uploaded'],
        },
      });

      const snapshot = await analysePreviewSnapshot(r2Keys, filenames, contractType, jurisdiction);

      await updatePreviewState(supabase, reportId, {
        ...snapshot,
        preview_risk: null,
        progress: {
          phase: 'risk',
          message: 'First risk identified. Mason is now writing the most important warning.',
          completedSteps: ['Files uploaded', 'Summary generated', 'Risk counts mapped'],
        },
      });

      const previewRisk = await analysePreviewRisk(r2Keys, filenames, contractType, jurisdiction);
      const previewData = {
        ...snapshot,
        preview_risk: previewRisk,
        progress: {
          phase: 'complete',
          message: 'Fast preview ready.',
          completedSteps: ['Files uploaded', 'Summary generated', 'Risk counts mapped', 'Top risk explained'],
        },
      };

      const { error } = await supabase
        .from('reports')
        .update({
          status: 'complete',
          analysis_stage: 'preview',
          preview_data: previewData,
          completed_at: new Date().toISOString(),
        })
        .eq('id', reportId);

      if (error) {
        console.error(`reports preview update error [${reportId}]:`, error);
        return { status: 'error', error: 'Failed to save preview analysis' };
      }

      return { status: 'complete' };
    }

    const fullData = await analyseFullContract(r2Keys, filenames, contractType, jurisdiction);

    const { error } = await supabase
      .from('reports')
      .update({
        status: 'complete',
        analysis_stage: 'full',
        full_data: fullData,
        completed_at: new Date().toISOString(),
      })
      .eq('id', reportId);

    if (error) {
      console.error(`reports full update error [${reportId}]:`, error);
      return { status: 'error', error: 'Failed to save full analysis' };
    }

    return { status: 'complete' };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Analysis failed';
    console.error(`runAnalysis error [${reportId}]:`, err);

    await supabase
      .from('reports')
      .update({
        status: 'error',
        error_message: msg,
      })
      .eq('id', reportId);

    return { status: 'error', error: msg };
  }
}

async function updatePreviewState(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  reportId: string,
  previewData: Record<string, unknown>
) {
  const { error } = await supabase
    .from('reports')
    .update({
      status: 'processing',
      analysis_stage: 'preview',
      preview_data: previewData,
    })
    .eq('id', reportId);

  if (error) {
    throw new Error('Failed to save preview progress');
  }
}
