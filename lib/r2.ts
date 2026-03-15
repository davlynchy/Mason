import {
  S3Client,
  GetObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { PutObjectCommand } from '@aws-sdk/client-s3';

function getOptionalEnv(name: string): string | undefined {
  const value = process.env[name]
    ?.trim()
    .replace(/^['"]/, '')
    .replace(/['"]$/, '');
  return value ? value : undefined;
}

function getR2Endpoint(): string {
  const configuredEndpoint = getOptionalEnv('CLOUDFLARE_R2_ENDPOINT');

  if (configuredEndpoint) {
    let parsed: URL;
    try {
      parsed = new URL(configuredEndpoint);
    } catch {
      throw new Error(
        'CLOUDFLARE_R2_ENDPOINT must be a valid https://...r2.cloudflarestorage.com URL from Cloudflare'
      );
    }

    if (parsed.protocol !== 'https:' || !parsed.hostname.endsWith('.r2.cloudflarestorage.com')) {
      throw new Error(
        'CLOUDFLARE_R2_ENDPOINT must be a full https://...r2.cloudflarestorage.com endpoint from Cloudflare'
      );
    }

    return parsed.origin;
  }

  const accountId = getOptionalEnv('CLOUDFLARE_R2_ACCOUNT_ID');
  const jurisdiction = getOptionalEnv('CLOUDFLARE_R2_JURISDICTION');

  if (!accountId) {
    throw new Error('Missing CLOUDFLARE_R2_ACCOUNT_ID or CLOUDFLARE_R2_ENDPOINT');
  }

  if (accountId.includes('://') || accountId.includes('/')) {
    throw new Error('CLOUDFLARE_R2_ACCOUNT_ID must be the bare Cloudflare account ID');
  }

  if (jurisdiction && !['eu', 'fedramp'].includes(jurisdiction)) {
    throw new Error('CLOUDFLARE_R2_JURISDICTION must be either "eu" or "fedramp"');
  }

  const jurisdictionSegment = jurisdiction ? `.${jurisdiction}` : '';
  return `https://${accountId}${jurisdictionSegment}.r2.cloudflarestorage.com`;
}

// R2 is S3-compatible — use the account endpoint
export const r2Client = new S3Client({
  region: 'auto',
  endpoint: getR2Endpoint(),
  forcePathStyle: true,
  credentials: {
    accessKeyId:     process.env.CLOUDFLARE_R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY!,
  },
});

const BUCKET = process.env.CLOUDFLARE_R2_BUCKET_NAME!;

// Generate a presigned PUT URL — client uploads directly to R2
// Supports up to 5 GB per object (1 GB is fine with a single PUT)
export async function generatePresignedPutUrl(
  r2Key: string,
  contentType: string,
  expiresIn = 3600 // 1 hour
): Promise<string> {
  const command = new PutObjectCommand({
    Bucket: BUCKET,
    Key:    r2Key,
    ContentType: contentType,
  });
  return getSignedUrl(r2Client, command, { expiresIn });
}

// Download file content from R2 (for AI analysis)
export async function downloadFromR2(r2Key: string): Promise<Buffer> {
  const command = new GetObjectCommand({ Bucket: BUCKET, Key: r2Key });
  const response = await r2Client.send(command);

  const chunks: Uint8Array[] = [];
  const stream = response.Body as AsyncIterable<Uint8Array>;
  for await (const chunk of stream) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

// Delete file from R2
export async function deleteFromR2(r2Key: string): Promise<void> {
  const command = new DeleteObjectCommand({ Bucket: BUCKET, Key: r2Key });
  await r2Client.send(command);
}

// Build the R2 key for a file
export function buildR2Key(reportId: string, filename: string): string {
  const safe = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
  return `reports/${reportId}/${Date.now()}_${safe}`;
}
