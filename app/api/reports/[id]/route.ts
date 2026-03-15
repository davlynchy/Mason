import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { id } = params;
    const supabase = createServerClient();

    const { data, error } = await supabase
      .from('reports')
      .select('id, status, paid, contract_type, preview_data, full_data, error_message')
      .eq('id', id)
      .single();

    if (error || !data) {
      return NextResponse.json({ error: 'Report not found' }, { status: 404 });
    }

    // Only return full_data if paid
    return NextResponse.json({
      id:           data.id,
      status:       data.status,
      paid:         data.paid,
      contractType: data.contract_type,
      previewData:  data.preview_data,
      fullData:     data.paid ? data.full_data : null,
      errorMessage: data.error_message,
    });

  } catch (err) {
    console.error('Report GET error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
