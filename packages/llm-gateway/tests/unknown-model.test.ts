/** Lot 1 unknown-model router matrix (plan path): REAL router + REAL mesh, both wires, JSON and `stream:true`. */
import { RoutePlanError, type PreparedRouteAttempt, type RoutePlanner } from '@sentropic/llm-mesh';
import { describe, expect, it } from 'vitest';
import { createGatewayRouter, stubGatewayConfig } from '../src/index.js';
import type { RouteRequestSettlement } from '../src/route-flow-core.js';
import {
  KNOWN_MODEL, UNKNOWN_MODEL, authHeaders, emptyMeshDirectory, meshDirectoryFor,
  realMeshPlanner, sendUnknown, unknownCallerAuth, unknownModelRouter, type UnknownRouterCalls,
} from './fixtures/unknown-model.js';
import { MODEL, quotingPlanner, recordingBudget } from './fixtures/budget.js';

const freshCalls = (): UnknownRouterCalls => ({ settlements: [], dispatch: { generate: 0, stream: 0 } });

const expectedBody = (path: string): unknown => path === '/v1/messages'
  ? { type: 'error', error: { type: 'not_found_error', message: `Unknown model: "${UNKNOWN_MODEL}"` } }
  : { error: { message: `Unknown model: "${UNKNOWN_MODEL}"`,
    type: 'invalid_request_error', code: 'model_not_found' } };

describe('unknown-model router matrix (real mesh, plan path)', () => {
  it.each([
    { path: '/v1/messages', stream: false },
    { path: '/v1/messages', stream: true },
    { path: '/v1/chat/completions', stream: false },
    { path: '/v1/chat/completions', stream: true },
  ])('returns the frozen 404 with zero dispatch ($path stream=$stream)', async ({ path, stream }) => {
    const calls = freshCalls();
    const app = unknownModelRouter({ planner: realMeshPlanner(meshDirectoryFor([KNOWN_MODEL])), calls });
    const res = await sendUnknown(app, path, UNKNOWN_MODEL, stream);
    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toMatch(/^application\/json/);
    expect(res.headers.get('x-sentropic-request-id')).toBe('req_unknown');
    expect(res.headers.get('x-sentropic-served')).toBeNull();
    expect(res.headers.get('retry-after')).toBeNull();
    expect(res.headers.get('x-should-retry')).toBeNull();
    // A pre-commit refusal is JSON, never an SSE prefix — even for stream:true.
    const text = await res.text();
    expect(text.startsWith('event:')).toBe(false);
    expect(text.startsWith('data:')).toBe(false);
    expect(JSON.parse(text)).toEqual(expectedBody(path));
    // Zero provider dispatch, one failed zero-attempt notification.
    expect(calls.dispatch).toEqual({ generate: 0, stream: 0 });
    expect(calls.settlements).toHaveLength(1);
    expect(calls.settlements[0]).toMatchObject({ outcome: 'failed',
      requestedModel: UNKNOWN_MODEL, attempts: [],
      usage: { inputTokens: 0, outputTokens: 0, estimated: true } });
  });

  it('separates caller auth from model routing (401 before any 404)', async () => {
    const calls = freshCalls();
    const app = unknownModelRouter({ planner: realMeshPlanner(meshDirectoryFor([KNOWN_MODEL])), calls });
    const res = await sendUnknown(app, '/v1/messages', UNKNOWN_MODEL, false,
      { authorization: 'Bearer wrong', 'content-type': 'application/json' });
    expect(res.status).toBe(401);
    expect(calls.settlements).toHaveLength(0);
    expect(calls.dispatch).toEqual({ generate: 0, stream: 0 });
  });

  it('keeps malformed and missing models at 400, never 404', async () => {
    const calls = freshCalls();
    const app = unknownModelRouter({ planner: realMeshPlanner(meshDirectoryFor([KNOWN_MODEL])), calls });
    for (const path of ['/v1/messages', '/v1/chat/completions']) {
      const malformed = await app.request(path, { method: 'POST', headers: authHeaders, body: '{ not json' });
      expect(malformed.status).toBe(400);
      const missing = await app.request(path, { method: 'POST', headers: authHeaders,
        body: JSON.stringify({ messages: [] }) });
      expect(missing.status).toBe(400);
    }
    expect(calls.settlements).toHaveLength(0);
  });
});

