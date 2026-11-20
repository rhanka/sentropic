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
});
