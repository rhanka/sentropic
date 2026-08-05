import { describe, expect, it } from 'vitest';

import {
  accountTransportProviderIds,
  describeAuthMaterial,
  executableAccountTransportProviderIds,
  getAuthDescriptor,
  getSecretAuthMaterial,
  isCloudCodeRuntimeMetadata,
  type AuthResolution,
  type ClaudeCodeAccountAuthMaterial,
  type CloudCodeRuntimeMetadata,
  type SecretAuthMaterial,
} from '../src/auth.js';
import { validateAdapterAuthSource } from '../src/adapter-auth.js';

import * as authModule from '../src/auth.js';

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
        provider: 'cloud-code',
        status: 'planned',
      }),
    ).toEqual({
      ok: false,
      message: 'cloud-code account transport is planned, not executable',
    });

    expect(
      validateAdapterAuthSource({
        type: 'account-transport',
        provider: 'antigravity',
        status: 'planned',
      }),
    ).toEqual({
      ok: false,
      message: 'antigravity account transport is planned, not executable',
    });
  });
});

describe('claude-code-account auth material', () => {
  it('builds a descriptor for ClaudeCodeAccountAuthMaterial', () => {
    const material: ClaudeCodeAccountAuthMaterial = {
      type: 'claude-code-account',
      provider: 'claude-code',
      accessToken: 'sk-ant-access-token',
      accountId: 'acct_cc_123',
      accountLabel: 'Fabien (Claude Code)',
      expiresAt: '2026-12-31T00:00:00.000Z',
    };

    expect(describeAuthMaterial(material)).toEqual({
      sourceType: 'claude-code-account',
      accountProviderId: 'claude-code',
      accountId: 'acct_cc_123',
      accountLabel: 'Fabien (Claude Code)',
      expiresAt: '2026-12-31T00:00:00.000Z',
    });
  });

  it('rejects claude-code-account with an empty access token', () => {
    expect(
      validateAdapterAuthSource({
        type: 'claude-code-account',
        provider: 'claude-code',
        accessToken: '   ',
      }),
    ).toEqual({ ok: false, message: 'access token is empty' });
  });

  it('accepts claude-code-account with a valid access token and returns Anthropic OAuth headers', () => {
    expect(
      validateAdapterAuthSource({
        type: 'claude-code-account',
        provider: 'claude-code',
        accessToken: 'sk-ant-valid-token',
      }),
    ).toEqual({
      ok: true,
      headers: {
        'Authorization': 'Bearer sk-ant-valid-token',
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'oauth-2025-04-20',
      },
    });
  });

  it('accepts executable account transport material', () => {
    expect(
      validateAdapterAuthSource({
        type: 'account-transport',
        provider: 'claude-code',
        accessToken: 'claude-access-token',
        accountId: 'acct_claude',
      }),
    ).toEqual({ ok: true });
  });
});

describe('cloud-code account transport and runtime metadata', () => {
  it('includes cloud-code and excludes gemini-code-assist in provider lists', () => {
    expect(accountTransportProviderIds).toContain('cloud-code');
    expect((accountTransportProviderIds as readonly string[])).not.toContain('gemini-code-assist');

    expect(executableAccountTransportProviderIds).toContain('cloud-code');
    expect((executableAccountTransportProviderIds as readonly string[])).not.toContain('gemini-code-assist');

    expect('futureAccountTransportProviderIds' in authModule).toBe(false);
  });

  it('validates CloudCodeRuntimeMetadata with isCloudCodeRuntimeMetadata guard', () => {
    const validMetadata: CloudCodeRuntimeMetadata = {
      cloudaicompanionProject: 'test-project-123',
      cloudCodeUserAgentVersion: '1.1.10',
      authClientConfigVersion: 'v1.0.0',
    };

    expect(isCloudCodeRuntimeMetadata(validMetadata)).toBe(true);

    expect(isCloudCodeRuntimeMetadata(null)).toBe(false);
    expect(isCloudCodeRuntimeMetadata(undefined)).toBe(false);
    expect(isCloudCodeRuntimeMetadata('string')).toBe(false);
    expect(isCloudCodeRuntimeMetadata({})).toBe(false);

    expect(
      isCloudCodeRuntimeMetadata({
        cloudaicompanionProject: '',
        cloudCodeUserAgentVersion: '1.1.10',
        authClientConfigVersion: 'v1.0.0',
      }),
    ).toBe(false);

    expect(
      isCloudCodeRuntimeMetadata({
        cloudaicompanionProject: 'test-project',
        cloudCodeUserAgentVersion: '   ',
        authClientConfigVersion: 'v1.0.0',
      }),
    ).toBe(false);

    expect(
      isCloudCodeRuntimeMetadata({
        cloudaicompanionProject: 'test-project',
        cloudCodeUserAgentVersion: '1.1.10',
        authClientConfigVersion: 123,
      }),
    ).toBe(false);
  });
});