describe('unknown-model budget quote path (real mesh)', () => {
  it.each([
    { path: '/v1/messages', stream: false },
    { path: '/v1/messages', stream: true },
    { path: '/v1/chat/completions', stream: false },
    { path: '/v1/chat/completions', stream: true },
  ])('returns the frozen 404 with zero admission ($path stream=$stream)', async ({ path, stream }) => {
    const calls = freshCalls();
    const recorder = recordingBudget();
    const app = unknownModelRouter({
      planner: realMeshPlanner(meshDirectoryFor([KNOWN_MODEL])), calls, budget: recorder.options,
    });
    const res = await sendUnknown(app, path, UNKNOWN_MODEL, stream);
    expect(res.status).toBe(404);
    expect(JSON.parse(await res.text())).toEqual(expectedBody(path));
    expect(res.headers.get('x-sentropic-served')).toBeNull();
    expect(calls.settlements).toEqual([]);
    expect(recorder.admitted).toEqual([]);
    expect(recorder.events).toEqual([]);
    expect(calls.dispatch).toEqual({ generate: 0, stream: 0 });
  });
});

describe('adversarial requested models', () => {
  it('escapes hostile model strings in JSON with no header split', async () => {
    const hostile = ['evil"model', 'line\nbreak', 'line\r\nbreak', 'modèle-日本語-🚀',
      `x${'a'.repeat(5000)}`, 'quote\\"and\\\\backslash'];
    const calls = freshCalls();
    const app = unknownModelRouter({ planner: realMeshPlanner(meshDirectoryFor([KNOWN_MODEL])), calls });
    for (const model of hostile) {
      const res = await sendUnknown(app, '/v1/chat/completions', model, false);
      expect(res.status).toBe(404);
      const body = JSON.parse(await res.text()) as { error: { message: string } };
      expect(body.error.message).toBe(`Unknown model: ${JSON.stringify(model)}`);
      // The model is never reflected in headers: no split/smuggle channel.
      res.headers.forEach((value) => {
        expect(value).not.toContain('\n');
        expect(value).not.toContain('\r');
      });
      expect(res.headers.get('x-sentropic-served')).toBeNull();
    }
  });
});

const stubPolicy = {
  strategy: { kind: 'last-enrolled' as const }, rules: [], fallbackMode: 'retest-preferred' as const,
  negativeCacheTtlMs: 300_000, maxAttempts: 2, preferSameTransport: true,
  stickyAccount: true, rotateEquivalentAccounts: false, allowEquivalentModels: true,
};

