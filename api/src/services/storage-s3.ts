import { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { env } from '../config/env';

export type S3ObjectPointer = {
  bucket: string;
  key: string;
};

export function getS3Client(): S3Client {
  // Scaleway S3 and MinIO are S3-compatible. We support custom endpoint for local/dev.
  const region = env.S3_REGION || 'fr-par';

  const accessKeyId = env.SCW_ACCESS_KEY;
  const secretAccessKey = env.SCW_SECRET_KEY;

  const endpoint = env.S3_ENDPOINT;
  const forcePathStyle = !!endpoint; // required for most MinIO setups

  return new S3Client({
    region,
    endpoint: endpoint || undefined,
    forcePathStyle,
    credentials:
      accessKeyId && secretAccessKey
        ? {
            accessKeyId,
            secretAccessKey,
          }
        : undefined,
  });
}

export function getDocumentsBucketName(): string {
  const bucket = (env.S3_BUCKET_NAME || '').trim();
  if (!bucket) {
    throw new Error('S3_BUCKET_NAME is not configured');
  }
  return bucket;
}

export async function putObject(params: {
  bucket: string;
  key: string;
  body: Uint8Array | Buffer;
  contentType?: string;
}): Promise<void> {
  const client = getS3Client();
  await client.send(
    new PutObjectCommand({
      Bucket: params.bucket,
      Key: params.key,
      Body: params.body,
      ContentType: params.contentType,
    })
  );
}

export async function headObject(pointer: S3ObjectPointer): Promise<{
  contentLength?: number;
  contentType?: string;
}> {
  const client = getS3Client();
  const res = await client.send(
    new HeadObjectCommand({
      Bucket: pointer.bucket,
      Key: pointer.key,
    })
  );
  return {
    contentLength: typeof res.ContentLength === 'number' ? res.ContentLength : undefined,
    contentType: typeof res.ContentType === 'string' ? res.ContentType : undefined,
  };
}

export async function getObjectBodyStream(pointer: S3ObjectPointer): Promise<ReadableStream<Uint8Array>> {
  const client = getS3Client();
  const res = await client.send(
    new GetObjectCommand({
      Bucket: pointer.bucket,
      Key: pointer.key,
    })
  );

  // In Node 18+ AWS SDK returns a Readable (node stream) or web stream depending on runtime.
  // We normalize to Web ReadableStream to match Hono streaming patterns.
  const body = res.Body;
  if (!body) throw new Error('S3 getObject: empty body');

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const anyBody: any = body as any;
  if (typeof anyBody.transformToWebStream === 'function') {
    return anyBody.transformToWebStream();
  }
  if (typeof ReadableStream !== 'undefined' && anyBody instanceof ReadableStream) {
    return anyBody;
  }
  throw new Error('S3 getObject: unsupported body type');
}

export async function deleteObject(pointer: S3ObjectPointer): Promise<void> {
  const client = getS3Client();
  await client.send(
    new DeleteObjectCommand({
      Bucket: pointer.bucket,
      Key: pointer.key,
    })
  );
}


