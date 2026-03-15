import { NextRequest, NextResponse } from 'next/server';
import { getSerializedReport } from '@/lib/report-state';
import { markAnalysisQueued, scheduleAnalysisJob } from '@/lib/report-analysis';
import type { AnalysisStage, Jurisdiction } from '@/lib/ai';

export const maxDuration = 30;

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

    const queueResult = await markAnalysisQueued({
      reportId,
      stage: requestedStage,
      r2Keys: requestedKeys,
      contractType: requestedContractType,
      jurisdiction: requestedJurisdiction,
    });

    if (!queueResult.alreadyProcessing) {
      scheduleAnalysisJob({
        reportId,
        stage: requestedStage,
        r2Keys: requestedKeys,
        contractType: requestedContractType,
        jurisdiction: requestedJurisdiction,
      });
    }

    const report = await getSerializedReport(reportId);

    return NextResponse.json(
      {
        status: 'accepted',
        stage: requestedStage,
        report,
      },
      { status: 202 }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    console.error('Analyse route error:', err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
