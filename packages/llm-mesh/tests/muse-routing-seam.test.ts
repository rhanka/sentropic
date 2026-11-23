import { describe, expect, it, vi } from 'vitest';
import { MuseAdapter } from '../src/adapters.js';
import { createLlmMesh } from '../src/mesh.js';
import { InMemoryKeyring } from '../src/node/keyring/in-memory-keyring.js';
import { createProviderRegistry } from '../src/registry.js';
import { LAUNCH_ALIAS_ROUTE_MAPPINGS } from '../src/routing-targets.js';
import { LocalAccountTransportService } from '../src/service/local-account-transport-service.js';
import { MuseRuntimeClient } from '../src/transport/muse-runtime-client.js';

// Routing-seam disclosure (review Finding 3): allowing Muse reasoning on
// the Responses wire ACTIVATES the launch-alias Muse candidates, which on
// base always died in the client before I/O. A host that wires a real
// MuseRuntimeClient now dispatches those candidates to Meta, by default
// on the Spark contributor tier (content may train future Meta models).
// This test composes the real seam: launch-alias mapping ->
// createRouteDirectory attempt (injects target.effort) -> LlmMesh ->
// MuseAdapter -> MuseRuntimeClient -> fake fetch (no network, no secret).
const OWNER = 'tenant-1:user-1';
const completed = {
  id: 'resp-1', status: 'completed',
  output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'ok' }] }],
};
const bodyOf = (f: { mock: { calls: unknown[][] } }): Record<string, unknown> =>
  JSON.parse(String((f.mock.calls[0]![1] as { body: unknown }).body)) as Record<string, unknown>;

const setup = (fetchFn: typeof fetch) => {
  const service = new LocalAccountTransportService(
    new InMemoryKeyring(), new Map(), { async resolveConfig() { return {}; } },
  );
  service.registerAccount({
    accountId: 'acct_muse_seam', ownerScopeRef: OWNER, targetProviderId: 'muse',
    transportProviderId: 'muse', accessToken: 'secret-muse-token', status: 'active',
    expiresAt: '2099-01-01T00:00:00.000Z', enrollmentCompletedAt: '2026-01-01T00:00:00.000Z',
    modelIds: ['muse-spark-1.3', 'muse-spark-1.3-contributor', 'muse-wonder-1.0', 'muse-wonder-full-1.0', 'muse-ember-1.0'],
  });
  const mesh = createLlmMesh({
    registry: createProviderRegistry([new MuseAdapter({
      client: new MuseRuntimeClient({ fetch: fetchFn }),
    })]),
  });
  return service.createRouteDirectory(mesh);
};

const museAttempt = async (
  directory: ReturnType<typeof setup>, alias: string,
) => {
  const candidate = LAUNCH_ALIAS_ROUTE_MAPPINGS[alias]?.find(
    (t) => t.providerId === 'muse' && t.transportProviderId === 'muse',
  );
  expect(candidate, `muse candidate for ${alias}`).toBeDefined();
  const subject = { principalRef: 'user-1', ownerScopeRef: OWNER };
  const accounts = await directory.listEligible(subject);
  expect(accounts).toHaveLength(1);
  const attempt = await directory.prepareAttempt({
    subject, accountRef: accounts[0]!.accountRef,
    target: {
      requestedModel: alias, providerId: candidate!.providerId,
      modelId: candidate!.model, transportProviderId: candidate!.transportProviderId,
      reason: 'alias', ...(candidate!.effort ? { effort: candidate!.effort } : {}),
    },
    requestId: `req-${alias}`, attemptIndex: 0,
  });
  return { attempt, candidate: candidate! };
};

describe('muse launch-alias routing seam', () => {
  it('dispatches a Wonder Full max alias candidate to the Responses wire', async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify(completed), { status: 200 }));
    const { attempt, candidate } = await museAttempt(setup(fetchFn), 'claude-opus-5-5-max');
    expect(candidate).toMatchObject({ model: 'muse-wonder-full-1.0', effort: 'max' });
    await attempt.generate({ messages: [{ role: 'user', content: 'hello' }] });
    expect(fetchFn).toHaveBeenCalledOnce();
    expect(bodyOf(fetchFn)).toMatchObject({
      model: 'muse-wonder-full-1.0', reasoning: { effort: 'max' },
    });
  });

  it('refuses a contributor max alias candidate before Meta I/O (official Meta cap)', async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify(completed), { status: 200 }));
    const { attempt, candidate } = await museAttempt(setup(fetchFn), 'claude-fable-5-max');
    expect(candidate).toMatchObject({ model: 'muse-spark-1.3-contributor', effort: 'max' });
    const err = await attempt.generate({ messages: [{ role: 'user', content: 'hello' }] })
      .catch((e: Error) => e);
    expect(err).toMatchObject({ status: 400, code: 'unsupported_projection', param: 'reasoning' });
    expect((err as Error).message).toBe(
      'Muse model muse-spark-1.3-contributor does not support reasoning effort "max" (supported: low, medium, high, xhigh)',
    );
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('keeps a caller summary next to the alias effort override on the wire', async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify(completed), { status: 200 }));
    const { attempt, candidate } = await museAttempt(setup(fetchFn), 'claude-opus-5-5-max');
    expect(candidate).toMatchObject({ model: 'muse-wonder-full-1.0', effort: 'max' });
    await attempt.generate({
      messages: [{ role: 'user', content: 'hello' }], reasoning: { summary: 'auto' },
    });
    expect(fetchFn).toHaveBeenCalledOnce();
    expect(bodyOf(fetchFn)).toMatchObject({
      model: 'muse-wonder-full-1.0', reasoning: { effort: 'max', summary: 'auto' },
    });
  });

  it('refuses slotless reasoning.enabled carried into a muse alias attempt', async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify(completed), { status: 200 }));
    const { attempt } = await museAttempt(setup(fetchFn), 'claude-opus-5-5-max');
    const err = await attempt.generate({
      messages: [{ role: 'user', content: 'hello' }], reasoning: { enabled: true },
    }).catch((e: Error) => e);
    expect(err).toMatchObject({ status: 400, code: 'unsupported_projection', param: 'reasoning' });
    expect((err as Error).message).toBe('Muse Responses cannot preserve reasoning.enabled');
    expect(fetchFn).not.toHaveBeenCalled();
  });
});
