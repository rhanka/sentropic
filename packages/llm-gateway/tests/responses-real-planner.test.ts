/**
 * Fixture replay through the REAL mesh planner (R4-BLQ-1, amended R5-MAJ-1):
 * planning, capability and execution-feature filtering are real; no mocked
 * plan. With a canned attempt only admissible Muse pairs serve 200
 * (initial-b `low` on the contributor; initial-a `max` re-targeted to
 * `muse-spark-1.3`). The recorded contributor x `max` bodies pass the
 * transport-level planner but a REAL `MuseRuntimeClient` refuses them
 * before any Meta I/O (official Meta cap), so they must never be reported
 * as served at 200. Through the gateway that pre-I/O refusal currently
 * surfaces as the frozen generic 400 (no `param`): a known spec §16.7
 * precision loss, pinned below and recorded for owner acceptance /
 * gateway follow-up (round-2 review Finding 1, option (c)).
 */
import { describe, expect, it, vi } from 'vitest';
import {
  InMemoryRoutePlanner,
  MuseRuntimeClient,
  type AccountDirectoryPort,
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

const museAuth = {
  auth: {
    material: { type: 'account-transport' as const, provider: 'muse' as const, accessToken: 'tok', accountId: 'acc' },
    descriptor: { sourceType: 'account-transport' as const, accountProviderId: 'muse' as const },
  },
};

const rig = (realMuseFetch?: unknown) => {
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
    async prepareAttempt(
      input: Parameters<AccountDirectoryPort['prepareAttempt']>[0],
    ): Promise<PreparedRouteAttempt> {
      if (!realMuseFetch) return canned;
      const client = new MuseRuntimeClient({
        fetch: realMuseFetch as unknown as typeof fetch,
      });
      // Bind the planned target onto the request exactly as the production
      // seam does (LocalAccountTransportService routeRequest: provider/model
      // from target, target.effort overrides the caller effort), then run a
      // REAL MuseRuntimeClient — its per-model validator decides, pre-I/O.
      const bind = (request: GenerateRequest): GenerateRequest => ({
        ...request,
        providerId: input.target.providerId as GenerateRequest['providerId'],
        modelId: input.target.modelId as GenerateRequest['modelId'],
        ...(input.target.effort
          ? { reasoning: { ...request.reasoning, effort: input.target.effort as never } }
          : {}),
      });
      return {
        attemptRef: 'real-muse',
        generate: (request: GenerateRequest) => client.generate(bind(request), museAuth),
        stream: (request: GenerateRequest) => client.stream(bind(request), museAuth),
        async markCommitted() {}, async complete() {}, async releaseCancelled() {}, async recordOutcome() {},
      } as unknown as PreparedRouteAttempt;
    },
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

  // Cornerstone (planner level, canned attempt): an admissible Muse pair
  // passes the reasoning-controls eligibility the planner now grants and
  // *reaches* dispatch with effort/summary forwarded. Only initial-b
  // (`low` on the contributor) qualifies as recorded; the two `max`
  // contributor bodies are covered by the real-client refusals below.
  it('serves muse-1.4.6-initial-b.json at 200, forwarding its reasoning effort and summary', async () => {
    const f = rig();
    const res = await f.send('/responses', await load('muse-1.4.6-initial-b.json'));
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, any>;
    expect(body).toMatchObject({ object: 'response', model: 'muse-spark-1.3-contributor', status: 'completed', store: false });
    expect(f.captured).toHaveLength(1);
    expect(f.captured[0]!.reasoning).toMatchObject({ effort: 'low', summary: 'auto' });
    expect(f.settleRoute).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ outcome: 'success' }));
  });

  it('serves the initial-a max body at 200 when re-targeted to muse-spark-1.3 (canned attempt)', async () => {
    const f = rig();
    const res = await f.send('/responses',
      { ...(await load('muse-1.4.6-initial-a.json')), model: 'muse-spark-1.3' });
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, any>;
    expect(body).toMatchObject({ object: 'response', model: 'muse-spark-1.3', status: 'completed', store: false });
    expect(f.captured).toHaveLength(1);
    expect(f.captured[0]!.reasoning).toMatchObject({ effort: 'max', summary: 'auto' });
    expect(f.settleRoute).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ outcome: 'success' }));
  });

  // Real-client end-to-end truth for the recorded contributor x `max`
  // traffic: planned, dispatched to a real MuseRuntimeClient, refused
  // before Meta I/O. The public error is today the frozen generic 400
  // (no `param`) — the §16.7 precision loss recorded in the header; a
  // gateway follow-up restoring `unsupported_parameter` + `param:
  // reasoning` must update these assertions.
  it.each([
    'muse-1.4.6-initial-a.json',
    'muse-1.4.6-tool-result.json',
  ] as const)('refuses %s at 400 before Meta I/O with a real Muse client (contributor max cap)', async (file) => {
    const fetchFn = vi.fn(async () => new Response('{}', { status: 200 }));
    const f = rig(fetchFn);
    const res = await f.send('/responses', await load(file));
    expect(res.status).toBe(400);
    const body = await res.json() as { error: { type: string; code: string; param?: string } };
    expect(body.error.type).toBe('invalid_request_error');
    expect(body.error.code).toBe('invalid_request');
    expect(body.error.param).toBeUndefined();
    expect(fetchFn).not.toHaveBeenCalled();
    expect(f.settleRoute).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      outcome: 'failed',
      attempts: [expect.objectContaining({ outcome: 'invalid-request' })],
    }));
  });

  it('refuses effort none at 400 before Meta I/O with a real Muse client', async () => {
    const fetchFn = vi.fn(async () => new Response('{}', { status: 200 }));
    const f = rig(fetchFn);
    const res = await f.send('/responses', {
      ...(await load('muse-1.4.6-initial-b.json')),
      model: 'muse-wonder-1.0',
      reasoning: { effort: 'none', summary: 'auto' },
    });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: { type: string; code: string; param?: string } };
    expect(body.error.type).toBe('invalid_request_error');
    expect(body.error.code).toBe('invalid_request');
    expect(body.error.param).toBeUndefined();
    expect(fetchFn).not.toHaveBeenCalled();
    expect(f.settleRoute).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      outcome: 'failed',
      attempts: [expect.objectContaining({ outcome: 'invalid-request' })],
    }));
  });

  it.each(['muse-wonder-1.0', 'muse-wonder-full-1.0'] as const)('serves a Responses body with reasoning controls on %s at 200 (owner request 2026-10-13)', async (model) => {
    const f = rig();
    const res = await f.send('/responses',
      { ...(await load('muse-1.4.6-initial-b.json')), model });
    expect(res.status).toBe(200);
    expect(f.captured).toHaveLength(1);
    const attempted = f.captured[0]!;
    expect(typeof attempted.model === 'string' ? attempted.model : attempted.modelId).toBe(model);
    expect(attempted.reasoning).toMatchObject({ effort: 'low', summary: 'auto' });
    expect(f.settleRoute).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ outcome: 'success' }));
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
