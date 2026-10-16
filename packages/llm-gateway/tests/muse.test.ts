/**
 * Muse CLI ingress — GET /muse-code/models (Lot 1).
 *
 * The Muse CLI joins its provider path `/muse-code/models` to the configured
 * base URL for its model catalog. Pointed at the gateway origin, that call
 * must answer the caller-filtered pool catalog (same OpenAI-list shape as
 * GET /v1/models), never a framework 404 and never pool internals.
 */

import { describe, expect, it } from 'vitest';

import { FixtureTransport } from './fixtures/transport.js';
import { authHeaders, buildHarness, claudeCodePool } from './fixtures/harness.js';

describe('GET /muse-code/models', () => {
  it('lists the personal pool models for an authenticated caller', async () => {
    const transport = new FixtureTransport();
    const { app } = buildHarness({ transport, accounts: claudeCodePool() });
    const res = await app.request('/muse-code/models', { headers: authHeaders('user-a') });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      object: string;
      data: { id: string; object: string; owned_by: string }[];
    };
    expect(body.object).toBe('list');
    const ids = body.data.map((m) => m.id).sort();
    expect(ids).toEqual(['claude-opus-4-7', 'claude-sonnet-4-6']);
    expect(body.data.every((m) => m.owned_by === 'anthropic')).toBe(true);
    // No account ids/tokens.
    const text = JSON.stringify(body);
    expect(text).not.toContain('acct-alpha');
    expect(text).not.toContain('SECRET');
  });

  it('returns 401 for an unauthenticated caller (never the pool)', async () => {
    const transport = new FixtureTransport();
    const { app } = buildHarness({ transport });
    const res = await app.request('/muse-code/models');
    expect(res.status).toBe(401);
    const text = await res.text();
    expect(text).not.toContain('claude-sonnet-4-6');
  });
});
