import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { InMemoryRoutePlanner, type GenerateResponse, type PreparedRouteAttempt } from '@sentropic/llm-mesh';
import { createGatewayRouter } from '../src/router/index.js';
import { startGatewayHost } from '../src/node/gateway-host.js';
import { createGatewayControlClient } from '../src/node/control-client.js';
import type { MeshBinding } from '../src/node/host-types.js';
import { runJsonFlow, runStreamFlow, type LegacyRefusalReceiptRecord } from '../src/flow.js';
import { GuardEngine } from '../src/guards/guard-engine.js';
import type { GuardedTurnCaptureRecord } from '../src/guards/sse-guard-tee.js';
import { stubGatewayConfig } from '../src/stubs.js';
import type { GuardPort } from '../src/ports/guards.js';
import { nativeHarness } from './fixtures/native-flow.js';
import { budgetConfig } from './fixtures/budget.js';
import { buildHarness, authHeaders } from './fixtures/harness.js';
import { FixtureTransport, anthropicFrames } from './fixtures/transport.js';
import { anthropicMessageResponse, anthropicRequest } from './fixtures/anthropic.js';

const rogueGuardMutating = (mutate: (rec: Record<string, unknown>) => Record<string, unknown>): GuardPort => ({
  inspectRequest: (payload) => ({
    verdict: 'masked', findings: [],
    inFlightPayload: mutate({ ...(payload as Record<string, unknown>) }),
    maskedCapture: { __maskedCapturePayload: true, payload, findings: [] },
  }),
  maskForCapture: (payload) => ({ __maskedCapturePayload: true, payload, findings: [] }),
  scanText: (text) => ({ maskedText: text, findings: [], blocked: false }),
});

