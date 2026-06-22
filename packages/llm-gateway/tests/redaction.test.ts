/**
 * Lot-2: redaction (spec §3/§4/§8). Pooled creds/ids/tokens must NEVER appear in
 * log-safe views or anything the gateway emits. Asserts the redaction helpers
 * and the kill-switch guard.
 */

import { describe, expect, it } from 'vitest';

import type { AuthDescriptor, SecretAuthMaterial } from '@sentropic/llm-mesh';
import {
  CoordinatorPoolState,
  GatewayError,
  fingerprint,
  redactForLog,
  redactSelection,
} from '../src/index.js';
import { InMemoryAccountTransportCoordinator } from '@sentropic/llm-mesh';

describe('redaction helpers', () => {
  it('fingerprints a token without revealing any byte of it', () => {
    const fp = fingerprint('SECRET-ALPHA-TOKEN-xyz');
    expect(fp).not.toContain('SECRET');
    expect(fp).not.toContain('ALPHA');
    expect(fp.startsWith('fp_')).toBe(true);
    // Stable + distinguishing.
    expect(fingerprint('SECRET-ALPHA-TOKEN-xyz')).toBe(fp);
    expect(fingerprint('SECRET-BETA-TOKEN-xyz')).not.toBe(fp);
    expect(fingerprint(undefined)).toBe('none');
  });

  it('redactSelection exposes only descriptor + fingerprint, never the token', () => {
    const material: SecretAuthMaterial = {
      type: 'account-transport',
      provider: 'claude-code',
      accessToken: 'SECRET-ALPHA-TOKEN-xyz',
      refreshToken: 'SECRET-ALPHA-REFRESH-xyz',
      accountId: 'acct-alpha',
    };
    const descriptor: AuthDescriptor = {
      sourceType: 'account-transport',
      accountProviderId: 'claude-code',
      accountId: 'acct-alpha',
      hasRefreshToken: true,
      metadata: { leaseId: 'lease_1' },
    };
    const view = redactSelection(descriptor, material);
    const serialized = JSON.stringify(view);
    expect(serialized).not.toContain('SECRET-ALPHA-TOKEN-xyz');
    expect(serialized).not.toContain('SECRET-ALPHA-REFRESH-xyz');
    expect(view.hasRefreshToken).toBe(true);
    expect(view.leaseId).toBe('lease_1');
    expect(view.provider).toBe('claude-code');
  });

  it('redactForLog deep-scrubs secret-bearing keys', () => {
    const scrubbed = redactForLog({
      accessToken: 'SECRET-ALPHA-TOKEN-xyz',
      nested: { refreshToken: 'SECRET-ALPHA-REFRESH-xyz', model: 'claude-sonnet-4-6' },
      headers: { Authorization: 'Bearer SECRET' },
    });
    const serialized = JSON.stringify(scrubbed);
    expect(serialized).not.toContain('SECRET-ALPHA-TOKEN-xyz');
    expect(serialized).not.toContain('SECRET-ALPHA-REFRESH-xyz');
    expect(serialized).not.toContain('Bearer SECRET');
    // Non-secret fields survive.
    expect(serialized).toContain('claude-sonnet-4-6');
  });
});

describe('kill-switch guard (cross-user disabled while OFF)', () => {
  it('rejects a grant-carrying selection while crossUserPoolEnabled is OFF', async () => {
    const coordinator = new InMemoryAccountTransportCoordinator([
      {
        accountId: 'acct-x',
        targetProviderId: 'anthropic',
        transportProviderId: 'claude-code',
        accessToken: 'SECRET-X',
        status: 'active',
      },
    ]);
    const pool = new CoordinatorPoolState({ coordinator, crossUserPoolEnabled: false });

    await expect(
      pool.select({
        cost: {
          tenantId: 't',
          principalId: 'p',
          source: 'layer-c',
          correlationId: 'c',
        },
        targetProviderId: 'anthropic',
        transportProviderId: 'claude-code',
        modelId: 'claude-sonnet-4-6',
        authorization: {
          mode: 'direct',
          responsibleProvider: { providerSubjectId: 'other-user' },
        },
      }),
    ).rejects.toBeInstanceOf(GatewayError);
  });

  it('allows a personal-passthrough selection (no grant) while OFF', async () => {
    const coordinator = new InMemoryAccountTransportCoordinator([
      {
        accountId: 'acct-x',
        targetProviderId: 'anthropic',
        transportProviderId: 'claude-code',
        accessToken: 'SECRET-X',
        status: 'active',
      },
    ]);
    const pool = new CoordinatorPoolState({ coordinator, crossUserPoolEnabled: false });
    const selection = await pool.select({
      cost: { tenantId: 't', principalId: 'p', source: 'layer-c', correlationId: 'c' },
      targetProviderId: 'anthropic',
      transportProviderId: 'claude-code',
      modelId: 'claude-sonnet-4-6',
    });
    expect(selection.acquisition.descriptor.accountId).toBe('acct-x');
    // Settle the lease so the test leaves no dangling reservation.
    await selection.acquisition.recordOutcome({ status: 'success' });
  });
});
