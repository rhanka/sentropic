import { createHash } from 'node:crypto';

/**
 * Governed `client_credentials` service-client provisioning: pure env parsing and
 * planning, no database access. The DB write lives in `scripts/oauth-register-service-client.ts`.
 */

/** Scopes a service client may hold; each is required by an S2S guard of this host. */
export const KNOWN_SERVICE_CLIENT_SCOPES: readonly string[] = Object.freeze([
  'service:ping', // /api/v1/auth/s2s/ping
  'remote.evidence.issue', // remote IdP evidence issuance
  'remote.sessions.revoke', // remote session revocation
  'github-app:broker', // GitHub App broker mount
  'artifacts:builder', // artifact builder mount
]);

/** Exchange-only workload, created and rotated only by the named-Secret identity sync. */
export const RESERVED_SERVICE_CLIENT_IDS: readonly string[] = Object.freeze(['immo-mcp-workload']);

export const SERVICE_CLIENT_ROTATION_DAYS = 90;

const CLIENT_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{2,63}$/;
const SECRET_PATTERN = /^[\x21-\x7e]{32,512}$/;
const LOOPBACK_HOST = /^(localhost|127\.0\.0\.1|\[::1\])$/;

export const hashServiceClientSecret = (secret: string): string =>
  createHash('sha256').update(secret).digest('hex');

const parseList = (value: string | undefined): string[] => [
  ...new Set((value ?? '').split(',').map((item) => item.trim()).filter(Boolean)),
];

const trimTrailingSlash = (value: string): string => value.replace(/\/+$/, '');

const parseFlag = (source: NodeJS.ProcessEnv, name: string): boolean => {
  const value = (source[name] ?? '').trim();
  if (value === '' || value === 'false') return false;
  if (value === 'true') return true;
  throw new Error(`${name} must be "true" or "false"`);
};

const isResourceUri = (value: string): boolean => {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hash === '' && !LOOPBACK_HOST.test(url.hostname);
  } catch {
    return false;
  }
};

export interface DesiredServiceClient {
  allowedScopes: string[];
  clientId: string;
  clientSecretHash: string;
  displayName: string;
  dpopBoundAccessTokens: boolean;
  flags: { allowDowngrade: boolean; allowWiden: boolean; rotateSecret: boolean };
  resourceIndicators: string[];
  tenantSlug: string;
}

/** Parse the OAUTH_SERVICE_CLIENT_* env (see the script header) with every prod-safe guard. */
export const buildServiceClientRegistration = (source: NodeJS.ProcessEnv): DesiredServiceClient => {
  const clientId = (source.OAUTH_SERVICE_CLIENT_ID ?? '').trim();
  if (!CLIENT_ID_PATTERN.test(clientId)) {
    throw new Error('OAUTH_SERVICE_CLIENT_ID must match [a-z0-9][a-z0-9._-]{2,63}');
  }
  if (RESERVED_SERVICE_CLIENT_IDS.includes(clientId)) {
    throw new Error(`Refusing reserved client id ${clientId}: the identity sync governs it (CRED_CYCLE.md).`);
  }

  const secret = source.OAUTH_SERVICE_CLIENT_SECRET ?? '';
  if (!SECRET_PATTERN.test(secret) || /dev-only/i.test(secret)) {
    throw new Error('OAUTH_SERVICE_CLIENT_SECRET must be a generated secret of 32-512 printable characters without whitespace.');
  }

  const allowedScopes = parseList(source.OAUTH_SERVICE_CLIENT_SCOPES);
  if (allowedScopes.length === 0) throw new Error('OAUTH_SERVICE_CLIENT_SCOPES must list at least one scope');
  const unknownScopes = allowedScopes.filter((scope) => !KNOWN_SERVICE_CLIENT_SCOPES.includes(scope));
  if (unknownScopes.length > 0) {
    throw new Error(`Refusing unknown service scopes: ${unknownScopes.join(', ')}. Known: ${KNOWN_SERVICE_CLIENT_SCOPES.join(', ')}.`);
  }

  // Default audience = the resource this API accepts on S2S tokens (OAUTH_SERVICE_RESOURCE_URI),
  // else its public issuer origin (AUTH_CALLBACK_BASE_URL), trailing slash trimmed like the API.
  const explicit = parseList(source.OAUTH_SERVICE_CLIENT_RESOURCE_INDICATORS);
  const fallback = (source.OAUTH_SERVICE_RESOURCE_URI || source.AUTH_CALLBACK_BASE_URL || '').trim();
  const resourceIndicators = [...new Set((explicit.length > 0 ? explicit : [fallback].filter(Boolean)).map(trimTrailingSlash))];
  if (resourceIndicators.length === 0) {
    throw new Error('No resource indicator: set OAUTH_SERVICE_CLIENT_RESOURCE_INDICATORS, OAUTH_SERVICE_RESOURCE_URI or AUTH_CALLBACK_BASE_URL.');
  }
  const invalid = resourceIndicators.filter((uri) => !isResourceUri(uri));
  if (invalid.length > 0) {
    throw new Error(`Refusing invalid resource indicators: ${invalid.join(', ')}. Use absolute non-loopback https:// URIs without fragment.`);
  }

  return {
    allowedScopes,
    clientId,
    clientSecretHash: hashServiceClientSecret(secret),
    displayName: (source.OAUTH_SERVICE_CLIENT_NAME || clientId).trim(),
    dpopBoundAccessTokens: parseFlag(source, 'OAUTH_SERVICE_CLIENT_DPOP'),
    flags: {
      allowDowngrade: parseFlag(source, 'OAUTH_SERVICE_CLIENT_ALLOW_DOWNGRADE'),
      allowWiden: parseFlag(source, 'OAUTH_SERVICE_CLIENT_ALLOW_WIDEN'),
      rotateSecret: parseFlag(source, 'OAUTH_SERVICE_CLIENT_ROTATE_SECRET'),
    },
    resourceIndicators,
    tenantSlug: (source.OAUTH_SERVICE_CLIENT_TENANT || 'sentropic').trim(),
  };
};
