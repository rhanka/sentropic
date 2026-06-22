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
  newCorrelationId,
  redactForLog,
  redactSelection,
} from '../src/index.js';
import { InMemoryAccountTransportCoordinator } from '@sentropic/llm-mesh';

describe('redaction helpers', () => {
  it('mints an opaque correlation id not derived from any pool id', () => {
    const a = newCorrelationId();
    const b = newCorrelationId();
    // Opaque + gateway-local: never reuses an account id / lease id verbatim.
    expect(a.startsWith('gw_')).toBe(true);
    expect(a).not.toContain('acct-');
    expect(a).not.toContain('lease');
    // Distinct per call (cannot pin two unrelated calls to the same lease).
    expect(a).not.toBe(b);
  });

  it('redactSelection exposes only coarse metadata + opaque id, never tokens or pool ids', () => {
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
    // B2: NO pool-internal id (raw account id, lease id) reaches the view.
    expect(serialized).not.toContain('acct-alpha');
    expect(serialized).not.toContain('lease_1');
    expect(serialized).not.toContain('leaseId');
    expect(serialized).not.toContain('lease');
    expect(view.correlationId.startsWith('gw_')).toBe(true);
    expect(view.hasRefreshToken).toBe(true);
    expect(view.provider).toBe('claude-code');
    // The view no longer carries a `leaseId` key at all.
    expect('leaseId' in view).toBe(false);
  });

  it('redactForLog deep-scrubs secret-bearing keys with a fixed mask (non-reversible)', () => {
    const scrubbed = redactForLog({
      accessToken: 'SECRET-ALPHA-TOKEN-xyz',
      nested: { refreshToken: 'SECRET-ALPHA-REFRESH-xyz', model: 'claude-sonnet-4-6' },
      headers: { Authorization: 'Bearer SECRET' },
    });
    const serialized = JSON.stringify(scrubbed);
    expect(serialized).not.toContain('SECRET-ALPHA-TOKEN-xyz');
    expect(serialized).not.toContain('SECRET-ALPHA-REFRESH-xyz');
    expect(serialized).not.toContain('Bearer SECRET');
    // Fixed mask, not a length-leaking fingerprint.
    expect((scrubbed as { accessToken: string }).accessToken).toBe('[redacted]');
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
          authzMode: 'direct',
          providerIdentity: { providerSubjectId: 'other-user' },
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
