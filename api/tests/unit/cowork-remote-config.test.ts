// Cowork remote config unit tests (BR-41d, Lot 1): default-off fail-closed
// resolution, per-value invalidation, tier derivation, key/number/file flags.
import { afterEach, describe, expect, it } from 'vitest';

import {
  COWORK_DEFAULT_BODY_LIMIT_BYTES,
  COWORK_DEFAULT_CAPTURE_TARGET_BYTES,
  COWORK_DEFAULT_MAX_TEXT_BYTES,
  deriveCoworkTier,
  resolveCoworkRemoteConfig,
} from '../../src/services/cowork-remote/config';

const KEYS = [
  'COWORK_REMOTE_ENABLED', 'COWORK_MCP_RESOURCE_URI', 'COWORK_MCP_AUTHORIZATION_SERVER_URL',
  'COWORK_MCP_ALLOWED_SCOPE', 'COWORK_OWNER_SUB', 'COWORK_MCP_CLIENT_ID', 'COWORK_OPERATION_HMAC_KEY',
  'COWORK_MCP_ALLOWED_ORIGINS', 'COWORK_MCP_MAX_TEXT_BYTES', 'COWORK_CAPTURE_TARGET_BYTES',
  'COWORK_FILE_STAGING_DIR', 'COWORK_FILE_TEXT_ENABLED', 'COWORK_MCP_BODY_LIMIT_BYTES',
];
const HMAC_32 = Buffer.from('0123456789abcdef0123456789abcdef').toString('base64url');
const BASE: Record<string, string> = {
  COWORK_MCP_AUTHORIZATION_SERVER_URL: 'https://preprod.auth.sent-tech.ca',
  COWORK_MCP_CLIENT_ID: 'client-1',
  COWORK_MCP_RESOURCE_URI: 'https://preprod.sentropic.sent-tech.ca/api/v1/cowork-mcp',
  COWORK_OPERATION_HMAC_KEY: HMAC_32,
  COWORK_OWNER_SUB: 'owner-1',
  COWORK_REMOTE_ENABLED: 'true',
};

const snapshot = (): Record<string, string | undefined> =>
  Object.fromEntries(KEYS.map((key) => [key, process.env[key]]));

let saved: Record<string, string | undefined> | null = null;

const applyEnv = (vars: Record<string, string> = {}): void => {
  saved ??= snapshot();
  for (const key of KEYS) delete process.env[key];
  for (const [key, value] of Object.entries(vars)) process.env[key] = value;
};

