import { createHash } from 'node:crypto';
import { open, unlink } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createGunzip } from 'node:zlib';
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { custody } from './cm-preprod-contract';

/** Validate every compressed byte, gzip CRC and the pg_dump envelope; optional exclusive 0600 copy. */
export async function validateBackup(body: AsyncIterable<Uint8Array>, copyPath?: string) {
  const hash = createHash('sha256');
  let bytes = 0, plainBytes = 0, first = Buffer.alloc(0), last = Buffer.alloc(0);
  const file = copyPath ? await open(copyPath, 'wx', 0o600) : undefined;
  try {
    async function* compressed() {
      for await (const chunk of body) {
        hash.update(chunk); bytes += chunk.byteLength;
        if (file) await file.writeFile(chunk);
        yield chunk;
      }
    }
    await pipeline(Readable.from(compressed()), createGunzip(), async plain => {
      for await (const chunk of plain) {
        const data = Buffer.from(chunk);
        plainBytes += data.byteLength;
        if (first.length < 1024) first = Buffer.concat([first, data]).subarray(0, 1024);
        last = Buffer.concat([last, data]).subarray(-1024);
      }
    });
    if (!bytes || !plainBytes || !first.includes('-- PostgreSQL database dump')
      || !last.includes('-- PostgreSQL database dump complete')) throw new Error('backup_invalid');
    await file?.sync();
    return { backupSha256: hash.digest('hex'), backupBytes: bytes };
  } catch {
    if (file && copyPath) await unlink(copyPath);
    throw new Error('backup_invalid');
  } finally { await file?.close(); }
}

/** Only the tenant's existing sentropic-pgbackup identity/bucket and pg/ namespace are used. */
export async function downloadTenantBackup(key: string, write: boolean) {
  if (!/^pg\/[0-9]{8}T[0-9]{6}Z\.sql\.gz$/.test(key)) throw new Error('backup_key_invalid');
  const endpoint = process.env.S3_ENDPOINT, region = process.env.S3_REGION, bucket = process.env.S3_BUCKET;
  const accessKeyId = process.env.S3_ACCESS_KEY, secretAccessKey = process.env.S3_SECRET_KEY;
  if (!endpoint?.startsWith('https://') || !region || !bucket || !accessKeyId || !secretAccessKey) {
    throw new Error('backup_custody_missing');
  }
  const s3 = new S3Client({ endpoint, region, forcePathStyle: true, credentials: { accessKeyId, secretAccessKey } });
  try {
    const object = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    if (!object.Body || !object.ContentLength) throw new Error('backup_missing');
    const result = await validateBackup(object.Body as AsyncIterable<Uint8Array>, write ? `${custody}/source.sql.gz` : undefined);
    if (result.backupBytes !== object.ContentLength) throw new Error('backup_length_mismatch');
    return result;
  } finally { s3.destroy(); }
}
