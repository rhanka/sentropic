import { describe, expect, it } from 'vitest';

import {
  describeAuthMaterial,
  getAuthDescriptor,
  getSecretAuthMaterial,
  type AuthResolution,
  type SecretAuthMaterial,
} from '../src/auth.js';
import { validateAdapterAuthSource } from '../src/adapter-auth.js';

describe('auth descriptors', () => {
  it('builds a redacted descriptor for direct tokens', () => {
    const material: SecretAuthMaterial = {
      type: 'direct-token',
      token: 'secret-token',
      label: 'OpenAI prod',
    };

    expect(describeAuthMaterial(material)).toEqual({
      sourceType: 'direct-token',
      label: 'OpenAI prod',
    });
  });

  it('keeps descriptors separate from executable account material', () => {
    const resolution: AuthResolution = {
      material: {
        type: 'codex-account',
        provider: 'codex',
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
        accountId: 'acct_123',
        accountLabel: 'Fabien',
        expiresAt: '2026-04-24T18:00:00.000Z',
      },
      descriptor: {
        sourceType: 'codex-account',
        accountProviderId: 'codex',
        accountId: 'acct_123',
        accountLabel: 'Fabien',
        hasRefreshToken: true,
        expiresAt: '2026-04-24T18:00:00.000Z',
      },
    };

    expect(getSecretAuthMaterial(resolution)).toEqual(resolution.material);
    expect(getAuthDescriptor(resolution)).toEqual(resolution.descriptor);
  });
});

describe('adapter auth validation', () => {
  it('accepts a resolved workspace token without leaking the token reference', () => {
    const resolution: AuthResolution = {
      material: {
        type: 'workspace-token',
        workspaceId: 'ws_123',
        tokenRef: 'vault://workspace/openai',
      },
      descriptor: {
        sourceType: 'workspace-token',
        label: 'workspace key',
      },
    };

    expect(validateAdapterAuthSource(resolution)).toEqual({ ok: true });
  });

  it('rejects planned account transports without executable material', () => {
    expect(
      validateAdapterAuthSource({
        type: 'account-transport',
        provider: 'claude-code',
        status: 'planned',
      }),
    ).toEqual({
      ok: false,
      message: 'claude-code account transport is planned, not executable',
    });
  });
});
