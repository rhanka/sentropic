import { describe, expect, it } from 'vitest';

import {
  describeAuthMaterial,
  getAuthDescriptor,
  getSecretAuthMaterial,
  type AuthResolution,
  type ClaudeCodeAccountAuthMaterial,
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
        provider: 'gemini-code-assist',
        status: 'planned',
      }),
    ).toEqual({
      ok: false,
      message: 'gemini-code-assist account transport is planned, not executable',
    });
  });
});

describe('claude-code-account auth material', () => {
  it('builds a descriptor for ClaudeCodeAccountAuthMaterial', () => {
    const material: ClaudeCodeAccountAuthMaterial = {
      type: 'claude-code-account',
      provider: 'claude-code',
      accessToken: 'sk-ant-oat-oauth-token',
      executableApiKey: 'sk-ant-api03-minted-key',
      organizationUuid: 'org_uuid_123',
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
      metadata: { organizationUuid: 'org_uuid_123' },
    });
  });

  it('rejects claude-code-account with an empty OAuth token', () => {
    expect(
      validateAdapterAuthSource({
        type: 'claude-code-account',
        provider: 'claude-code',
        accessToken: '   ',
      }),
    ).toEqual({ ok: false, message: 'Claude Code OAuth access token is empty' });
  });

  it('rejects raw Claude Code OAuth tokens as executable Anthropic API credentials', () => {
    expect(
      validateAdapterAuthSource({
        type: 'claude-code-account',
        provider: 'claude-code',
        accessToken: 'sk-ant-oat-raw-oauth-token',
      }),
    ).toEqual({
      ok: false,
      message: 'Claude Code OAuth token is not an Anthropic API key; gateway must mint an executable Claude API key before dispatch',
    });
  });

  it('accepts claude-code-account only after the gateway minted an executable API key', () => {
    expect(
      validateAdapterAuthSource({
        type: 'claude-code-account',
        provider: 'claude-code',
        accessToken: 'sk-ant-oat-raw-oauth-token',
        executableApiKey: 'sk-ant-api03-minted-key',
        organizationUuid: 'org_uuid_123',
      }),
    ).toEqual({
      ok: true,
      headers: {
        'x-api-key': 'sk-ant-api03-minted-key',
        'anthropic-version': '2023-06-01',
        'X-Organization-Uuid': 'org_uuid_123',
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
