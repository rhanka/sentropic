import {
  CreateBucketCommand,
  DeleteBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';

export interface SessionContentFixtureConfig {
  readonly endpoint: string;
  readonly region: string;
  readonly bucket: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
}

const readEnv = (name: string, fallback: string): string => {
  const raw = process.env[name];
  return raw && raw.trim() ? raw.trim() : fallback;
};

/** Project-local MinIO endpoint guard: the fixture may only touch the
 * isolated test MinIO, never a project-external or production endpoint. */
export const assertProjectLocalEndpoint = (endpoint: string): void => {
  let host = '';
  try {
    host = new URL(endpoint).hostname;
  } catch {
    throw new Error(`session content fixture refuses non-URL endpoint ${endpoint}`);
  }
  if (host !== 'minio' && host !== 'localhost' && host !== '127.0.0.1') {
    throw new Error(`session content fixture refuses project-external endpoint ${endpoint}`);
  }
};

/** Explicit injected D2 S3 config with fixed disposable credentials and a
 * randomized private `scc-test-*` bucket. Missing storage fails rather
 * than skips; document-configured helpers are never used here. */
export const resolveSessionContentFixtureConfig = (
  suffix = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
): SessionContentFixtureConfig => {
  const endpoint = readEnv('SESSION_CONTENT_STORAGE_ENDPOINT', 'http://minio:9000');
  assertProjectLocalEndpoint(endpoint);
  const bucket = `scc-test-${suffix}`.toLowerCase().replace(/[^a-z0-9-]/g, '-');
  if (bucket.startsWith('sentropic-docs-')) {
    throw new Error('session content fixture must not use document buckets');
  }
  return {
    endpoint,
    region: readEnv('SESSION_CONTENT_STORAGE_REGION', 'fr-par-1'),
    bucket,
    accessKeyId: readEnv('SESSION_CONTENT_STORAGE_ACCESS_KEY', 'minioadmin'),
    secretAccessKey: readEnv('SESSION_CONTENT_STORAGE_SECRET_KEY', 'minioadmin'),
  };
};

export const createFixtureS3Client = (config: SessionContentFixtureConfig): S3Client =>
  new S3Client({
    region: config.region,
    endpoint: config.endpoint,
    forcePathStyle: true,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  });

/** Unsigned REST against MinIO: no SDK signing involved, so a refusal is
 * a genuine anonymous denial, never a client-side credential error. */
const anonymousRestStatus = async (
  config: SessionContentFixtureConfig,
  key: string,
  method: 'GET' | 'PUT',
): Promise<number> => {
  const url = `${config.endpoint.replace(/\/$/, '')}/${config.bucket}/${key}`;
  const response = await fetch(url, { method, body: method === 'PUT' ? new Uint8Array([1]) : undefined });
  await response.arrayBuffer().catch(() => undefined);
  return response.status;
};

export interface SessionContentFixture {
  readonly config: SessionContentFixtureConfig;
  readonly client: S3Client;
  setup(): Promise<void>;
  put(key: string, body: Uint8Array): Promise<void>;
  head(key: string): Promise<'found' | 'missing'>;
  get(key: string): Promise<Uint8Array>;
  listPhysical(prefix: string): Promise<string[]>;
  assertAnonymousDenied(key: string): Promise<void>;
  cleanup(): Promise<void>;
}

/** Randomized private bucket with own-bucket-only cleanup for `finally`.
 * Every failure throws: nothing here may silently skip. */
export const createSessionContentFixture = (): SessionContentFixture => {
  const config = resolveSessionContentFixtureConfig();
  const client = createFixtureS3Client(config);
  return {
    config,
    client,
    async setup(): Promise<void> {
      try {
        await client.send(new CreateBucketCommand({ Bucket: config.bucket }));
      } catch (err) {
        const code = (err as { Code?: string; name?: string })?.Code
          ?? (err as { name?: string })?.name;
        if (code !== 'BucketAlreadyOwnedByYou' && code !== 'BucketAlreadyExists') throw err;
      }
      await client.send(new HeadObjectCommand({ Bucket: config.bucket, Key: '__probe__' })).then(
        () => { throw new Error('probe key unexpectedly exists'); },
        () => undefined,
      );
    },
    async put(key: string, body: Uint8Array): Promise<void> {
      await client.send(new PutObjectCommand({ Bucket: config.bucket, Key: key, Body: body }));
    },
    async head(key: string): Promise<'found' | 'missing'> {
      try {
        await client.send(new HeadObjectCommand({ Bucket: config.bucket, Key: key }));
        return 'found';
      } catch {
        return 'missing';
      }
    },
    async get(key: string): Promise<Uint8Array> {
      const response = await client.send(new GetObjectCommand({ Bucket: config.bucket, Key: key }));
      return response.Body?.transformToByteArray() ?? new Uint8Array(0);
    },
    async listPhysical(prefix: string): Promise<string[]> {
      const keys: string[] = [];
      let token: string | undefined;
      do {
        const page = await client.send(
          new ListObjectsV2Command({
            Bucket: config.bucket,
            Prefix: prefix,
            MaxKeys: 10,
            ContinuationToken: token,
          }),
        );
        for (const entry of page.Contents ?? []) {
          if (entry.Key) keys.push(entry.Key);
        }
        token = page.IsTruncated ? page.NextContinuationToken : undefined;
      } while (token);
      return keys;
    },
    async assertAnonymousDenied(key: string): Promise<void> {
      for (const method of ['PUT', 'GET'] as const) {
        const status = await anonymousRestStatus(config, key, method);
        if (status < 400) {
          throw new Error(`anonymous ${method} unexpectedly allowed (${status}) on ${config.bucket}`);
        }
      }
    },
    async cleanup(): Promise<void> {
      const keys = await this.listPhysical('');
      for (const key of keys) {
        await client.send(new DeleteObjectCommand({ Bucket: config.bucket, Key: key }));
      }
      await client.send(new DeleteBucketCommand({ Bucket: config.bucket })).catch(() => undefined);
    },
  };
};