describe('terminal upstream 404 (requested versus actual model)', () => {
  it('names the requested model while the served header keeps the actual model', async () => {
    const planner: RoutePlanner = {
      async plan() {
        return { planRef: 'plan-1', expiresAt: '2027-01-01T00:00:00Z', candidateRefs: ['candidate-0'],
          policy: stubPolicy, councilRevision: 'fixture', diagnostics: [{
            candidateRef: 'candidate-0', diagnosticAccountRef: 'account-0', requestedModel: KNOWN_MODEL,
            actualProviderId: 'openai', actualModelId: 'actual-model-x',
            actualTransportProviderId: 'codex', reason: 'exact' as const, cacheContinuityRisk: false }] };
      },
      async prepareAttempt() {
        return { attemptRef: 'attempt-0',
          async generate() { throw { status: 404 }; },
          async stream() { throw new Error('unused'); },
          async recordOutcome() {}, async markCommitted() {}, async complete() {}, async releaseCancelled() {} };
      },
      describeAffinity() { return null; }, promoteAffinity() { throw new Error('unused'); },
      rebindAffinity() { throw new Error('unused'); }, resetAffinity() { return false; },
    };
    for (const path of ['/v1/messages', '/v1/chat/completions']) {
      for (const stream of [false, true]) {
        const calls = freshCalls();
        const app = unknownModelRouter({ planner, calls, dispatchError: { status: 404 } });
        const res = await sendUnknown(app, path, KNOWN_MODEL, stream);
        expect(res.status).toBe(404);
        const body = JSON.parse(await res.text()) as { error: { message: string } };
        expect(body.error.message).toBe(`Unknown model: "${KNOWN_MODEL}"`);
        expect(JSON.stringify(body)).not.toContain('actual-model-x');
        expect(res.headers.get('x-sentropic-served')).toContain('model=actual-model-x');
        expect(stream ? calls.dispatch.stream : calls.dispatch.generate).toBe(1);
        expect(calls.settlements).toHaveLength(1);
      }
    }
  });

  it.each([
    { path: '/v1/messages', stream: false },
    { path: '/v1/messages', stream: true },
    { path: '/v1/chat/completions', stream: false },
    { path: '/v1/chat/completions', stream: true },
  ])('freezes the BR-REL-Q7 no-route 503 without enrollment diagnostic ($path stream=$stream)', async ({ path, stream }) => {
    const calls = freshCalls();
    const app = unknownModelRouter({ planner: realMeshPlanner(emptyMeshDirectory()), calls });
    const res = await sendUnknown(app, path, KNOWN_MODEL, stream);
    expect(res.status).toBe(503);
    const message = `No route available for model: "${KNOWN_MODEL}"`;
    const text = await res.text();
    expect(JSON.parse(text)).toEqual(path === '/v1/messages'
      ? { type: 'error', error: { type: 'api_error', message } }
      : { error: { message, type: 'server_error', code: 'no_route' } });
    expect(JSON.stringify(text)).not.toContain('overloaded');
    expect(JSON.stringify(text)).not.toContain('rate_limit');
    expect(res.headers.get('x-should-retry')).toBe('false');
    expect(res.headers.get('retry-after')).toBeNull();
    expect(res.headers.get('x-sentropic-served')).toBeNull();
    expect(calls.settlements).toHaveLength(1);
  });
});

