import { S3Client } from '@aws-sdk/client-s3';
import type { Context } from 'hono';
import type { PublicationBlobStore } from '@sentropic/artifacts/server/publication';
import { pool } from '../../db/client';
import { env } from '../../config/env';
import { resolveOAuthIssuer } from '../../routes/auth/oauth';
import { isOriginAllowed, parseAllowedOrigins } from '../../utils/cors';
import { resolveTenantAuthoritatively } from '../tenancy/resolve-tenant';
import { createArtifactHost } from './composition';
import { createPrivateArtifactStorage } from './lifecycle';
import { artifactCredential, ARTIFACT_SESSION_CLIENT, createCurrentArtifactIdentity } from './credentials';
import { createArtifactTransport } from './transport';

export const artifactHostEnabled = () => process.env.APP_ARTIFACT_HOST_ENABLED === '1';
const resource = env.MCP_RESOURCE_URI ?? `${resolveOAuthIssuer()}/api/v1/mcp`;
const quotaBytes = Number(process.env.APP_ARTIFACT_QUOTA_BYTES ?? '0');
if (artifactHostEnabled() && (!Number.isSafeInteger(quotaBytes) || quotaBytes <= 0)) {
  throw new Error('APP_ARTIFACT_QUOTA_BYTES must explicitly configure the enabled host');
}
let storage: ReturnType<typeof createPrivateArtifactStorage> | undefined;
function privateStorage() {
  if (!artifactHostEnabled()) throw new Error('Artifact host is disabled');
  if (!storage) {
    const bucket = process.env.APP_ARTIFACT_S3_BUCKET;
    const region = process.env.APP_ARTIFACT_S3_REGION;
    const accessKeyId = process.env.APP_ARTIFACT_S3_ACCESS_KEY_ID;
    const secretAccessKey = process.env.APP_ARTIFACT_S3_SECRET_ACCESS_KEY;
    if (!bucket || !region || !accessKeyId || !secretAccessKey) throw new Error('Dedicated private artifact storage required');
    storage = createPrivateArtifactStorage({ bucket, client: new S3Client({ region,
      endpoint: process.env.APP_ARTIFACT_S3_ENDPOINT, forcePathStyle: !!process.env.APP_ARTIFACT_S3_ENDPOINT,
      credentials: { accessKeyId, secretAccessKey } }) }).catch(error => { storage = undefined; throw error; });
  }
  return storage;
}
const blobs: PublicationBlobStore = {
  putBlob: async (key, bytes) => (await privateStorage()).blobs.putBlob(key, bytes),
  getBlob: async key => (await privateStorage()).blobs.getBlob(key),
  deleteBlob: async key => (await privateStorage()).blobs.deleteBlob(key),
  listKeys: async prefix => (await privateStorage()).blobs.listKeys(prefix),
};

export const productArtifactHost = createArtifactHost({ pool, blobs, quotaBytes,
  currentIdentity: createCurrentArtifactIdentity(resource) });
export const productArtifactTransport = createArtifactTransport(productArtifactHost);

/** The resources module runs requireAuth first; request bodies supply no identity. */
export async function resolveArtifactSession(context: Context) {
  const user = context.get('user');
  if (!user?.sessionId || !user.workspaceId) return null;
  if (context.req.method === 'POST' && context.req.header('cookie')) {
    const origin = context.req.header('origin');
    if (!origin || !isOriginAllowed(origin, parseAllowedOrigins(env.CORS_ALLOWED_ORIGINS))) {
      throw new Error('Artifact session origin refused');
    }
  }
  const tenant = await resolveTenantAuthoritatively({ userId: user.userId, workspaceId: user.workspaceId });
  if ('error' in tenant) return null;
  return { workspaceId: user.workspaceId, identity: { subject: user.userId, tenantId: tenant.tenantId,
    clientId: ARTIFACT_SESSION_CLIENT, credentialId: artifactCredential('session', user.sessionId) } };
}
