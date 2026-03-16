import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const reportId = body.reportId as string | undefined;
    const files = body.files as Array<{
      r2Key: string;
      filename: string;
      contentType?: string;
      fileSize?: number;
    }> | undefined;

    if (!reportId || !files?.length) {
      return NextResponse.json({ error: 'Missing reportId or files' }, { status: 400 });
    }

    const supabase = createServerClient();
    const rows = files.map(file => ({
      report_id: reportId,
      r2_key: file.r2Key,
      filename: file.filename,
      content_type: file.contentType || null,
      file_size: file.fileSize ?? null,
      extraction_status: 'pending',
    }));

    const { error: deleteError } = await supabase
      .from('report_files')
      .delete()
      .eq('report_id', reportId);

    if (deleteError) {
      console.error('report-files delete error:', deleteError);
      return NextResponse.json({ error: 'Failed to replace report files' }, { status: 500 });
    }

    const { error: insertError } = await supabase
      .from('report_files')
      .insert(rows);

    if (insertError) {
      console.error('report-files insert error:', insertError);
      return NextResponse.json({ error: 'Failed to save uploaded file references' }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('report-files POST error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
