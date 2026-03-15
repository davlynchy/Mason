import { NextRequest } from 'next/server';
import { getSerializedReport } from '@/lib/report-state';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const encoder = new TextEncoder();
  let interval: NodeJS.Timeout | undefined;
  let lastPayload = '';

  const stream = new ReadableStream({
    async start(controller) {
      const pushReport = async () => {
        const report = await getSerializedReport(params.id);

        if (!report) {
          if (interval) {
            clearInterval(interval);
          }
          controller.enqueue(encoder.encode(`event: error\ndata: ${JSON.stringify({ error: 'Report not found' })}\n\n`));
          controller.close();
          return;
        }

        const payload = JSON.stringify(report);
        if (payload !== lastPayload) {
          lastPayload = payload;
          controller.enqueue(encoder.encode(`event: report\ndata: ${payload}\n\n`));
        }

        if (report.status === 'complete' || report.status === 'error') {
          if (interval) {
            clearInterval(interval);
          }
          controller.close();
        }
      };

      await pushReport();

      interval = setInterval(() => {
        void pushReport().catch(error => {
          if (interval) {
            clearInterval(interval);
          }
          controller.enqueue(
            encoder.encode(`event: error\ndata: ${JSON.stringify({ error: error instanceof Error ? error.message : 'Stream error' })}\n\n`)
          );
          controller.close();
        });
      }, 1500);
    },
    cancel() {
      if (interval) {
        clearInterval(interval);
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}