describe('L1.5 Protected Identification Invariant — legacy flow.ts, count_tokens, byte-identity & host StoredReceipt', () => {
  it('enforces P on legacy flow.ts (JSON & SSE) with refusal audit receipt and zero dispatch, while keeping compliant responses byte-identical', async () => {
    const transport = new FixtureTransport({ jsonResponse: { status: 200, body: anthropicMessageResponse }, streamFrames: anthropicFrames() });
    const harness = buildHarness({ transport });
    const receipts: LegacyRefusalReceiptRecord[] = [];
    const dispatchSpy = vi.spyOn(harness.config.dispatch, 'dispatch');
    const dispatchStreamSpy = vi.spyOn(harness.config.dispatch, 'dispatchStream');

    for (const stream of [false, true]) {
      const flowDeps = {
        config: harness.config, resolveTarget: () => ({ providerId: 'anthropic', transportProviderId: 'claude-code', model: 'claude-sonnet-4-6' }),
        metering: { settle() {} },
        guard: rogueGuardMutating((r) => ({ ...r, system: 'mutated-legacy' })),
        onRefusalReceipt: (rec: LegacyRefusalReceiptRecord) => { receipts.push(rec); },
      };
      const req = {
        wire: 'anthropic-messages' as const, headers: authHeaders('user-a'),
        authContext: { method: 'POST', url: 'https://gw.test/v1/messages', requestId: `req-leg-${stream}` },
        model: 'claude-sonnet-4-6', stream,
        body: { ...anthropicRequest(stream), system: 'orig-legacy' },
      };
      await expect(stream ? runStreamFlow(flowDeps, req) : runJsonFlow(flowDeps, req))
        .rejects.toMatchObject({ kind: 'protected-identification-mutated' });
    }
    expect(dispatchSpy).not.toHaveBeenCalled();
    expect(dispatchStreamSpy).not.toHaveBeenCalled();
    expect(receipts).toHaveLength(2);
    expect(receipts.every((r) => r.integrity === 'protected_identification_violation')).toBe(true);

    // Compliant legacy JSON + native passthrough stay byte-identical and drop caller user-agent
    const okRes = await harness.app.request('/v1/messages', {
      method: 'POST', headers: { ...authHeaders('user-a'), 'x-app': 'claude-code', 'x-claude-code-session': 's1', 'user-agent': 'cli/1' },
      body: JSON.stringify({ ...anthropicRequest(false), system: 'kept' }),
    });
    expect(okRes.status).toBe(200);
    expect(await okRes.json()).toEqual(anthropicMessageResponse);

    const hOk = nativeHarness();
    const appOk = createGatewayRouter({
      config: hOk.deps.config, routePlanner: hOk.deps.routePlanner, routeMetering: hOk.deps.metering,
      budget: hOk.deps.budget, nativeMessagesEnabled: true,
    });
    const resNativeOk = await appOk.request('/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'anthropic-beta': 'prompt-caching-2024-07-31', 'x-app': 'claude-code', 'x-stainless-lang': 'js', 'user-agent': 'cli/1' },
      body: JSON.stringify({ ...hOk.request.body, system: 'ok-sys', stream: false }),
    });
    expect(resNativeOk.status).toBe(200);
    expect(hOk.execute.mock.calls[0]![0]!.headers.forwarded['user-agent']).toBeUndefined();
    expect(hOk.execute.mock.calls[0]![0]!.headers.forwarded['x-app']).toBe('claude-code');
  });

  it('preserves POST /v1/messages/count_tokens raw passthrough and persists integrity on startGatewayHost StoredReceipt', async () => {
    const countSpy = vi.fn(async () => ({ kind: 'json' as const, status: 200 as const, headers: {}, body: { input_tokens: 42 } }));
    const countApp = createGatewayRouter({
      config: budgetConfig, routePlanner: nativeHarness().deps.routePlanner, routeMetering: { settleRoute() {} },
      nativeCountTokens: {
        modelIds: ['claude-sonnet-5'],
        prepare: async () => ({ providerId: 'anthropic', modelId: 'claude-sonnet-5', apiVersions: ['2023-06-01'], execute: countSpy }),
      },
    });
    const countRes = await countApp.request('/v1/messages/count_tokens', {
      method: 'POST', headers: { 'content-type': 'application/json', 'anthropic-beta': 'prompt-caching-2024-07-31' },
      body: JSON.stringify({ model: 'claude-sonnet-5', system: 'kept', messages: [{ role: 'user', content: 'hi' }] }),
    });
    expect(countRes.status).toBe(200);
    expect(await countRes.json()).toEqual({ input_tokens: 42 });

    const stateDir = await mkdtemp(join(tmpdir(), 'gw-l15-host-'));
    const mesh: MeshBinding = {
      ownerScopeRef: 'owner-a', keyring: { getSecret: async () => 'b'.repeat(64) }, unlockKeyring: async () => undefined,
      resolveOwner: (caller, ctx) => ({ ownerScopeRef: caller.ownerScopeRef, tenantId: 't1', principalId: 'u1', workspaceId: caller.workspaceRef, source: 'test', correlationId: ctx.requestId }),
      gateway: { config: stubGatewayConfig, routeMetering: { settleRoute: () => undefined } },
      createRoutePlanner: (opts) => new InMemoryRoutePlanner({
        ...opts,
        directory: {
          listEligible: async () => [{ accountRef: 'acct-1', diagnosticAccountRef: 'd1', targetProviderId: 'anthropic', transportProviderId: 'claude-code', supportedModelIds: ['claude-sonnet-5'], enrollmentCompletedAt: '2026-10-01T00:00:00Z', readiness: 'ready', revision: '1' }],
          prepareAttempt: async () => ({ attemptRef: 'a1', generate: async (): Promise<GenerateResponse> => ({ id: 'r1', providerId: 'anthropic', modelId: 'claude-sonnet-5', message: { role: 'assistant', content: 'ok' }, text: 'ok', toolCalls: [], finishReason: 'stop' }), stream: async () => (async function* () {})(), markCommitted: async () => undefined, complete: async () => undefined, releaseCancelled: async () => undefined, recordOutcome: async () => undefined }) as unknown as PreparedRouteAttempt,
        },
      }),
    };
    const host = await startGatewayHost({
      stateDir, mesh, listen: { host: '127.0.0.1', port: 0 },
      guard: rogueGuardMutating((r) => ({ ...r, system: 'host-tampered' })),
    });
    try {
      const control = createGatewayControlClient({ controlSocket: host.controlSocket });
      const issued = await control.acquireSession({
        ownerScopeRef: 'owner-a', workspaceRef: 'w1', clientSessionRef: 'c1',
        routingContract: { version: 1, revision: 'p1', ownerScopeRef: 'owner-a', exactModels: ['claude-sonnet-5'], authorizedAccountRefs: ['acct-1'], rotateAccounts: false, effortPolicy: { mode: 'preserve' } },
      });
      const res = await fetch(`${host.endpoint}/v1/messages`, {
        method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${issued.key}` },
        body: JSON.stringify({ model: 'claude-sonnet-5', system: 'host-orig', messages: [{ role: 'user', content: 'hi' }] }),
      });
      expect(res.status).toBe(400);
      const rcptId = res.headers.get('x-sentropic-receipt')!;
      const stored = await control.readReceipt({ ownerScopeRef: 'owner-a', receiptId: rcptId });
      expect(stored.settlement).toBe('error');
      expect(stored.integrity).toBe('protected_identification_violation');
    } finally { await host.stop(); await rm(stateDir, { recursive: true, force: true }); }
  });

  it('wires legacy onRefusalReceipt on createGatewayRouter, checks P before seat lease, and avoids estimated billing on pre-send refusal', async () => {
    const transport = new FixtureTransport({ jsonResponse: { status: 200, body: anthropicMessageResponse }, streamFrames: anthropicFrames() });
    const emptyHarness = buildHarness({ transport, accounts: [] });
    const selectSpy = vi.spyOn(emptyHarness.config.pool, 'select');
    const estimateSpy = vi.fn(() => ({ inputTokens: 999, outputTokens: 50, estimated: true }));
    const settleSpy = vi.fn();
    const receipts: LegacyRefusalReceiptRecord[] = [];
    const app = createGatewayRouter({
      config: emptyHarness.config,
      resolveTarget: () => ({ providerId: 'anthropic', transportProviderId: 'claude-code', model: 'claude-sonnet-4-6' }),
      metering: { settle: settleSpy },
      estimateUsage: estimateSpy,
      guard: rogueGuardMutating((r) => ({ ...r, system: 'mutated-http-legacy' })),
      onRefusalReceipt: (rec: LegacyRefusalReceiptRecord) => { receipts.push(rec); },
    });

    for (const stream of [false, true]) {
      const res = await app.request('/v1/messages', {
        method: 'POST', headers: authHeaders('user-a'),
        body: JSON.stringify({ ...anthropicRequest(stream), system: 'orig-http-legacy' }),
      });
      expect(res.status).toBe(400);
      expect(res.headers.get('x-should-retry')).toBe('false');
    }
    const connRes = await createGatewayRouter({
      config: emptyHarness.config,
      resolveTarget: () => ({ providerId: 'anthropic', transportProviderId: 'claude-code', model: 'claude-sonnet-4-6' }),
      metering: { settle: settleSpy },
      estimateUsage: estimateSpy,
      onRefusalReceipt: (rec: LegacyRefusalReceiptRecord) => { receipts.push(rec); },
    }).request('/v1/messages', {
      method: 'POST',
      headers: { ...authHeaders('user-a'), 'anthropic-beta': 'prompt-caching-2024-07-31', connection: 'anthropic-beta' },
      body: JSON.stringify({ ...anthropicRequest(false), system: 'orig-conn' }),
    });
    expect(connRes.status).toBe(400);
    expect(receipts).toHaveLength(3);
    expect(receipts.every((r) => r.integrity === 'protected_identification_violation')).toBe(true);
    expect(selectSpy).not.toHaveBeenCalled();
    expect(estimateSpy).not.toHaveBeenCalled();
    expect(settleSpy).not.toHaveBeenCalled();

    // Post-prepare mutation before send releases the seat without outcome penalty or estimated billing
    for (const stream of [false, true]) {
      const h = buildHarness({ transport });
      const releaseSpy = vi.fn(async () => undefined);
      const recordOutcomeSpy = vi.fn(async () => undefined);
      const origSelect = h.config.pool.select.bind(h.config.pool);
      const reqHeaders: Record<string, string> = { ...authHeaders('user-a'), 'x-app': 'claude-code' };
      const postConfig = {
        ...h.config,
        pool: {
          ...h.config.pool,
          select: async (selReq: Parameters<typeof origSelect>[0]) => {
            const sel = await origSelect(selReq);
            return { ...sel, acquisition: { ...sel.acquisition, release: releaseSpy, recordOutcome: recordOutcomeSpy } };
          },
          snapshotModels: h.config.pool.snapshotModels.bind(h.config.pool),
        },
        authResolver: {
          resolve: async (sel: Parameters<typeof h.config.authResolver.resolve>[0]) => {
            reqHeaders['x-app'] = 'tampered-after-prepare';
            return h.config.authResolver.resolve(sel);
          },
        },
      };
      const postSettle = vi.fn();
      const postEstimate = vi.fn(() => ({ inputTokens: 777, outputTokens: 88, estimated: true }));
      const flowDeps = {
        config: postConfig,
        resolveTarget: () => ({ providerId: 'anthropic', transportProviderId: 'claude-code', model: 'claude-sonnet-4-6' }),
        metering: { settle: postSettle },
        estimateUsage: postEstimate,
      };
      const req = {
        wire: 'anthropic-messages' as const, headers: reqHeaders,
        authContext: { method: 'POST', url: 'https://gw.test/v1/messages', requestId: `req-post-${stream}` },
        model: 'claude-sonnet-4-6', stream, body: { ...anthropicRequest(stream), system: 'orig' },
      };
      await expect(stream ? runStreamFlow(flowDeps, req) : runJsonFlow(flowDeps, req))
        .rejects.toMatchObject({ kind: 'protected-identification-mutated' });
      expect(releaseSpy).toHaveBeenCalledTimes(1);
      expect(recordOutcomeSpy).not.toHaveBeenCalled();
      expect(postEstimate).not.toHaveBeenCalled();
      expect(postSettle).toHaveBeenCalledWith(expect.objectContaining({
        outcome: 'failed', usage: { inputTokens: 0, outputTokens: 0, estimated: true },
      }));
    }
  });

  it('does not falsely block legacy JSON responses under mask_in_flight while still blocking explicit block rules', async () => {
    const email = 'alice.tester@example.org';
    const awsSecret = ['AKIA', 'IOSFODNN7EXAMPLE'].join('');
    const captures: GuardedTurnCaptureRecord[] = [];
    const hOk = buildHarness({
      transport: new FixtureTransport({
        jsonResponse: { status: 200, body: { ...anthropicMessageResponse, metadata: { owner: email } } },
      }),
    });
    const appOk = createGatewayRouter({
      config: hOk.config,
      resolveTarget: () => ({ providerId: 'anthropic', transportProviderId: 'claude-code', model: 'claude-sonnet-4-6' }),
      metering: hOk.metering,
      guard: new GuardEngine({ detectorActions: { 'pii.email': 'mask_in_flight' } }),
      captureEnabled: true,
      onCapture: (rec) => { captures.push(rec); },
    });
    const resOk = await appOk.request('/v1/messages', {
      method: 'POST', headers: authHeaders('user-a'),
      body: JSON.stringify({ ...anthropicRequest(false), system: 'clean' }),
    });
    expect(resOk.status).toBe(200);
    expect(captures).toHaveLength(1);
    expect(captures[0]!.blocked).toBe(false);
    expect(JSON.stringify(captures[0]!.responseCapture.payload)).not.toContain(email);

    const hBlock = buildHarness({
      transport: new FixtureTransport({
        jsonResponse: { status: 200, body: { ...anthropicMessageResponse, metadata: { owner: email }, content: [{ type: 'text', text: awsSecret }] } },
      }),
    });
    const appBlock = createGatewayRouter({
      config: hBlock.config,
      resolveTarget: () => ({ providerId: 'anthropic', transportProviderId: 'claude-code', model: 'claude-sonnet-4-6' }),
      metering: hBlock.metering,
      guard: new GuardEngine({ detectorActions: { 'pii.email': 'mask_in_flight', 'secret.aws_access_key': 'block' } }),
    });
    const resBlock = await appBlock.request('/v1/messages', {
      method: 'POST', headers: authHeaders('user-a'),
      body: JSON.stringify({ ...anthropicRequest(false), system: 'clean' }),
    });
    expect(resBlock.status).toBe(400);
  });
});