afterEach(() => {
  if (!saved) return;
  for (const key of KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
  saved = null;
});

describe('cowork remote config', () => {
  it('is disabled by default', () => {
    applyEnv();
    expect(resolveCoworkRemoteConfig()).toBeNull();
  });

  it('requires the flag to be exactly true', () => {
    for (const flag of ['1', 'yes', 'TRUE', '']) {
      applyEnv({ ...BASE, COWORK_REMOTE_ENABLED: flag });
      expect(resolveCoworkRemoteConfig()).toBeNull();
    }
  });

  it('resolves a complete preprod config with dossier defaults', () => {
    applyEnv(BASE);
    const config = resolveCoworkRemoteConfig();
    expect(config).toMatchObject({
      authorizationServer: 'https://preprod.auth.sent-tech.ca',
      fileTextEnabled: false,
      fileToolsEnabled: false,
      maxTextBytes: COWORK_DEFAULT_MAX_TEXT_BYTES,
      captureTargetBytes: COWORK_DEFAULT_CAPTURE_TARGET_BYTES,
      bodyLimitBytes: COWORK_DEFAULT_BODY_LIMIT_BYTES,
      resource: BASE.COWORK_MCP_RESOURCE_URI,
      scope: 'cowork:control',
      stagingDir: null,
      tier: 'preprod',
    });
    expect(config?.hmacKeyBytes.length).toBe(32);
  });

  it('disables on any missing or invalid required value', () => {
    const bad: Record<string, string>[] = [
      { ...BASE, COWORK_MCP_RESOURCE_URI: 'https://preprod.sentropic.sent-tech.ca/api/v1/cowork-mcp/' },
      { ...BASE, COWORK_MCP_RESOURCE_URI: 'https://preprod.sentropic.sent-tech.ca/api/v1/mcp' },
      { ...BASE, COWORK_MCP_RESOURCE_URI: 'http://preprod.sentropic.sent-tech.ca/api/v1/cowork-mcp' },
      { ...BASE, COWORK_MCP_RESOURCE_URI: 'https://unknown.example/api/v1/cowork-mcp' },
      { ...BASE, COWORK_MCP_RESOURCE_URI: 'not-a-url' },
      { ...BASE, COWORK_MCP_AUTHORIZATION_SERVER_URL: 'http://preprod.auth.sent-tech.ca' },
      { ...BASE, COWORK_MCP_ALLOWED_SCOPE: 'mcp:tools:invoke' },
      { ...BASE, COWORK_OPERATION_HMAC_KEY: Buffer.from('short').toString('base64url') },
      { ...BASE, COWORK_MCP_ALLOWED_ORIGINS: 'http://evil.example' },
      { ...BASE, COWORK_MCP_MAX_TEXT_BYTES: '0' },
      { ...BASE, COWORK_CAPTURE_TARGET_BYTES: 'abc' },
      { ...BASE, COWORK_MCP_BODY_LIMIT_BYTES: '-5' },
    ];
    for (const vars of bad) {
      applyEnv(vars);
      expect(resolveCoworkRemoteConfig()).toBeNull();
    }
    for (const missing of ['COWORK_MCP_RESOURCE_URI', 'COWORK_MCP_AUTHORIZATION_SERVER_URL', 'COWORK_OWNER_SUB', 'COWORK_MCP_CLIENT_ID', 'COWORK_OPERATION_HMAC_KEY']) {
      const vars = { ...BASE };
      delete vars[missing];
      applyEnv(vars);
      expect(resolveCoworkRemoteConfig()).toBeNull();
    }
  });

  it('derives the tier from the resource host', () => {
    expect(deriveCoworkTier('https://preprod.sentropic.sent-tech.ca/api/v1/cowork-mcp')).toBe('preprod');
    expect(deriveCoworkTier('https://sentropic.sent-tech.ca/api/v1/cowork-mcp')).toBe('prod');
    expect(deriveCoworkTier('https://other.example/api/v1/cowork-mcp')).toBeNull();
    expect(deriveCoworkTier('not-a-url')).toBeNull();
  });

  it('accepts extra origins, staging dir and file-text flag', () => {
    applyEnv({
      ...BASE,
      COWORK_CAPTURE_TARGET_BYTES: '51200',
      COWORK_FILE_STAGING_DIR: '/var/lib/sentropic/cowork-staging',
      COWORK_FILE_TEXT_ENABLED: 'true',
      COWORK_MCP_ALLOWED_ORIGINS: 'https://claude.ai, https://studio.example',
      COWORK_MCP_MAX_TEXT_BYTES: '16384',
    });
    const config = resolveCoworkRemoteConfig();
    expect(config?.allowedOrigins).toEqual(['https://claude.ai', 'https://studio.example']);
    expect(config?.fileToolsEnabled).toBe(true);
    expect(config?.stagingDir).toBe('/var/lib/sentropic/cowork-staging');
    expect(config?.fileTextEnabled).toBe(true);
    expect(config?.maxTextBytes).toBe(16384);
    expect(config?.captureTargetBytes).toBe(51200);
  });

  it('keeps file tools off without disabling on a relative staging dir', () => {
    applyEnv({ ...BASE, COWORK_FILE_STAGING_DIR: 'relative/path' });
    const config = resolveCoworkRemoteConfig();
    expect(config?.fileToolsEnabled).toBe(false);
    expect(config?.stagingDir).toBeNull();
  });
});