describe('planning refusal survives a rejecting settlement sink', () => {
  const rejectingRouter = (planner: RoutePlanner, onSettle: () => void) => createGatewayRouter({
    config: { ...stubGatewayConfig, callerAuth: unknownCallerAuth },
    routePlanner: planner,
    routeMetering: { async settleRoute() {
      onSettle();
      throw Object.assign(Error('sink down'), { status: 500 });
    } },
    requestId: () => 'req_unknown',
  });
  const wires = [
    { path: '/v1/messages', stream: false },
    { path: '/v1/messages', stream: true },
    { path: '/v1/chat/completions', stream: false },
    { path: '/v1/chat/completions', stream: true },
  ];

  it.each(wires)('preserves the unknown-model 404 ($path stream=$stream)', async ({ path, stream }) => {
    let settles = 0;
    const app = rejectingRouter(realMeshPlanner(meshDirectoryFor([KNOWN_MODEL])), () => { settles += 1; });
    const res = await sendUnknown(app, path, UNKNOWN_MODEL, stream);
    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toMatch(/^application\/json/);
    expect(res.headers.get('x-should-retry')).toBeNull();
    expect(res.headers.get('retry-after')).toBeNull();
    const text = await res.text();
    expect(text.startsWith('event:')).toBe(false);
    expect(text.startsWith('data:')).toBe(false);
    expect(JSON.parse(text)).toEqual(expectedBody(path));
    expect(settles).toBe(1);
  });

  it.each(wires)('preserves the BR-REL-Q7 no-route 503 ($path stream=$stream)', async ({ path, stream }) => {
    let settles = 0;
    const app = rejectingRouter(realMeshPlanner(emptyMeshDirectory()), () => { settles += 1; });
    const res = await sendUnknown(app, path, KNOWN_MODEL, stream);
    expect(res.status).toBe(503);
    const message = `No route available for model: "${KNOWN_MODEL}"`;
    expect(JSON.parse(await res.text())).toEqual(path === '/v1/messages'
      ? { type: 'error', error: { type: 'api_error', message } }
      : { error: { message, type: 'server_error', code: 'no_route' } });
    expect(res.headers.get('x-should-retry')).toBe('false');
    expect(res.headers.get('retry-after')).toBeNull();
    expect(settles).toBe(1);
  });

  const emptyPlanPlanner: RoutePlanner = {
    async plan() {
      return { planRef: 'plan-empty', expiresAt: '2027-01-01T00:00:00Z', candidateRefs: [],
        policy: stubPolicy, councilRevision: 'fixture', diagnostics: [] };
    },
    async prepareAttempt() { throw new Error('unused'); },
    describeAffinity() { return null; },
    promoteAffinity() { throw new Error('unused'); },
    rebindAffinity() { throw new Error('unused'); },
    resetAffinity() { return false; },
  };

  it.each(wires)('preserves the empty-plan no-route 503 when the sink rejects ($path stream=$stream)', async ({ path, stream }) => {
    let settles = 0;
    const app = rejectingRouter(emptyPlanPlanner, () => { settles += 1; });
    const res = await sendUnknown(app, path, KNOWN_MODEL, stream);
    expect(res.status).toBe(503);
    const message = `No route available for model: "${KNOWN_MODEL}"`;
    const text = await res.text();
    expect(JSON.parse(text)).toEqual(path === '/v1/messages'
      ? { type: 'error', error: { type: 'api_error', message } }
      : { error: { message, type: 'server_error', code: 'no_route' } });
    expect(text).not.toContain('overloaded');
    expect(res.headers.get('content-type')).toMatch(/^application\/json/);
    expect(res.headers.get('x-should-retry')).toBe('false');
    expect(res.headers.get('retry-after')).toBeNull();
    expect(text.startsWith('event:')).toBe(false);
    expect(text.startsWith('data:')).toBe(false);
    expect(settles).toBe(1);
  });

  it.each(wires)('keeps the empty-plan no-route 503 with an accepting sink ($path stream=$stream)', async ({ path, stream }) => {
    const calls = freshCalls();
    const app = unknownModelRouter({ planner: emptyPlanPlanner, calls });
    const res = await sendUnknown(app, path, KNOWN_MODEL, stream);
    expect(res.status).toBe(503);
    const message = `No route available for model: "${KNOWN_MODEL}"`;
    const text = await res.text();
    expect(JSON.parse(text)).toEqual(path === '/v1/messages'
      ? { type: 'error', error: { type: 'api_error', message } }
      : { error: { message, type: 'server_error', code: 'no_route' } });
    expect(res.headers.get('x-should-retry')).toBe('false');
    expect(res.headers.get('retry-after')).toBeNull();
    expect(text.startsWith('event:')).toBe(false);
    expect(text.startsWith('data:')).toBe(false);
    expect(calls.settlements).toHaveLength(1);
    expect(calls.settlements[0]).toMatchObject({
      outcome: 'failed', requestedModel: KNOWN_MODEL, attempts: [],
    });
    expect(calls.dispatch).toEqual({ generate: 0, stream: 0 });
  });

  it.each(wires)('preserves the enrollment 503 ($path stream=$stream)', async ({ path, stream }) => {
    let settles = 0;
    const planner: RoutePlanner = {
      async plan() {
        throw {
          name: 'RoutePlanError', code: 'no-route',
          diagnostic: { code: 'reauth-required', transportProviderId: 'cloud-code' },
        };
      },
      async prepareAttempt() { throw new Error('unused'); },
      describeAffinity() { return null; },
      promoteAffinity() { throw new Error('unused'); },
      rebindAffinity() { throw new Error('unused'); },
      resetAffinity() { return false; },
    };
    const app = rejectingRouter(planner, () => { settles += 1; });
    const res = await sendUnknown(app, path, KNOWN_MODEL, stream);
    expect(res.status).toBe(503);
    expect(res.headers.get('x-sentropic-route-action')).toBe('reauthenticate-cloud-code');
    const body = JSON.parse(await res.text());
    expect(body).toEqual(path === '/v1/messages'
      ? { type: 'error', error: { type: 'authentication_error', message: 'cloud-code reauthenticate required' } }
      : { error: { message: 'cloud-code reauthenticate required',
        type: 'authentication_error', code: 'provider_auth_required' } });
    expect(settles).toBe(1);
  });
});

