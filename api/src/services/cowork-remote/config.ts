// Cowork remote MCP fail-closed config (BR-41d, INV-03). Resolved per request
// from process.env, then the parsed env (mcp.ts isEnabled pattern) so tests
// toggle in-process. Missing/invalid required value disables Cowork (null).

import { env } from '../../config/env';

export const COWORK_CONTROL_SCOPE = 'cowork:control';
export const COWORK_MCP_PATH = '/api/v1/cowork-mcp';
export const COWORK_DEFAULT_MAX_TEXT_BYTES = 32768;
export const COWORK_DEFAULT_CAPTURE_TARGET_BYTES = 102400;
export const COWORK_DEFAULT_BODY_LIMIT_BYTES = 1048576;
export const COWORK_MIN_HMAC_KEY_BYTES = 32;

export type CoworkTier = 'preprod' | 'prod';

export interface CoworkRemoteConfig {
  tier: CoworkTier;
  resource: string;
  authorizationServer: string;
  scope: typeof COWORK_CONTROL_SCOPE;
  ownerSub: string;
  clientId: string;
  hmacKeyBytes: Uint8Array;
  allowedOrigins: string[];
  maxTextBytes: number;
  captureTargetBytes: number;
  bodyLimitBytes: number;
  stagingDir: string | null;
  fileToolsEnabled: boolean;
  fileTextEnabled: boolean;
}

const read = (key: string): string | undefined => {
  const fromProcess = process.env[key];
  if (fromProcess !== undefined) return fromProcess;
  const fromEnv = env[key as keyof typeof env] as unknown;
  return typeof fromEnv === 'string' ? fromEnv : undefined;
};

const readNumber = (key: string): number | undefined => {
  const raw = (process.env[key] ?? env[key as keyof typeof env]) as unknown;
  if (raw === undefined || raw === '') return undefined;
  const parsed = typeof raw === 'number' ? raw : Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : NaN;
};

export const deriveCoworkTier = (resource: string): CoworkTier | null => {
  let host = '';
  try {
    host = new URL(resource).host;
  } catch {
    return null;
  }
  if (host === 'preprod.sentropic.sent-tech.ca') return 'preprod';
  return host === 'sentropic.sent-tech.ca' ? 'prod' : null;
};

const decodeHmacKey = (value: string): Uint8Array | null => {
  try {
    const bytes = Buffer.from(value.replace(/-/gu, '+').replace(/_/gu, '/'), 'base64');
    return bytes.length >= COWORK_MIN_HMAC_KEY_BYTES ? new Uint8Array(bytes) : null;
  } catch {
    return null;
  }
};

const parseOrigins = (value: string | undefined): string[] | null => {
  if (value === undefined || value === '') return [];
  const origins = value.split(',').map((entry) => entry.trim()).filter(Boolean);
  return origins.every((origin) => /^https:\/\/[^/]+$/u.test(origin)) ? origins : null;
};

/** Null = Cowork disabled (fail-closed). Never throws. */
export const resolveCoworkRemoteConfig = (): CoworkRemoteConfig | null => {
  try {
    if (read('COWORK_REMOTE_ENABLED') !== 'true') return null;
    const resource = read('COWORK_MCP_RESOURCE_URI');
    if (!resource || resource !== resource.replace(/\/+$/u, '')) return null;
    let resourceUrl: URL;
    try {
      resourceUrl = new URL(resource);
    } catch {
      return null;
    }
    if (resourceUrl.protocol !== 'https:') return null;
    if (resourceUrl.pathname !== COWORK_MCP_PATH) return null;
    const tier = deriveCoworkTier(resource);
    if (!tier) return null;
    const authorizationServer = read('COWORK_MCP_AUTHORIZATION_SERVER_URL');
    if (!authorizationServer || !/^https:\/\/[^/]+$/u.test(authorizationServer)) return null;
    const scope = read('COWORK_MCP_ALLOWED_SCOPE') ?? COWORK_CONTROL_SCOPE;
    if (scope !== COWORK_CONTROL_SCOPE) return null;
    const ownerSub = read('COWORK_OWNER_SUB');
    if (!ownerSub) return null;
    const clientId = read('COWORK_MCP_CLIENT_ID');
    if (!clientId) return null;
    const hmacKey = read('COWORK_OPERATION_HMAC_KEY');
    const hmacKeyBytes = hmacKey ? decodeHmacKey(hmacKey) : null;
    if (!hmacKeyBytes) return null;
    const allowedOrigins = parseOrigins(read('COWORK_MCP_ALLOWED_ORIGINS'));
    if (!allowedOrigins) return null;
    const maxTextBytes = readNumber('COWORK_MCP_MAX_TEXT_BYTES') ?? COWORK_DEFAULT_MAX_TEXT_BYTES;
    const captureTargetBytes = readNumber('COWORK_CAPTURE_TARGET_BYTES') ?? COWORK_DEFAULT_CAPTURE_TARGET_BYTES;
    const bodyLimitBytes = readNumber('COWORK_MCP_BODY_LIMIT_BYTES') ?? COWORK_DEFAULT_BODY_LIMIT_BYTES;
    if (!Number.isInteger(maxTextBytes) || !Number.isInteger(captureTargetBytes) || !Number.isInteger(bodyLimitBytes)) return null;
    const stagingDir = read('COWORK_FILE_STAGING_DIR') ?? null;
    const fileToolsEnabled = stagingDir !== null && stagingDir.startsWith('/');
    return {
      allowedOrigins,
      authorizationServer,
      bodyLimitBytes,
      captureTargetBytes,
      clientId,
      fileTextEnabled: read('COWORK_FILE_TEXT_ENABLED') === 'true',
      fileToolsEnabled,
      hmacKeyBytes,
      maxTextBytes,
      ownerSub,
      resource,
      scope: COWORK_CONTROL_SCOPE,
      stagingDir: fileToolsEnabled ? stagingDir : null,
      tier,
    };
  } catch {
    return null;
  }
};
