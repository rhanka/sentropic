import { describe, expect, it, vi } from 'vitest';
import { InMemoryRoutePlanner, type PreparedRouteAttempt, type StreamEvent } from '@sentropic/llm-mesh';
import { GuardEngine } from '../src/guards/guard-engine.js';
import { createGatewayRouter } from '../src/router/index.js';
import { stubGatewayConfig } from '../src/stubs.js';
import type { GuardPort } from '../src/ports/guards.js';
import type { StageRewritePort } from '../src/rewrite/stage-rewrite.js';
import type { RouteFlowDeps } from '../src/route-flow-core.js';
import { budgetConfig, fixtureQuote, jsonAttempt, quotingPlanner, recordingBudget, textResponse } from './fixtures/budget.js';

const AWS_SECRET = ['AKIA', 'IOSFODNN7EXAMPLE'].join('');
const MODEL = 'claude-sonnet-5';

const rogueGuardMutating = (mutate: (rec: Record<string, unknown>) => Record<string, unknown>): GuardPort => ({
  inspectRequest: (payload) => ({
    verdict: 'masked', findings: [{ detectorId: 'yaml.custom', category: 'tech_secret', count: 1, action: 'mask_in_flight' }],
    inFlightPayload: mutate({ ...(payload as Record<string, unknown>) }),
    maskedCapture: { __maskedCapturePayload: true, payload, findings: [] },
  }),
  maskForCapture: (payload) => ({ __maskedCapturePayload: true, payload, findings: [] }),
  scanText: (text) => ({ maskedText: text, findings: [], blocked: false }),
});

const routedPlanner = (dispatchSpy = vi.fn(), model = MODEL, providerId = 'anthropic') => new InMemoryRoutePlanner({
  directory: {
    listEligible: async () => [{
      accountRef: 'acct-1', diagnosticAccountRef: 'diag-1', targetProviderId: providerId,
      transportProviderId: providerId === 'openai' ? 'codex' : 'claude-code',
      supportedModelIds: [model], enrollmentCompletedAt: '2026-10-01T00:00:00Z', readiness: 'ready', revision: '1',
    }],
    prepareAttempt: async () => ({
      attemptRef: 'att-1',
      generate: async (req: unknown) => {
        dispatchSpy(req);
        return { id: 'r1', providerId, modelId: model, message: { role: 'assistant', content: 'ok' }, text: 'ok', toolCalls: [], finishReason: 'stop' };
      },
      stream: async (req: unknown) => {
        dispatchSpy(req);
        return (async function* (): AsyncGenerator<StreamEvent> {
          yield { type: 'content_delta', data: { delta: 'ok' } };
          yield { type: 'done', data: { finishReason: 'stop' } };
        })();
      },
      markCommitted: async () => undefined, complete: async () => undefined,
      releaseCancelled: async () => undefined, recordOutcome: async () => undefined,
    }) as unknown as PreparedRouteAttempt,
  },
});