describe('terminal upstream 404 survives post-dispatch callback failures (non-budget)', () => {
  const wires = [
    { path: '/v1/messages', stream: false },
    { path: '/v1/messages', stream: true },
    { path: '/v1/chat/completions', stream: false },
    { path: '/v1/chat/completions', stream: true },
  ];

  const expectedKnownBody = (path: string): unknown => path === '/v1/messages'
    ? { type: 'error', error: { type: 'not_found_error', message: `Unknown model: "${KNOWN_MODEL}"` } }
    : { error: { message: `Unknown model: "${KNOWN_MODEL}"`,
      type: 'invalid_request_error', code: 'model_not_found' } };

  const terminalPlanner = (recordOutcome: () => Promise<void>): RoutePlanner => ({
    async plan() {
      return { planRef: 'plan-1', expiresAt: '2027-01-01T00:00:00Z', candidateRefs: ['candidate-0'],
        policy: stubPolicy, councilRevision: 'fixture', diagnostics: [{
          candidateRef: 'candidate-0', diagnosticAccountRef: 'account-0', requestedModel: KNOWN_MODEL,
          actualProviderId: 'openai', actualModelId: 'actual-model-x',
          actualTransportProviderId: 'codex', reason: 'exact' as const, cacheContinuityRisk: false }] };
    },
    async prepareAttempt() {
      return { attemptRef: 'attempt-0',
        async generate() { throw new Error('unused'); },
        async stream() { throw new Error('unused'); },
        async recordOutcome() { await recordOutcome(); },
        async markCommitted() {}, async complete() {}, async releaseCancelled() {} };
    },
    describeAffinity() { return null; },
    promoteAffinity() { throw new Error('unused'); },
    rebindAffinity() { throw new Error('unused'); },
    resetAffinity() { return false; },
  });

  const callbackRouter = (input: {
    readonly recordOutcome: () => Promise<void>;
    readonly settleRoute: (value: RouteRequestSettlement) => Promise<void>;
    readonly calls: { dispatch: { generate: number; stream: number }; settles: number };
  }): ReturnType<typeof unknownModelRouter> => createGatewayRouter({
    config: { ...stubGatewayConfig, callerAuth: unknownCallerAuth },
    routePlanner: terminalPlanner(input.recordOutcome),
    routeDispatch: {
      async generate() { input.calls.dispatch.generate += 1; throw { status: 404 }; },
      async stream() { input.calls.dispatch.stream += 1; throw { status: 404 }; },
    },
    routeMetering: { async settleRoute(value: RouteRequestSettlement) {
      input.calls.settles += 1;
      await input.settleRoute(value);
    } },
    requestId: () => 'req_unknown',
  });

  it.each(wires)('upstream 404 with rejecting settlement sink keeps the frozen 404 ($path stream=$stream)',
    async ({ path, stream }) => {
      const calls = { dispatch: { generate: 0, stream: 0 }, settles: 0 };
      let outcomes = 0;
      const app = callbackRouter({ calls,
        recordOutcome: async () => { outcomes += 1; },
        settleRoute: async () => { throw Object.assign(Error('sink down'), { status: 500 }); },
      });
      const res = await sendUnknown(app, path, KNOWN_MODEL, stream);
      expect(res.status).toBe(404);
      expect(res.headers.get('content-type')).toMatch(/^application\/json/);
      expect(res.headers.get('x-sentropic-request-id')).toBe('req_unknown');
      expect(res.headers.get('x-sentropic-served')).toContain('model=actual-model-x');
      expect(res.headers.get('retry-after')).toBeNull();
      expect(res.headers.get('x-should-retry')).toBeNull();
      // A pre-commit refusal is JSON, never an SSE prefix — even for stream:true.
      const text = await res.text();
      expect(text.startsWith('event:')).toBe(false);
      expect(text.startsWith('data:')).toBe(false);
      expect(text).not.toContain('overloaded');
      expect(JSON.parse(text)).toEqual(expectedKnownBody(path));
      expect(stream ? calls.dispatch.stream : calls.dispatch.generate).toBe(1);
      expect(outcomes).toBe(1);
      expect(calls.settles).toBe(1);
    });

  it.each(wires)('upstream 404 with rejecting recordOutcome keeps the frozen 404 ($path stream=$stream)',
    async ({ path, stream }) => {
      const calls = { dispatch: { generate: 0, stream: 0 }, settles: 0 };
      const settlements: RouteRequestSettlement[] = [];
      const app = callbackRouter({ calls,
        recordOutcome: async () => { throw Object.assign(Error('hook down'), { status: 500 }); },
        settleRoute: async (value: RouteRequestSettlement) => { settlements.push(value); },
      });
      const res = await sendUnknown(app, path, KNOWN_MODEL, stream);
      expect(res.status).toBe(404);
      expect(res.headers.get('content-type')).toMatch(/^application\/json/);
      expect(res.headers.get('x-sentropic-request-id')).toBe('req_unknown');
      expect(res.headers.get('x-sentropic-served')).toContain('model=actual-model-x');
      expect(res.headers.get('retry-after')).toBeNull();
      expect(res.headers.get('x-should-retry')).toBeNull();
      const text = await res.text();
      expect(text.startsWith('event:')).toBe(false);
      expect(text.startsWith('data:')).toBe(false);
      expect(text).not.toContain('overloaded');
      expect(JSON.parse(text)).toEqual(expectedKnownBody(path));
      expect(stream ? calls.dispatch.stream : calls.dispatch.generate).toBe(1);
      expect(calls.settles).toBe(1);
      expect(settlements).toHaveLength(1);
      expect(settlements[0]).toMatchObject({
        outcome: 'failed', requestedModel: KNOWN_MODEL, attempts: [{ outcome: 'unsupported-model' }],
      });
    });
});

