/**
 * B1 — caller==provider (caller-owned accounts), enforced gateway-side (spec §7
 * personal-passthrough). llm-mesh's `acquire()` selects over EVERY account in its
 * coordinator and ignores `userId`; its sticky lease key omits the caller. The
 * gateway is the only layer that knows OWNERSHIP, so it enforces caller==provider
 * mechanically:
 *   - a caller selects ONLY over accounts they own (`metadata.ownerUserId`);
 *   - a caller who owns nothing is denied (never falls through to another pool);
 *   - the sticky lease is caller-partitioned (same affinity, different callers ->
 *     different accounts).
 *
 * These run the REAL router over fixtures (no network, no docker).
 */

import { describe, expect, it } from 'vitest';

import type { AccountTransportAccount } from '@sentropic/llm-mesh';
import { CoordinatorPoolState } from '../src/index.js';
import { FixtureTransport } from './fixtures/transport.js';
import { authHeaders, buildHarness } from './fixtures/harness.js';
import { anthropicMessageResponse, anthropicRequest } from './fixtures/anthropic.js';

/** One Claude-Code account owned by `owner`, with a distinct token/id. */
const accountFor = (owner: string, suffix: string): AccountTransportAccount => ({
  accountId: `acct-${suffix}`,
  accountLabel: suffix,
  targetProviderId: 'anthropic',
  transportProviderId: 'claude-code',
  accessToken: `SECRET-${suffix.toUpperCase()}-TOKEN`,
  refreshToken: `SECRET-${suffix.toUpperCase()}-REFRESH`,
  status: 'active',
  priority: 10,
  modelIds: ['claude-sonnet-4-6'],
  metadata: { ownerUserId: owner },
});

const accountIdOf = (material: unknown): string | undefined =>
  material && typeof material === 'object' && 'accountId' in material
    ? (material as { accountId?: string }).accountId
    : undefined;

describe('B1 caller==provider — caller-owned account selection', () => {
  it('caller-b NEVER selects caller-a\'s account (deny-as-missing)', async () => {
    // Pool holds ONLY user-a's account. user-b owns nothing here.
    const transport = new FixtureTransport({
      jsonResponse: { status: 200, body: anthropicMessageResponse },
    });
    const { app } = buildHarness({
      transport,
      accounts: [accountFor('user-a', 'alpha')],
    });

    // user-b authenticates fine (valid token) but owns NO matching account.
    const res = await app.request('/v1/messages', {
      method: 'POST',
      headers: authHeaders('user-b'),
      body: JSON.stringify(anthropicRequest(false)),
    });

    // Denied as no-eligible-account (provider overloaded), never caller-a's pool.
    expect(res.status).toBe(429);
    const body = (await res.json()) as { error: { type: string } };
    expect(body.error.type).toBe('overloaded_error');
    // caller-a's account/credential was NEVER touched.
    expect(transport.seenMaterials).toHaveLength(0);
    const text = JSON.stringify(body);
    expect(text).not.toContain('acct-alpha');
    expect(text).not.toContain('SECRET-ALPHA-TOKEN');
  });

  it('each caller selects ONLY their own account in a shared pool', async () => {
    const transport = new FixtureTransport({
      jsonResponse: { status: 200, body: anthropicMessageResponse },
    });
    // One pool, two callers, each owning a distinct account.
    const { app } = buildHarness({
      transport,
      accounts: [accountFor('user-a', 'alpha'), accountFor('user-b', 'beta')],
    });

    await app.request('/v1/messages', {
      method: 'POST',
      headers: authHeaders('user-a', 'aff'),
      body: JSON.stringify(anthropicRequest(false)),
    });
    await app.request('/v1/messages', {
      method: 'POST',
      headers: authHeaders('user-b', 'aff'),
      body: JSON.stringify(anthropicRequest(false)),
    });

    const ids = transport.seenMaterials.map(accountIdOf);
    expect(ids).toEqual(['acct-alpha', 'acct-beta']);
    // Same affinity key ('aff') across the two callers, yet DIFFERENT accounts:
    // the sticky lease is caller-partitioned (B1 per-caller affinity key).
    expect(new Set(ids).size).toBe(2);
  });

  it('listEligibleAccounts returns only the verified caller\'s accounts', async () => {
    const pool = new CoordinatorPoolState({
      accounts: [accountFor('user-a', 'alpha'), accountFor('user-b', 'beta')],
    });
    const eligible = await pool.listEligibleAccounts({
      cost: { tenantId: 't', principalId: 'user-a', source: 'layer-c', correlationId: 'c' },
      targetProviderId: 'anthropic',
      transportProviderId: 'claude-code',
      modelId: 'claude-sonnet-4-6',
    });
    expect(eligible.map((a) => a.accountId)).toEqual(['acct-alpha']);
  });

  it('an UNOWNED account is never selectable (deny by default)', async () => {
    const unowned: AccountTransportAccount = {
      accountId: 'acct-unowned',
      targetProviderId: 'anthropic',
      transportProviderId: 'claude-code',
      accessToken: 'SECRET-UNOWNED',
      status: 'active',
      modelIds: ['claude-sonnet-4-6'],
      // NO metadata.ownerUserId -> unowned.
    };
    const transport = new FixtureTransport({
      jsonResponse: { status: 200, body: anthropicMessageResponse },
    });
    const { app } = buildHarness({ transport, accounts: [unowned] });
    const res = await app.request('/v1/messages', {
      method: 'POST',
      headers: authHeaders('user-a'),
      body: JSON.stringify(anthropicRequest(false)),
    });
    expect(res.status).toBe(429);
    expect(transport.seenMaterials).toHaveLength(0);
  });
});

describe('#7 kill-switch fail-closed (gateway in cross-user mode, switch OFF)', () => {
  it('rejects EVERY request through the router when cross-user mode + switch OFF', async () => {
    const transport = new FixtureTransport({
      jsonResponse: { status: 200, body: anthropicMessageResponse },
    });
    // Gateway configured for cross-user mode but the kill switch is OFF.
    const { app } = buildHarness({
      transport,
      accounts: [accountFor('user-a', 'alpha')],
      mode: 'cross-user-pool',
      crossUserPoolEnabled: false,
    });

    const res = await app.request('/v1/messages', {
      method: 'POST',
      headers: authHeaders('user-a'),
      body: JSON.stringify(anthropicRequest(false)),
    });

    // Fail-closed: a plain bad-request (kill-switch internal never revealed),
    // and NO account was ever selected/dispatched.
    expect(res.status).toBe(400);
    expect(transport.seenMaterials).toHaveLength(0);
    const text = await res.text();
    expect(text).not.toContain('kill');
    expect(text).not.toContain('lease');
  });

  it('the v0 personal-passthrough path needs NO grant (switch OFF, mode personal)', async () => {
    const transport = new FixtureTransport({
      jsonResponse: { status: 200, body: anthropicMessageResponse },
    });
    const { app } = buildHarness({
      transport,
      accounts: [accountFor('user-a', 'alpha')],
      // default mode = personal-passthrough, switch OFF.
    });
    const res = await app.request('/v1/messages', {
      method: 'POST',
      headers: authHeaders('user-a'),
      body: JSON.stringify(anthropicRequest(false)),
    });
    // Personal path is the unblocked v0 — succeeds with no grant required.
    expect(res.status).toBe(200);
    expect(transport.seenMaterials).toHaveLength(1);
  });
});
