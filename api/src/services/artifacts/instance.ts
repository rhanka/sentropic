import { S3Client } from '@aws-sdk/client-s3';
import type { Context } from 'hono';
import type { PublicationBlobStore } from '@sentropic/artifacts/server/publication';
import { pool } from '../../db/client';
import { env } from '../../config/env';
import { resolveOAuthIssuer } from '../../routes/auth/oauth';
import { isOriginAllowed, parseAllowedOrigins } from '../../utils/cors';
import { resolveCmTenant } from '../identity/cm-tenancy';
import { createArtifactHost } from './composition';
import { createPrivateArtifactStorage } from './lifecycle';
import { artifactCredential, ARTIFACT_SESSION_CLIENT, createCurrentArtifactIdentity } from './credentials';
import { createArtifactTransport } from './transport';
import { createArtifactReaderActivation } from './reader-activation';
import { createPostgresReaderConsentStore } from '@sentropic/artifacts/adapters/postgres-reader-consent';
import { assertConsentScopeId, assertConsentScopeVersion } from '@sentropic/artifacts/server/consent';
import { createReaderConsentService } from './reader-consent';
import type { ArtifactHttpPorts } from '../../routes/namespaces/artifacts';

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

export const artifactReaderEnabled = () => artifactHostEnabled() && process.env.APP_ARTIFACT_READER_ENABLED === '1';
let reader: ReturnType<typeof createArtifactReaderActivation> | undefined;
/** W3.b supplies verified session and content-origin browser proof to this internal port. */
export function getProductArtifactReader() {
  if (!artifactReaderEnabled()) throw new Error('Artifact reader is disabled');
  const baseDomain = process.env.APP_ARTIFACT_CONTENT_BASE_DOMAIN;
  if (!baseDomain) throw new Error('Approved artifact content base domain required');
  return reader ??= createArtifactReaderActivation({ pool, baseDomain,
    profileDigest: productArtifactHost.profile.profileDigest });
}
/**
 * J1.3b — host-declared consent scopes for the generic grant contract, from
 * `APP_ARTIFACT_CONSENT_SCOPES` as `scopeId@scopeVersion` entries. Empty until
 * the host declares scopes: the grant route stays fail-closed.
 */
function declaredConsentScopes(): { scopeId: string; scopeVersion: string }[] {
  const raw = process.env.APP_ARTIFACT_CONSENT_SCOPES;
  if (!raw) return [];
  return raw.split(',').map((entry) => entry.trim()).filter((entry) => entry.length > 0).map((entry) => {
    const at = entry.indexOf('@');
    const scopeId = at === -1 ? '' : entry.slice(0, at);
    const scopeVersion = at === -1 ? '' : entry.slice(at + 1);
    assertConsentScopeId(scopeId);
    assertConsentScopeVersion(scopeVersion);
    return { scopeId, scopeVersion };
  });
}

export const productArtifactReaderConsentPort: NonNullable<ArtifactHttpPorts['readerConsent']> = {
  enabled: artifactReaderEnabled,
  get controlOrigin() {
    if (!process.env.UI_BASE_URL) throw new Error('Approved reader control origin required');
    return new URL(process.env.UI_BASE_URL).origin;
  },
  get declaredScopes() {
    return declaredConsentScopes();
  },
  get consentScreen() {
    return { brand: process.env.APP_ARTIFACT_CONSENT_BRAND ?? 'Artifacts',
      title: process.env.APP_ARTIFACT_CONSENT_TITLE ?? 'Allow reader access',
      ...(process.env.APP_ARTIFACT_CONSENT_SUPPORT_URL === undefined
        ? {} : { supportUrl: process.env.APP_ARTIFACT_CONSENT_SUPPORT_URL }) };
  },
  /** One service per bound session: scope, readability and titles resolve under that session. */
  async service({ identity, workspaceId }, admin) {
    const host = await productArtifactHost.bind(identity, workspaceId);
    return createReaderConsentService({
      store: createPostgresReaderConsentStore(pool),
      storageScopeId: host.invocation.storageScopeId,
      canReadArtifact: async (artifactId, readerAccountId) => {
        if (readerAccountId !== identity.subject) return false;
        const result = await host.http({ method: 'GET', path: `/meta/${artifactId}`, body: undefined });
        return result.status === 200;
      },
      isAdmin: async () => admin,
      resolveTitle: async (artifactId) =>
        (await productArtifactHost.store.getArtifactAcl(artifactId))?.metadata?.title,
    });
  },
};
export const productArtifactReaderPort: NonNullable<ArtifactHttpPorts['reader']> = {
  enabled: artifactReaderEnabled,
  get controlOrigin() {
    if (!process.env.UI_BASE_URL) throw new Error('Approved reader control origin required');
    return new URL(process.env.UI_BASE_URL).origin;
  },
  async issue({ identity, workspaceId }, target) {
    const credential: unknown = JSON.parse(identity.credentialId);
    if (identity.clientId !== ARTIFACT_SESSION_CLIENT || !Array.isArray(credential) || credential.length !== 4 ||
      credential[0] !== 'session' || typeof credential[1] !== 'string' || !credential[1] ||
      credential[2] !== null || !Array.isArray(credential[3]) || credential[3].length !== 0) {
      throw new Error('Artifact reader requires the current app session');
    }
    return getProductArtifactReader().issue({ subjectId: identity.subject, sessionId: credential[1],
      tenantId: identity.tenantId, workspaceId }, target);
  },
};

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
  const tenant = await resolveCmTenant({ userId: user.userId, workspaceId: user.workspaceId });
  if ('error' in tenant) return null;
  return { workspaceId: user.workspaceId, identity: { subject: user.userId, tenantId: tenant.tenantId,
    clientId: ARTIFACT_SESSION_CLIENT, credentialId: artifactCredential('session', user.sessionId) } };
}