describe('admitted terminal refusal survives ledger/hook failures (router)', () => {
  const wires = [
    { path: '/v1/messages', stream: false },
    { path: '/v1/messages', stream: true },
    { path: '/v1/chat/completions', stream: false },
    { path: '/v1/chat/completions', stream: true },
  ];
  const failing404 = (recordOutcome: () => Promise<void>): PreparedRouteAttempt => ({
    attemptRef: 'attempt-404',
    generate: (async () => { throw { status: 404 }; }) as PreparedRouteAttempt['generate'],
    async stream() { throw { status: 404 }; },
    async recordOutcome() { await recordOutcome(); },
    async markCommitted() {}, async complete() {}, async releaseCancelled() {},
  });
  const admittedApp = (attempts: PreparedRouteAttempt[], recorder: ReturnType<typeof recordingBudget>,
    settle?: (value: RouteRequestSettlement) => Promise<void>) => {
    const { planner } = quotingPlanner(attempts);
    let settles = 0;
    return { planner, settles: () => settles, app: createGatewayRouter({
      config: { ...stubGatewayConfig, callerAuth: unknownCallerAuth },
      routePlanner: planner,
      routeMetering: { async settleRoute(value: RouteRequestSettlement) {
        settles += 1;
        if (settle) await settle(value);
        else { recorder.events.push('settle'); recorder.settlements.push(value); }
      } },
      budget: recorder.options, requestId: () => 'req_unknown',
    }) };
  };
  const expected404 = (path: string): unknown => path === '/v1/messages'
    ? { type: 'error', error: { type: 'not_found_error', message: `Unknown model: "${MODEL}"` } }
    : { error: { message: `Unknown model: "${MODEL}"`,
      type: 'invalid_request_error', code: 'model_not_found' } };

  it.each(wires)('admitted 404 + rejecting recordOutcome stays 404 ($path stream=$stream)', async ({ path, stream }) => {
    const recorder = recordingBudget();
    const { app, settles } = admittedApp([failing404(async () => { throw Error('hook down'); })], recorder);
    const res = await sendUnknown(app, path, MODEL, stream);
    expect(res.status).toBe(404);
    expect(JSON.parse(await res.text())).toEqual(expected404(path));
    expect(res.headers.get('x-sentropic-served')).toContain(`model=${MODEL}`);
    expect(settles()).toBe(1);
  });

  it.each(wires)('admitted 404 + rejecting ledger stays 404 with served model ($path stream=$stream)', async ({ path, stream }) => {
    const recorder = recordingBudget();
    const { app, settles } = admittedApp([failing404(async () => {})], recorder,
      async () => { recorder.events.push('settle'); throw Error('ledger down'); });
    const res = await sendUnknown(app, path, MODEL, stream);
    expect(res.status).toBe(404);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual(expected404(path));
    expect(text).not.toContain('overloaded');
    expect(res.headers.get('x-sentropic-served')).toContain(`model=${MODEL}`);
    expect(settles()).toBe(1);
    expect(recorder.events).toEqual(['admit', 'mark:hold-1:0', 'settle']);
  });

  it.each(wires)('admitted-plan unknown-model + ledger failure stays 404 ($path stream=$stream)', async ({ path, stream }) => {
    const typed = new RoutePlanError('Unknown requested model', 'unknown-model');
    const { planner } = quotingPlanner([], { plan: () => { throw typed; } });
    const recorder = recordingBudget();
    let settles = 0;
    const app = createGatewayRouter({
      config: { ...stubGatewayConfig, callerAuth: unknownCallerAuth }, routePlanner: planner,
      routeMetering: { async settleRoute() { settles += 1; recorder.events.push('settle'); throw Error('ledger down'); } },
      budget: recorder.options, requestId: () => 'req_unknown',
    });
    const res = await sendUnknown(app, path, MODEL, stream);
    expect(res.status).toBe(404);
    expect(JSON.parse(await res.text())).toEqual(expected404(path));
    expect(settles).toBe(1);
  });

  it.each(wires)('admitted empty plan + ledger failure stays Q7 503 ($path stream=$stream)', async ({ path, stream }) => {
    const { planner } = quotingPlanner([]);
    const recorder = recordingBudget();
    let settles = 0;
    const app = createGatewayRouter({
      config: { ...stubGatewayConfig, callerAuth: unknownCallerAuth }, routePlanner: planner,
      routeMetering: { async settleRoute() { settles += 1; recorder.events.push('settle'); throw Error('ledger down'); } },
      budget: recorder.options, requestId: () => 'req_unknown',
    });
    const res = await sendUnknown(app, path, MODEL, stream);
    expect(res.status).toBe(503);
    expect(res.headers.get('x-should-retry')).toBe('false');
    const text = await res.text();
    const message = `No route available for model: "${MODEL}"`;
    expect(JSON.parse(text)).toEqual(path === '/v1/messages'
      ? { type: 'error', error: { type: 'api_error', message } }
      : { error: { message, type: 'server_error', code: 'no_route' } });
    expect(text).not.toContain('overloaded');
    expect(settles).toBe(1);
  });

  it.each(wires)('admitted enrollment + ledger failure stays enrollment 503 ($path stream=$stream)', async ({ path, stream }) => {
    const enrollment = { name: 'RoutePlanError', code: 'no-route',
      diagnostic: { code: 'reauth-required', transportProviderId: 'cloud-code' } };
    const { planner } = quotingPlanner([], { plan: () => { throw enrollment; } });
    const recorder = recordingBudget();
    let settles = 0;
    const app = createGatewayRouter({
      config: { ...stubGatewayConfig, callerAuth: unknownCallerAuth }, routePlanner: planner,
      routeMetering: { async settleRoute() { settles += 1; recorder.events.push('settle'); throw Error('ledger down'); } },
      budget: recorder.options, requestId: () => 'req_unknown',
    });
    const res = await sendUnknown(app, path, MODEL, stream);
    expect(res.status).toBe(503);
    expect(res.headers.get('x-sentropic-route-action')).toBe('reauthenticate-cloud-code');
    const text = await res.text();
    expect(JSON.parse(text)).toEqual(path === '/v1/messages'
      ? { type: 'error', error: { type: 'authentication_error',
        message: 'cloud-code reauthenticate required' } }
      : { error: { message: 'cloud-code reauthenticate required',
        type: 'authentication_error', code: 'provider_auth_required' } });
    expect(text).not.toContain('overloaded');
    expect(settles).toBe(1);
  });
});
