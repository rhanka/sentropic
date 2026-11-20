import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { InMemoryRoutePlanner, type GenerateRequest, type GenerateResponse, type PreparedRouteAttempt, type StreamEvent } from '@sentropic/llm-mesh';
import { StageRewriteEngine } from '../src/rewrite/stage-rewrite.js';
import { normalizeGatewayIngress } from '../src/canonical-ingress.js';
import { encodeGatewayResponse } from '../src/canonical-egress.js';
import { prepareRouteFlow } from '../src/route-flow-core.js';
import { buildNativeMessagesRequest } from '../src/route-native.js';
import { GuardEngine } from '../src/guards/guard-engine.js';
import { runRouteStreamFlow } from '../src/route-stream-flow.js';
import { toProviderShapedError } from '../src/router/errors.js';
import { stubGatewayConfig } from '../src/stubs.js';
import type { StoredReceipt } from '../src/ports/gateway-state.js';
import { startGatewayHost } from '../src/node/gateway-host.js';
import { createGatewayControlClient } from '../src/node/control-client.js';
import { durableHostFixture, model as hostModel, routingContract as hostContract } from './helpers/durable-host.js';

const callerAuth = {
  async verify() {
    return { ok: true as const, cost: { tenantId: 't1', workspaceId: 'w1', principalId: 'u1', ownerScopeRef: 'owner-a', source: 'test', correlationId: 'c1' } };
  },
};

const museAndClaudePlanner = (captured: GenerateRequest[], streamEvents?: StreamEvent[]) => new InMemoryRoutePlanner({
  directory: {
    listEligible: async () => [
      { accountRef: 'acct-anth', diagnosticAccountRef: 'diag-anth', targetProviderId: 'anthropic', transportProviderId: 'claude-code',
        supportedModelIds: ['claude-sonnet-5', 'claude-opus-5'], enrollmentCompletedAt: '2026-10-01T00:00:00Z', readiness: 'ready', revision: '1' },
      { accountRef: 'acct-muse', diagnosticAccountRef: 'diag-muse', targetProviderId: 'muse', transportProviderId: 'muse',
        supportedModelIds: ['muse-spark-1.3-contributor', 'muse-wonder-1.0', 'muse-wonder-full-1.0'], enrollmentCompletedAt: '2026-10-01T00:00:00Z', readiness: 'ready', revision: '1' },
    ],
    prepareAttempt: async ({ target }) => ({
      attemptRef: `att-${target.modelId}`,
      generate: async (req: GenerateRequest): Promise<GenerateResponse> => {
        captured.push(req);
        return { id: 'resp-1', providerId: target.providerId as never, modelId: target.modelId, message: { role: 'assistant', content: 'ok' },
          text: 'ok', toolCalls: [], finishReason: 'stop', usage: { inputTokens: 10, outputTokens: 5, providerRawUsage: { cache_read_input_tokens: 8, cache_creation_input_tokens: 2 } } };
      },
      stream: async (req: GenerateRequest) => {
        captured.push(req);
        const events = streamEvents ?? [
          { type: 'tool_call_start', data: { toolCallId: 'tc_1', name: 'read_file', argumentsText: '{"p":"a"}' } },
          { type: 'done', data: { finishReason: 'tool_calls', usage: { inputTokens: 12, outputTokens: 6 } } },
        ];
        return (async function* () { for (const e of events) yield e; })();
      },
      markCommitted: async () => undefined, complete: async () => undefined,
      releaseCancelled: async () => undefined, recordOutcome: async () => undefined,
    }) as unknown as PreparedRouteAttempt,
  },
});

