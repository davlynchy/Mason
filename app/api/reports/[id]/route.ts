import { NextRequest, NextResponse } from 'next/server';
import { getSerializedReport } from '@/lib/report-state';

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const report = await getSerializedReport(params.id);

    if (!report) {
      return NextResponse.json({ error: 'Report not found' }, { status: 404 });
    }

    return NextResponse.json(report);
  } catch (err) {
    console.error('Report GET error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
