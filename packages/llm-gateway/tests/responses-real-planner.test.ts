/**
 * Fixture replay through the REAL mesh planner (R4-BLQ-1, amended R5-MAJ-1):
 * committed Codex bodies pass plan eligibility and serve 200; committed Muse
 * bodies fail closed with 400 (no proven Meta Chat reasoning slot — every
 * Muse fixture carries reasoning effort/summary, which `muse` no longer
 * declares). Provider I/O is faked at the attempt seam; planning, capability
 * and execution-feature filtering are real. No mocked plan.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  InMemoryRoutePlanner,
  type GenerateRequest,
  type PreparedRouteAttempt,
} from '@sentropic/llm-mesh';

import {
  createGatewayRouter,
  PersonalPassthroughCallerAuth,
  stubGatewayConfig,
  VerifiedCostContextResolver,
} from '../src/index.js';

const load = async (name: string): Promise<any> => {
  const { readFile } = await import('node:fs/promises');
  return JSON.parse(await readFile(new URL(`./fixtures/responses/${name}`, import.meta.url), 'utf8'));
};

const rig = () => {
  const verify = vi.fn(() => ({ tenantId: 't', principalId: 'p', source: 'test', ownerScopeRef: 'enrolled:p' }));
  const captured: GenerateRequest[] = [];
  const settleRoute = vi.fn();
  const canned = {
    attemptRef: 'opaque',
    async generate(request: GenerateRequest) {
      captured.push(request);
      const tools = (request.tools ?? []).slice(0, 1).map((tool) => ({
        toolCallId: `call_${tool.name}`, providerCallId: `call_${tool.name}`, name: tool.name, argumentsText: '{}',
      }));
      const servedModel = typeof request.model === 'string' ? request.model : request.modelId;
      return { id: 'resp_replay', providerId: 'openai', modelId: servedModel,
        message: { role: 'assistant', content: 'canned' }, text: 'canned', toolCalls: tools,
        finishReason: tools.length > 0 ? 'tool_calls' : 'stop',
        usage: { inputTokens: 10, outputTokens: 3, totalTokens: 13 } };
    },
    async stream() { throw new Error('unused'); },
    async markCommitted() {}, async complete() {}, async releaseCancelled() {}, async recordOutcome() {},
  } as unknown as PreparedRouteAttempt;
  const directory = {
    async listEligible() {
      return [
        { accountRef: 'internal-codex', diagnosticAccountRef: 'acct_codex',
          targetProviderId: 'openai', transportProviderId: 'codex',
          supportedModelIds: ['gpt-6.1-sol'],
          enrollmentCompletedAt: '2026-08-01T00:00:00Z', readiness: 'ready' as const, revision: 'r1' },
        { accountRef: 'internal-muse', diagnosticAccountRef: 'acct_muse',
          targetProviderId: 'muse', transportProviderId: 'muse',
          supportedModelIds: ['muse-spark-1.3-contributor', 'muse-spark-1.3',
            'muse-wonder-1.0', 'muse-wonder-full-1.0'],
          enrollmentCompletedAt: '2026-08-01T00:00:00Z', readiness: 'ready' as const, revision: 'r1' },
      ];
    },
    async prepareAttempt(): Promise<PreparedRouteAttempt> { return canned; },
  };
  const app = createGatewayRouter({ config: { ...stubGatewayConfig,
    callerAuth: new PersonalPassthroughCallerAuth({ verifyToken: { verify }, costContextResolver: new VerifiedCostContextResolver() }),
  }, routePlanner: new InMemoryRoutePlanner({ directory }),
  routeMetering: { settleRoute }, requestId: () => 'replay-request' });
  // All committed fixtures set `stream: true` (live CLI default); the JSON
  // replay pins the non-streaming route, so it replays with streaming off.
  const send = (path: string, body: Record<string, unknown>) => app.request(path, { method: 'POST',
    headers: { 'x-api-key': 'trusted-token', 'content-type': 'application/json' },
    body: JSON.stringify({ ...body, stream: false }) });
  return { send, captured, settleRoute };
};

describe('fixture replay through the real mesh planner (R4-BLQ-1)', () => {
  it.each([
    ['codex-0.162.1-initial.json', '/v1/responses', 'gpt-6.1-sol', 10],
    ['codex-0.162.1-tools.json', '/v1/responses', 'gpt-6.1-sol', 10],
  ] as const)('serves %s at 200 without losing model, tools or usage', async (file, path, model, toolCount) => {
    const f = rig();
    const res = await f.send(path, await load(file));
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, any>;
    expect(body).toMatchObject({ object: 'response', model, status: 'completed', store: false });
    expect(body.output?.some((item: any) => item.type === 'function_call')).toBe(true);
    expect(f.captured).toHaveLength(1);
    const attempted = f.captured[0]!;
    expect(typeof attempted.model === 'string' ? attempted.model : attempted.modelId).toBe(model);
    expect(f.captured[0]!.tools?.map((tool) => tool.name)).toHaveLength(toolCount);
    expect(body.usage).toMatchObject({ input_tokens: 10, output_tokens: 3, total_tokens: 13 });
    expect(f.settleRoute).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ outcome: 'success' }));
  });

  // R5-MAJ-1: every committed Muse fixture carries reasoning effort/summary,
  // which `muse` no longer declares (no proven Meta Chat slot) — the plan is
  // refused before dispatch with a named capability 400, never a silent drop.
  // R6-MAJ-1 (spec §16.7): the refusal names the cause — status AND error
  // type AND code AND param are asserted, not just the status.
  it.each([
    ['muse-1.4.6-initial-a.json', '/responses'],
    ['muse-1.4.6-initial-b.json', '/responses'],
    ['muse-1.4.6-tool-result.json', '/responses'],
  ] as const)('refuses %s at 400 before dispatch (unforwarded reasoning-controls)', async (file, path) => {
    const f = rig();
    const res = await f.send(path, await load(file));
    expect(res.status).toBe(400);
    const body = await res.json() as { error: { message: string; type: string; code: string; param: string } };
    expect(body.error.type).toBe('invalid_request_error');
    expect(body.error.code).toBe('unsupported_parameter');
    expect(body.error.param).toBe('reasoning');
    expect(f.captured).toHaveLength(0);
    expect(f.settleRoute).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ outcome: 'failed', attempts: [] }));
  });

  it.each(['muse-wonder-1.0', 'muse-wonder-full-1.0'] as const)('refuses a Responses body on %s at 400 (owner request 2026-10-13, R5-MAJ-1)', async (model) => {
    const f = rig();
    const res = await f.send('/responses',
      { ...(await load('muse-1.4.6-initial-b.json')), model });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: { message: string; type: string; code: string; param: string } };
    expect(body.error.type).toBe('invalid_request_error');
    expect(body.error.code).toBe('unsupported_parameter');
    expect(body.error.param).toBe('reasoning');
    expect(f.captured).toHaveLength(0);
    expect(f.settleRoute).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ outcome: 'failed', attempts: [] }));
  });

  it.each([
    ['codex-0.162.1-tool-result.json', '/v1/responses'],
  ] as const)('serves %s at 200 with call_id correlation intact', async (file, path) => {
    const f = rig();
    const res = await f.send(path, await load(file));
    expect(res.status).toBe(200);
    const tools = f.captured[0]!.messages.filter((message) => message.role === 'tool');
    expect(tools.length).toBeGreaterThan(0);
    const callIds = tools.flatMap((message) => message.role === 'tool' ? [message.toolResult.providerCallId] : []);
    expect(callIds).toContain('call_rec1');
    expect(f.settleRoute).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ outcome: 'success' }));
  });

  it('refuses a Codex explicit output ceiling before dispatch (no 413-capable slot)', async () => {
    const f = rig();
    const res = await f.send('/v1/responses', { ...(await load('codex-0.162.1-initial.json')), max_output_tokens: 128000 });
    expect(res.status).toBe(400);
    // R6-MAJ-1: the ceiling refusal names its field too (spec §16.7).
    const body = await res.json() as { error: { type: string; code: string; param: string } };
    expect(body.error.type).toBe('invalid_request_error');
    expect(body.error.code).toBe('unsupported_parameter');
    expect(body.error.param).toBe('max_output_tokens');
    expect(f.captured).toHaveLength(0);
  });
});