describe('L1.2 StageRewriteEngine & cache-marker preservation (Claude + Muse)', () => {
  it('validates rules against llm-mesh catalog, applies <=1 rewrite per stage, and skips Responses wire in Lot 1', () => {
    expect(() => new StageRewriteEngine({ stageId: 'wkst:1', rules: [{ ruleId: 'bad', matchModel: 'claude-sonnet-5', targetModel: 'nonexistent-model-xyz' }] })).toThrow();
    const engine = new StageRewriteEngine({
      stageId: 'wkst:1',
      rules: [
        { ruleId: 'r1', matchModel: 'muse-spark-1.3-contributor', targetModel: 'muse-wonder-1.0' },
        { ruleId: 'r2', matchModel: 'muse-wonder-1.0', targetModel: 'muse-wonder-full-1.0' },
      ],
    });
    const body = { model: 'muse-spark-1.3-contributor', messages: [{ role: 'user', content: 'hi' }], prompt_cache_key: 'pk-1' };
    const first = engine.rewrite({ wire: 'openai-chat-completions', body, model: 'muse-spark-1.3-contributor', stageRewriteCount: 0 });
    expect(first.rewritten).toBe(true);
    expect(first.model).toBe('muse-wonder-1.0');
    expect(first.originModel).toBe('muse-spark-1.3-contributor');
    expect(first.stageRewriteCount).toBe(1);
    expect(first.trace).toEqual({ stageId: 'wkst:1', ruleId: 'r1', fromModel: 'muse-spark-1.3-contributor', toModel: 'muse-wonder-1.0' });
    expect((first.body as Record<string, unknown>).prompt_cache_key).toBe('pk-1');
    const second = engine.rewrite({ wire: 'openai-chat-completions', body: first.body, model: first.model, stageRewriteCount: first.stageRewriteCount });
    expect(second.rewritten).toBe(false);
    expect(second.model).toBe('muse-wonder-1.0');
    const resp = engine.rewrite({ wire: 'openai-responses', body, model: 'muse-spark-1.3-contributor', stageRewriteCount: 0 });
    expect(resp.rewritten).toBe(false);
  });

  it('preserves Anthropic cache_control breakpoints via providerOptions, checks LaunchRoutingContract pre-rewrite, and records originModel in StoredReceipt', async () => {
    const captured: GenerateRequest[] = [];
    const engine = new StageRewriteEngine({
      stageId: 'wkst:1',
      rules: [{ ruleId: 'c-up', matchModel: 'claude-sonnet-5', matchEffort: 'medium', targetModel: 'claude-opus-5', targetEffort: 'high' }],
    });
    const body = {
      model: 'claude-sonnet-5',
      system: [{ type: 'text', text: 'sys', cache_control: { type: 'ephemeral' } }],
      tools: [{ name: 'read_file', input_schema: { type: 'object' }, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: [{ type: 'text', text: 'hello', cache_control: { type: 'ephemeral', ttl: '5m' } }] }],
      reasoning: { effort: 'medium' },
    };
    const ingress = normalizeGatewayIngress('anthropic-messages', body);
    expect(ingress.request.providerOptions?.cacheControl).toEqual({
      system: [{ index: 0, cache_control: { type: 'ephemeral' } }],
      tools: [{ index: 0, cache_control: { type: 'ephemeral' } }],
      messages: [{ messageIndex: 0, blockIndex: 0, cache_control: { type: 'ephemeral', ttl: '5m' } }],
    });
    const receiptLog: Partial<StoredReceipt>[] = [];
    const contract = { version: 1 as const, revision: 'r1', ownerScopeRef: 'owner-a', exactModels: ['claude-sonnet-5'],
      authorizedAccountRefs: ['acct-anth'], rotateAccounts: false, effortPolicy: { mode: 'preserve' as const, allowedEfforts: ['medium'] } };
    const prepared = await prepareRouteFlow({
      config: { ...stubGatewayConfig, callerAuth }, routePlanner: museAndClaudePlanner(captured),
      metering: { settleRoute() {} }, stageRewrite: engine,
      routeInput: () => ({ workspaceId: 'w1', affinityKey: 'aff-1', launchRoutingContract: contract }),
      requestAudit: { admit: async (a) => { receiptLog.push({ model: a.model, originModel: a.originModel, stageRewrites: a.stageRewrites }); return { receiptId: 'rec-1' }; } },
    }, { wire: 'anthropic-messages', headers: {}, authContext: { method: 'POST', url: 'http://127.0.0.1/v1/messages', requestId: 'req-1' }, model: 'claude-sonnet-5', stream: false, body });
    expect(prepared.originModel).toBe('claude-sonnet-5');
    expect(prepared.plan.diagnostics[0]?.actualModelId).toBe('claude-opus-5');
    expect(prepared.canonical.request.providerOptions?.cacheControl).toEqual(ingress.request.providerOptions?.cacheControl);
    expect(receiptLog[0]).toMatchObject({ model: 'claude-opus-5', originModel: 'claude-sonnet-5', stageRewrites: [{ stageId: 'wkst:1', ruleId: 'c-up', fromModel: 'claude-sonnet-5', toModel: 'claude-opus-5', fromEffort: 'medium', toEffort: 'high' }] });
    const encoded = encodeGatewayResponse('anthropic-messages', { id: 'r', providerId: 'anthropic', modelId: 'claude-opus-5', message: { role: 'assistant', content: 'ok' }, text: 'ok', toolCalls: [], finishReason: 'stop', usage: { inputTokens: 10, outputTokens: 5, providerRawUsage: { cache_read_input_tokens: 8, cache_creation_input_tokens: 2 } } });
    expect((encoded.body as { usage: Record<string, number> }).usage).toMatchObject({ input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 8, cache_creation_input_tokens: 2 });
  });

  it('streams multi-turn tool_use on Muse rewrite and returns 400 on unsupported Muse reasoning effort', async () => {
    const captured: GenerateRequest[] = [];
    const engine = new StageRewriteEngine({ stageId: 'wkst:1', rules: [{ ruleId: 'm1', matchModel: 'muse-spark-1.3-contributor', targetModel: 'muse-wonder-full-1.0' }] });
    const streamRes = await runRouteStreamFlow({
      config: { ...stubGatewayConfig, callerAuth }, routePlanner: museAndClaudePlanner(captured),
      metering: { settleRoute() {} }, stageRewrite: engine,
    }, {
      wire: 'openai-chat-completions', headers: {}, authContext: { method: 'POST', url: 'http://127.0.0.1/v1/chat/completions', requestId: 'req-2' },
      model: 'muse-spark-1.3-contributor', stream: true,
      body: { model: 'muse-spark-1.3-contributor', stream: true, tools: [{ type: 'function', function: { name: 'read_file', parameters: { type: 'object' } } }], messages: [{ role: 'user', content: 'read' }] },
    });
    expect(streamRes.servedTarget.model).toBe('muse-wonder-full-1.0');
    const frames: string[] = [];
    for await (const frame of streamRes.stream) if ('raw' in frame) frames.push(frame.raw);
    expect(frames.join('')).toContain('read_file');

    let caught: unknown;
    try {
      await prepareRouteFlow({
        config: { ...stubGatewayConfig, callerAuth }, routePlanner: museAndClaudePlanner(captured),
        metering: { settleRoute() {} }, stageRewrite: engine,
      }, {
        wire: 'openai-chat-completions', headers: {}, authContext: { method: 'POST', url: 'http://127.0.0.1/v1/chat/completions', requestId: 'req-3' },
        model: 'muse-spark-1.3-contributor', stream: false,
        body: { model: 'muse-spark-1.3-contributor', reasoning_effort: 'high', messages: [{ role: 'user', content: 'think' }] },
      });
    } catch (err) { caught = err; }
    expect(toProviderShapedError('openai-chat-completions', caught).status).toBe(400);
  });

  it('propagates effectiveBody when effectiveModel === request.model and into buildNativeMessagesRequest', async () => {
    const captured: GenerateRequest[] = [];
    const sameModelEngine = new StageRewriteEngine({
      stageId: 'wkst:1',
      rules: [{ ruleId: 'effort-only', matchModel: 'claude-sonnet-5', matchEffort: 'low', targetModel: 'claude-sonnet-5', targetEffort: 'high' }],
    });
    const body = {
      model: 'claude-sonnet-5',
      max_tokens: 128,
      reasoning: { effort: 'low' },
      messages: [{ role: 'user', content: 'email alice@example.org' }],
    };
    const seenRouteBodies: unknown[] = [];
    const req = {
      wire: 'anthropic-messages' as const,
      headers: {},
      authContext: { method: 'POST', url: 'http://127.0.0.1/v1/messages', requestId: 'req-eff' },
      model: 'claude-sonnet-5',
      stream: false,
      body,
    };
    const prepared = await prepareRouteFlow({
      config: { ...stubGatewayConfig, callerAuth },
      routePlanner: museAndClaudePlanner(captured),
      metering: { settleRoute() {} },
      stageRewrite: sameModelEngine,
      guard: new GuardEngine({ detectorActions: { 'pii.email': 'mask_in_flight' } }),
      routeInput: (i) => { seenRouteBodies.push(i.request.body); return { workspaceId: 'w1', affinityKey: 'aff-1' }; },
    }, req);
    expect((prepared.effectiveBody as { reasoning?: { effort?: string } })?.reasoning?.effort).toBe('high');
    expect(JSON.stringify(prepared.effectiveBody)).toContain('[REDACTED:EMAIL]');
    const nativeReq = buildNativeMessagesRequest(
      { ...prepared, nativeFeatures: { kind: 'eligible', forwarded: {}, maxOutputTokens: 128 } },
      req,
      { capability: { modelId: 'claude-sonnet-5', apiVersions: ['2023-06-01'], execute: async () => ({ kind: 'json', status: 200, headers: {}, body: {} }) }, anthropicVersion: '2023-06-01' },
      new AbortController().signal,
    );
    expect((nativeReq.body as { reasoning?: { effort?: string } }).reasoning?.effort).toBe('high');
    expect(JSON.stringify(nativeReq.body)).toContain('[REDACTED:EMAIL]');
  });

  it('syncs both reasoning_effort and reasoning.effort on OpenAI Chat and persists originModel/stageRewrites/guardVerdict atomically', async () => {
    const dualEngine = new StageRewriteEngine({
      stageId: 'wkst:1',
      rules: [{ ruleId: 'e-up', matchModel: 'claude-sonnet-5', matchEffort: 'medium', targetModel: 'claude-opus-5', targetEffort: 'high' }],
    });
    const dualBody = {
      model: 'claude-sonnet-5',
      reasoning_effort: 'medium',
      reasoning: { effort: 'medium' },
      messages: [{ role: 'user', content: 'hi' }],
    };
    const rewritten = dualEngine.rewrite({ wire: 'openai-chat-completions', body: dualBody, model: 'claude-sonnet-5', effort: 'medium', stageRewriteCount: 0 });
    expect(rewritten.rewritten).toBe(true);
    const normalized = normalizeGatewayIngress('openai-chat-completions', rewritten.body);
    expect(normalized.request.reasoning?.effort).toBe('high');

    // Single atomic recordAttempt transaction persists originModel, stageRewrites and guardVerdict
    const stateDir = await mkdtemp(join(tmpdir(), 'gw-p22-receipt-'));
    const hostEngine = new StageRewriteEngine({
      stageId: 'wkst:1',
      rules: [{ ruleId: 'h-r1', matchModel: hostModel, targetModel: hostModel, targetEffort: 'low' }],
    });
    const host = await startGatewayHost({
      stateDir, mesh: durableHostFixture().mesh, listen: { host: '127.0.0.1', port: 0 },
      stageRewrite: hostEngine, guard: new GuardEngine(),
    });
    try {
      const control = createGatewayControlClient({ controlSocket: host.controlSocket });
      const issued = await control.acquireSession({
        ownerScopeRef: 'owner-a', workspaceRef: 'w', clientSessionRef: 'p22-1', routingContract: hostContract,
      });
      const res = await fetch(`${host.endpoint}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${issued.key}` },
        body: JSON.stringify({ model: hostModel, messages: [{ role: 'user', content: 'contact alice@example.org' }] }),
      });
      expect(res.status).toBe(200);
      const receiptId = res.headers.get('x-sentropic-receipt')!;
      expect(receiptId).toBeTruthy();
      const receipt = await control.readReceipt({ ownerScopeRef: 'owner-a', receiptId });
      expect(receipt.originModel).toBe(hostModel);
      expect(receipt.stageRewrites?.[0]?.ruleId).toBe('h-r1');
      expect(receipt.guardVerdict).toBe('masked');
    } finally { await host.stop(); await rm(stateDir, { recursive: true, force: true }); }
  });
});
