import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import type { Server } from 'node:http';
import { serve } from '@hono/node-server';
import { S3Client } from '@aws-sdk/client-s3';
import { Pool } from 'pg';
import { compileArtifactsProfile, RADAR_ARTIFACTS_PROFILE } from '@sentropic/artifacts/mcp-core';
import { createPrivateArtifactStorage } from '../../../api/src/services/artifacts/lifecycle';
import { createContentRuntime } from './runtime';

/** TLS terminates at the dedicated W3.d ingress; Host is validated, forwarded identity is ignored. */
export async function startContentServer(options: {
  env?: NodeJS.ProcessEnv; hostname?: string; port?: number;
} = {}): Promise<Server> {
  const env = options.env ?? process.env;
  const enabled = () => env.APP_ARTIFACT_CONTENT_ENABLED === '1';
  const port = options.port ?? Number(env.ARTIFACT_CONTENT_PORT ?? '8791');
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Invalid content port');
  let pool: Pool | undefined;
  let s3: S3Client | undefined;
  let handle: (request: Request) => Promise<Response> = async () => new Response(null, {
    status: 404, headers: { 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' },
  });
  try {
    if (enabled()) {
      const required = (name: string) => {
        const value = env[name];
        if (!value) throw new Error(`${name} required for artifact content`);
        return value;
      };
      const connectionString = required('DATABASE_URL');
      const baseDomain = required('APP_ARTIFACT_CONTENT_BASE_DOMAIN');
      const keyFile = required('APP_ARTIFACT_CONTENT_SIGNING_KEY_FILE');
      const signingSecret = () => readFileSync(keyFile);
      if (signingSecret().length < 32) throw new Error('Dedicated content signing key must contain at least 32 bytes');
      const bucket = required('APP_ARTIFACT_S3_BUCKET');
      s3 = new S3Client({ region: required('APP_ARTIFACT_S3_REGION'), endpoint: env.APP_ARTIFACT_S3_ENDPOINT,
        forcePathStyle: !!env.APP_ARTIFACT_S3_ENDPOINT, credentials: {
          accessKeyId: required('APP_ARTIFACT_S3_ACCESS_KEY_ID'), secretAccessKey: required('APP_ARTIFACT_S3_SECRET_ACCESS_KEY'),
        } });
      const storage = await createPrivateArtifactStorage({ client: s3, bucket });
      pool = new Pool({ connectionString, max: 10 });
      const runtime = createContentRuntime({ pool, baseDomain, signingSecret, enabled,
        profileDigest: compileArtifactsProfile(RADAR_ARTIFACTS_PROFILE).profileDigest,
        blobs: { getBlob: key => storage.blobs.getBlob(key) } });
      handle = request => {
        if (new URL(request.url).pathname.startsWith('/_reader/') && env.APP_ARTIFACT_READER_ENABLED !== '1') {
          return Promise.resolve(new Response(null, { status: 404, headers: { 'cache-control': 'no-store' } }));
        }
        return runtime.fetch(request);
      };
    }
    const server = serve({ hostname: options.hostname ?? '0.0.0.0', port, fetch: request => {
      const url = new URL(request.url);
      if (url.pathname === '/healthz' && request.method === 'GET') return new Response('ok', {
        headers: { 'content-type': 'text/plain', 'cache-control': 'no-store' },
      });
      // The cleartext listener is internal-only. Never use X-Forwarded-Host/Proto as routing authority.
      url.protocol = 'https:';
      return handle(new Request(url, request));
    } }) as Server;
    server.once('close', () => { void pool?.end(); s3?.destroy(); });
    return await new Promise<Server>((resolve, reject) => {
      server.once('error', reject);
      server.once('listening', () => { server.removeListener('error', reject); resolve(server); });
    });
  } catch (error) { await pool?.end(); s3?.destroy(); throw error; }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startContentServer().then(server => {
    for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => server.close());
  }).catch(() => { console.error('Artifact content startup refused'); process.exitCode = 1; });
}