describe('L1.5 Protected Identification Invariant — routed canonical JSON/SSE, GuardEngine & StageRewritePort', () => {
  it('refuses GuardEngine mask_in_flight in P, rogue YAML GuardPort, and malicious StageRewritePort with audit receipt and zero dispatch', async () => {
    const refused: { receiptId: string; detail?: unknown }[] = [];
    const beginAttempt = vi.fn();
    const dispatchSpy = vi.fn();
    const requestAudit: RouteFlowDeps['requestAudit'] = {
      admit: async () => ({ receiptId: 'rcpt-1' }), beginAttempt,
      refuse: async (receiptId, detail) => { refused.push({ receiptId, detail }); },
    };
    const appGuard = createGatewayRouter({
      config: budgetConfig, routePlanner: routedPlanner(dispatchSpy), routeMetering: { settleRoute() {} },
      requestAudit, guard: new GuardEngine({ detectorActions: { 'secret.aws_access_key': 'mask_in_flight' } }),
    });
    const resGuard = await appGuard.request('/v1/messages', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: MODEL, system: `key ${AWS_SECRET}`, messages: [{ role: 'user', content: 'hi' }] }),
    });
    expect(resGuard.status).toBe(400);
    expect(resGuard.headers.get('x-should-retry')).toBe('false');
    expect(resGuard.headers.get('x-sentropic-receipt')).toBe('rcpt-1');
    expect(dispatchSpy).not.toHaveBeenCalled();
    expect(beginAttempt).not.toHaveBeenCalled();
    expect(refused[0]?.detail).toMatchObject({ integrity: 'protected_identification_violation' });
    refused.length = 0;
    const appRogue = createGatewayRouter({
      config: budgetConfig, routePlanner: routedPlanner(dispatchSpy), routeMetering: { settleRoute() {} },
      requestAudit, guard: rogueGuardMutating((r) => ({ ...r, system: '<<SECRET:yaml_custom:deadbeef>>' })),
    });
    const resRogue = await appRogue.request('/v1/messages', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: MODEL, system: 'original-system', messages: [{ role: 'user', content: 'hi' }] }),
    });
    expect(resRogue.status).toBe(400);
    expect(dispatchSpy).not.toHaveBeenCalled();
    expect(beginAttempt).not.toHaveBeenCalled();
    expect(refused[0]?.detail).toMatchObject({ integrity: 'protected_identification_violation' });
    refused.length = 0;
    const rogueRewrite: StageRewritePort = {
      rewrite: (input) => ({
        rewritten: true, originModel: input.model, model: input.model, stageRewriteCount: 1,
        body: { ...(input.body as Record<string, unknown>), metadata: { user_id: 'tampered' } },
        trace: { stageId: 'wkst:1', ruleId: 'r1', fromModel: input.model, toModel: input.model },
      }),
    };
    const appRewrite = createGatewayRouter({
      config: budgetConfig, routePlanner: routedPlanner(dispatchSpy), routeMetering: { settleRoute() {} },
      requestAudit, stageRewrite: rogueRewrite,
    });
    const resRewrite = await appRewrite.request('/v1/chat/completions', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: MODEL, metadata: { user_id: 'orig' }, messages: [{ role: 'user', content: 'hi' }] }),
    });
    expect(resRewrite.status).toBe(400);
    expect(await resRewrite.json()).toMatchObject({ error: { type: 'invalid_request_error', code: 'prohibited_identification_mutation' } });
    expect(dispatchSpy).not.toHaveBeenCalled();
    expect(beginAttempt).not.toHaveBeenCalled();
  });

  it('catches canonical projection mutation (providerOptions/tools) and Responses typeless input mutation across JSON & SSE', async () => {
    const provider = { generate: vi.fn(textResponse({ inputTokens: 1, outputTokens: 1 })) };
    const attempt = jsonAttempt(provider.generate);
    const releaseSpy = vi.spyOn(attempt, 'releaseCancelled');
    const outcomeSpy = vi.spyOn(attempt, 'recordOutcome');
    const quote = fixtureQuote({ requestedModel: 'gpt-5.6-terra', candidates: [{ providerId: 'openai', modelId: 'gpt-5.6-terra', reason: 'exact', allowance: { inputTokens: 100, outputTokens: 100 }, outputCeilingEnforced: true }] });
    const { planner } = quotingPlanner([attempt], { quote: () => quote });
    const recorder = recordingBudget();
    const app = createGatewayRouter({
      config: budgetConfig, routePlanner: planner, routeMetering: recorder.metering, budget: recorder.options,
      routeInput: ({ canonical }) => {
        ((canonical.request.providerOptions as Record<string, unknown>).responses as Record<string, unknown>).safetyIdentifier = 'tampered';
        return {};
      },
    });
    const res = await app.request('/v1/responses', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'gpt-5.6-terra', max_output_tokens: 64, instructions: 'Keep', safety_identifier: 'orig', input: [{ role: 'developer', content: 'typeless' }, { role: 'user', content: 'hi' }] }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: 'prohibited_identification_mutation' } });
    expect(provider.generate).not.toHaveBeenCalled();
    expect(recorder.events.filter((e) => e.startsWith('mark:'))).toEqual([]);
    expect(recorder.events).toContain('release:hold-1');
    expect(releaseSpy).toHaveBeenCalledTimes(1);
    expect(outcomeSpy).not.toHaveBeenCalled();
    const streamSpy = vi.fn();
    const appStream = createGatewayRouter({
      config: { ...stubGatewayConfig, callerAuth: budgetConfig.callerAuth },
      routePlanner: routedPlanner(streamSpy, 'gpt-5.6-terra', 'openai'), routeMetering: { settleRoute() {} },
      guard: rogueGuardMutating((r) => ({ ...r, input: [{ role: 'developer', content: 'altered' }, { role: 'user', content: 'hi' }] })),
    });
    const resStream = await appStream.request('/responses', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'gpt-5.6-terra', stream: true, input: [{ role: 'developer', content: 'orig' }, { role: 'user', content: 'hi' }] }),
    });
    expect(resStream.status).toBe(400);
    expect(await resStream.json()).toMatchObject({ error: { code: 'prohibited_identification_mutation' } });
    expect(streamSpy).not.toHaveBeenCalled();
  });

  it('allows adding or removing non-protected messages[*].content[*].cache_control without prefix cache_control', async () => {
    const dispatchRemove = vi.fn();
    const appRemove = createGatewayRouter({
      config: budgetConfig, routePlanner: routedPlanner(dispatchRemove), routeMetering: { settleRoute() {} },
      guard: rogueGuardMutating((r) => ({
        ...r, messages: [{ role: 'user', content: [{ type: 'text', text: 'turn-1' }] }],
      })),
    });
    const resRemove = await appRemove.request('/v1/messages', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: MODEL, system: [{ type: 'text', text: 'sys' }],
        messages: [{ role: 'user', content: [{ type: 'text', text: 'turn-1', cache_control: { type: 'ephemeral' } }] }],
      }),
    });
    expect(resRemove.status).toBe(200);
    expect(dispatchRemove).toHaveBeenCalledTimes(1);

    const dispatchAdd = vi.fn();
    const appAdd = createGatewayRouter({
      config: budgetConfig, routePlanner: routedPlanner(dispatchAdd), routeMetering: { settleRoute() {} },
      guard: rogueGuardMutating((r) => ({
        ...r, messages: [{ role: 'user', content: [{ type: 'text', text: 'turn-1', cache_control: { type: 'ephemeral' } }] }],
      })),
    });
    const resAdd = await appAdd.request('/v1/messages', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: MODEL, system: [{ type: 'text', text: 'sys' }],
        messages: [{ role: 'user', content: [{ type: 'text', text: 'turn-1' }] }],
      }),
    });
    expect(resAdd.status).toBe(200);
    expect(dispatchAdd).toHaveBeenCalledTimes(1);

    const dispatchSealed = vi.fn();
    const appSealed = createGatewayRouter({
      config: budgetConfig, routePlanner: routedPlanner(dispatchSealed), routeMetering: { settleRoute() {} },
      guard: rogueGuardMutating((r) => ({ ...r, system: [{ type: 'text', text: 'sys' }] })),
    });
    const resSealed = await appSealed.request('/v1/messages', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: MODEL, system: [{ type: 'text', text: 'sys', cache_control: { type: 'ephemeral' } }],
        messages: [{ role: 'user', content: [{ type: 'text', text: 'turn-1' }] }],
      }),
    });
    expect(resSealed.status).toBe(400);
    expect(dispatchSealed).not.toHaveBeenCalled();
  });
});
