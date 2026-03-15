import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';
import { analyseContract, splitAnalysis } from '@/lib/ai';

export const maxDuration = 300; // 5 min timeout for Vercel

export async function POST(req: NextRequest) {
  try {
    const { reportId, r2Keys, contractType } = await req.json();

    if (!reportId || !r2Keys?.length) {
      return NextResponse.json({ error: 'Missing reportId or r2Keys' }, { status: 400 });
    }

    const supabase = createServerClient();

    // 1. Mark as processing
    await supabase
      .from('reports')
      .update({ status: 'processing' })
      .eq('id', reportId);

    // 2. Store file keys for reference
    await supabase
      .from('report_files')
      .insert(
        r2Keys.map((key: string) => ({
          report_id: reportId,
          r2_key:    key,
          filename:  key.split('/').pop() ?? key,
        }))
      );

    // 3. Run AI analysis (async — don't block the response)
    runAnalysis(reportId, r2Keys, contractType, supabase).catch(err => {
      console.error(`Analysis failed for report ${reportId}:`, err);
    });

    // Return immediately — frontend will poll
    return NextResponse.json({ status: 'processing' });

  } catch (err) {
    console.error('Analyse route error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

async function runAnalysis(
  reportId: string,
  r2Keys: string[],
  contractType: 'subcontract' | 'head_contract',
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any
) {
  try {
    // Extract filenames from R2 keys
    const filenames = r2Keys.map((k: string) => {
      const parts = k.split('/');
      const raw = parts[parts.length - 1] ?? k;
      // Strip timestamp prefix: "1234567890_filename.pdf" → "filename.pdf"
      return raw.replace(/^\d+_/, '');
    });

    // Run the full analysis
    const result = await analyseContract(r2Keys, filenames, contractType);
    const { previewData, fullData } = splitAnalysis(result);

    // Save results
    await supabase
      .from('reports')
      .update({
        status:       'complete',
        preview_data: previewData,
        full_data:    fullData,
        completed_at: new Date().toISOString(),
      })
      .eq('id', reportId);

  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Analysis failed';
    console.error(`runAnalysis error [${reportId}]:`, err);

    await supabase
      .from('reports')
      .update({
        status:        'error',
        error_message: msg,
      })
      .eq('id', reportId);
  }
}
