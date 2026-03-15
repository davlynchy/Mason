import { NextRequest, NextResponse } from 'next/server';
import { generatePresignedPutUrl, buildR2Key } from '@/lib/r2';

const MAX_FILE_SIZE = 1024 * 1024 * 1024; // 1 GB

export async function POST(req: NextRequest) {
  try {
    const { reportId, filename, contentType, size } = await req.json();

    if (!reportId || !filename || !contentType) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    if (size && size > MAX_FILE_SIZE) {
      return NextResponse.json({ error: 'File exceeds 1 GB limit' }, { status: 400 });
    }

    const r2Key = buildR2Key(reportId, filename);
    const presignedUrl = await generatePresignedPutUrl(r2Key, contentType);

    return NextResponse.json({ presignedUrl, r2Key });
  } catch (err) {
    console.error('upload-url error:', err);
    return NextResponse.json({ error: 'Failed to generate upload URL' }, { status: 500 });
  }
}
