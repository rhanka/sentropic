import { expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startGatewayHost } from '../src/node/gateway-host.js';
import { createGatewayControlClient } from '../src/node/control-client.js';
import { createGatewayRouter } from '../src/router/index.js';
import { durableHostFixture, model, routingContract } from './helpers/durable-host.js';
const body = JSON.stringify({ model, messages: [{ role: 'user', content: 'synthetic' }] });
it.each([true, false])('links selected identity without turning echoed identity or missing usage into evidence (reported: %s)', async (reported) => {
  const stateDir = await mkdtemp(join(tmpdir(), 'gw-model-receipt-'));
  const host = await startGatewayHost({ stateDir, mesh: durableHostFixture('a', !reported).mesh, listen: { host: '127.0.0.1', port: 0 } });
  try {
    const control = createGatewayControlClient({ controlSocket: host.controlSocket });
    const issued = await control.acquireSession({ ownerScopeRef: 'owner-a', workspaceRef: 'w', clientSessionRef: 'c', routingContract });
    const response = await fetch(`${host.endpoint}/v1/chat/completions`, { method: 'POST', headers: { authorization: `Bearer ${issued.key}`, 'content-type': 'application/json' }, body });
    expect(response.status, await response.text()).toBe(200);
    const receipt = await control.readReceipt({ ownerScopeRef: 'owner-a', receiptId: response.headers.get('x-sentropic-receipt')! });
    expect(receipt).toMatchObject({ model, attempts: 1, policyRevision: 'p1', settlement: 'stop', physicalAttempts: [{
      selectedModel: model, selectedProviderId: 'openai', selectedTransport: 'codex', outcome: 'success',
      observedServedModel: null, modelEvidence: 'selection-only', usage: reported ? { inputTokens: 1, outputTokens: 1 } : null }] });
    expect(JSON.stringify(receipt)).not.toContain(issued.key!);
  } finally { await host.stop(); await rm(stateDir, { recursive: true, force: true }); }
});
it('refuses effort outside the committed grant before dispatch with a named field', async () => {
  const stateDir = await mkdtemp(join(tmpdir(), 'gw-effort-grant-')); const f = durableHostFixture();
  const host = await startGatewayHost({ stateDir, mesh: f.mesh, listen: { host: '127.0.0.1', port: 0 } });
  try {
    const issued = await createGatewayControlClient({ controlSocket: host.controlSocket }).acquireSession({ ownerScopeRef: 'owner-a', workspaceRef: 'w', clientSessionRef: 'effort',
      routingContract: { ...routingContract, effortPolicy: { mode: 'preserve', allowedEfforts: ['high'] } } });
    const response = await fetch(`${host.endpoint}/v1/chat/completions`, { method: 'POST', headers: { authorization: `Bearer ${issued.key}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model, messages: [{ role: 'user', content: 'synthetic' }], reasoning_effort: 'low' }) });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: 'unsupported_parameter', param: 'reasoning.effort' } });
    expect(f.calls).toHaveLength(0);
  } finally { await host.stop(); await rm(stateDir, { recursive: true, force: true }); }
});
it('refuses a physical attempt whose durable acknowledgement fails before any provider call', async () => {
  const f = durableHostFixture();
  const app = createGatewayRouter({ ...f.mesh.gateway, routePlanner: f.mesh.createRoutePlanner({}),
    config: { ...f.mesh.gateway.config, callerAuth: { verify: async () => ({ ok: true, cost: {
      ownerScopeRef: 'owner-a', tenantId: 't', principalId: 'p', workspaceId: 'w', source: 'test', correlationId: 'r' } }) } },
    requestAudit: { admit: async () => ({ receiptId: 'receipt' }), beginAttempt: async () => { throw new Error('store unavailable'); } } });
  expect((await app.request('/v1/chat/completions', { method: 'POST', headers: { 'content-type': 'application/json' }, body })).status).toBe(503);
  expect(f.calls).toHaveLength(0);
});
it('terminates without retry and records observedServedModel in the error receipt when Muse or Codex adapters report a mismatched upstream model across JSON and SSE', async () => {
  const { CodexRuntimeClient, InMemoryRoutePlanner, MuseRuntimeClient } = await import('@sentropic/llm-mesh');
  type GenerateRequest = import('@sentropic/llm-mesh').GenerateRequest;
  type PreparedRouteAttempt = import('@sentropic/llm-mesh').PreparedRouteAttempt;
  const codexAuth = {
    auth: {
      material: { type: 'account-transport' as const, provider: 'codex' as const, accessToken: 'tok', accountId: 'acc' },
      descriptor: { sourceType: 'account-transport' as const, accountProviderId: 'codex' as const },
    },
  };
  const museAuth = {
    auth: {
      material: { type: 'account-transport' as const, provider: 'muse' as const, accessToken: 'tok', accountId: 'acc' },
      descriptor: { sourceType: 'account-transport' as const, accountProviderId: 'muse' as const },
    },
  };
  for (const mode of ['muse-json', 'muse-stream', 'codex-json', 'codex-stream'] as const) {
    const stateDir = await mkdtemp(join(tmpdir(), `gw-mismatch-${mode}-`));
    let dispatches = 0;
    const base = durableHostFixture();
    const codexClient = new CodexRuntimeClient({
      fetch: async () => new Response(new ReadableStream<Uint8Array>({
        start(controller) {
          const enc = new TextEncoder();
          controller.enqueue(enc.encode(`data: ${JSON.stringify({ type: 'response.created', response: { id: 'r1', model: 'wrong-upstream-model' } })}\n\n`));
          controller.enqueue(enc.encode(`data: ${JSON.stringify({ type: 'response.output_text.delta', delta: ' Leak' })}\n\n`));
          controller.enqueue(enc.encode(`data: ${JSON.stringify({ type: 'response.completed', response: { id: 'r1', model: 'wrong-upstream-model', usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } } })}\n\n`));
          controller.close();
        },
      }), { status: 200, headers: { 'content-type': 'text/event-stream' } }),
    });
    const museClient = new MuseRuntimeClient({
      fetch: async (_url, init) => {
        const reqBody = JSON.parse(String(init?.body ?? '{}')) as { stream?: boolean };
        if (reqBody.stream) {
          return new Response(new ReadableStream<Uint8Array>({
            start(controller) {
              const enc = new TextEncoder();
              controller.enqueue(enc.encode('data: {"model":"wrong-upstream-model","choices":[{"delta":{"content":"leak"},"finish_reason":"stop"}],"usage":{"prompt_tokens":1,"completion_tokens":1,"total_tokens":2}}\n\n'));
              controller.close();
            },
          }), { status: 200, headers: { 'content-type': 'text/event-stream' } });
        }
        return new Response(JSON.stringify({ id: 'm1', model: 'wrong-upstream-model', output_text: 'leak' }), {
          status: 200, headers: { 'content-type': 'application/json' },
        });
      },
    });
    const isMuse = mode.startsWith('muse-');
    const isStream = mode.endsWith('-stream');
    const targetModel = isMuse ? 'muse-spark-1.3-contributor' : model;
    const contract = { ...routingContract, exactModels: [targetModel], rotateAccounts: true, authorizedAccountRefs: ['internal-a', 'internal-b'] };
    const host = await startGatewayHost({
      stateDir,
      listen: { host: '127.0.0.1', port: 0 },
      mesh: {
        ...base.mesh,
        createRoutePlanner: (options) => new InMemoryRoutePlanner({
          ...options,
          directory: {
            listEligible: async () => [
              { accountRef: 'internal-a', diagnosticAccountRef: 'account-a', targetProviderId: isMuse ? 'muse' : 'openai', transportProviderId: isMuse ? 'muse' : 'codex', supportedModelIds: [targetModel], enrollmentCompletedAt: '2026-10-01T00:00:00Z', readiness: 'ready', revision: '1' },
              { accountRef: 'internal-b', diagnosticAccountRef: 'account-b', targetProviderId: isMuse ? 'muse' : 'openai', transportProviderId: isMuse ? 'muse' : 'codex', supportedModelIds: [targetModel], enrollmentCompletedAt: '2026-10-01T00:00:00Z', readiness: 'ready', revision: '1' },
            ],
            prepareAttempt: async (input) => ({
              attemptRef: `att-${++dispatches}-${input.accountRef}`,
              generate: (req: GenerateRequest) => isMuse ? museClient.generate(req, museAuth) : codexClient.generate(req, codexAuth),
              stream: (req: GenerateRequest) => isMuse ? museClient.stream(req, museAuth) : codexClient.stream(req, codexAuth),
              markCommitted: async () => undefined, complete: async () => undefined,
              releaseCancelled: async () => undefined, recordOutcome: async () => undefined,
            }) as unknown as PreparedRouteAttempt,
          },
        }),
      },
    });
    try {
      const control = createGatewayControlClient({ controlSocket: host.controlSocket });
      const issued = await control.acquireSession({ ownerScopeRef: 'owner-a', workspaceRef: 'w', clientSessionRef: `c-${mode}`, routingContract: contract });
      const res = await fetch(`${host.endpoint}/v1/chat/completions`, {
        method: 'POST',
        headers: { authorization: `Bearer ${issued.key}`, 'content-type': 'application/json' },
        body: JSON.stringify({ model: targetModel, stream: isStream, messages: [{ role: 'user', content: 'hi' }] }),
      });
      expect(res.status, mode).toBe(404);
      expect(dispatches, mode).toBe(1);
      const receipt = await control.readReceipt({ ownerScopeRef: 'owner-a', receiptId: res.headers.get('x-sentropic-receipt')! });
      expect(receipt).toMatchObject({
        settlement: 'error',
        attempts: 1,
        physicalAttempts: [{
          selectedModel: targetModel,
          outcome: 'unsupported-model',
          observedServedModel: 'wrong-upstream-model',
          modelEvidence: 'provider-reported',
        }],
      });
    } finally {
      await host.stop();
      await rm(stateDir, { recursive: true, force: true });
    }
  }
});
it.each([['created-first', 'gpt-6-astra', 'gpt-6.1-sol'], ['completed-first', 'gpt-6.1-sol', 'gpt-6-astra']])(
  'fails JSON when Codex created/completed identities differ (%s)',
  async (_label, createdModel, completedModel) => {
    const { CodexRuntimeClient, InMemoryRoutePlanner } = await import('@sentropic/llm-mesh');
    let dispatches = 0;
    const base = durableHostFixture();
    const codexClient = new CodexRuntimeClient({
      fetch: async () => new Response(new ReadableStream<Uint8Array>({
        start(controller) {
          const enc = new TextEncoder();
          controller.enqueue(enc.encode(`data: ${JSON.stringify({ type: 'response.created', response: { id: 'r1', model: createdModel } })}\n\n`));
          controller.enqueue(enc.encode(`data: ${JSON.stringify({ type: 'response.output_text.delta', delta: 'hi' })}\n\n`));
          controller.enqueue(enc.encode(`data: ${JSON.stringify({ type: 'response.completed', response: { id: 'r1', model: completedModel, usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } } })}\n\n`));
          controller.close();
        },
      }), { status: 200, headers: { 'content-type': 'text/event-stream' } }),
    });
    const host = await startGatewayHost({
      stateDir: await mkdtemp(join(tmpdir(), 'gw-codex-order-')),
      listen: { host: '127.0.0.1', port: 0 },
      mesh: {
        ...base.mesh,
        createRoutePlanner: (options) => new InMemoryRoutePlanner({
          ...options,
          directory: {
            listEligible: async () => [
              { accountRef: 'internal-a', diagnosticAccountRef: 'account-a', targetProviderId: 'openai', transportProviderId: 'codex', supportedModelIds: [model], enrollmentCompletedAt: '2026-10-01T00:00:00Z', readiness: 'ready', revision: '1' },
            ],
            prepareAttempt: async (input) => ({
              attemptRef: `att-${++dispatches}-${input.accountRef}`,
              generate: (req) => codexClient.generate(req, { auth: { material: { type: 'account-transport', provider: 'codex', accessToken: 'tok', accountId: 'acc' }, descriptor: { sourceType: 'account-transport', accountProviderId: 'codex' } } }),
              stream: (req) => codexClient.stream(req, { auth: { material: { type: 'account-transport', provider: 'codex', accessToken: 'tok', accountId: 'acc' }, descriptor: { sourceType: 'account-transport', accountProviderId: 'codex' } } }),
              markCommitted: async () => undefined, complete: async () => undefined,
              releaseCancelled: async () => undefined, recordOutcome: async () => undefined,
            }),
          },
        }),
      },
    });
    try {
      const control = createGatewayControlClient({ controlSocket: host.controlSocket });
      const issued = await control.acquireSession({ ownerScopeRef: 'owner-a', workspaceRef: 'w', clientSessionRef: `c-order-${_label}`, routingContract });
      const res = await fetch(`${host.endpoint}/v1/chat/completions`, {
        method: 'POST',
        headers: { authorization: `Bearer ${issued.key}`, 'content-type': 'application/json' },
        body: JSON.stringify({ model, messages: [{ role: 'user', content: 'hi' }] }),
      });
      expect(res.status, String(_label)).toBe(404);
      expect(dispatches, String(_label)).toBe(1);
      const receipt = await control.readReceipt({ ownerScopeRef: 'owner-a', receiptId: res.headers.get('x-sentropic-receipt')! });
      expect(receipt).toMatchObject({
        settlement: 'error',
        physicalAttempts: [{ selectedModel: model, outcome: 'unsupported-model', observedServedModel: 'gpt-6-astra', modelEvidence: 'provider-reported' }],
      });
    } finally {
      await host.stop();
    }
  },
);
it.each(['sse-error', 'transport-failure'] as const)(
  'terminates without rotating accounts and retains contradictory created identity when Codex stream later fails (%s)',
  async (failureKind) => {
    const { CodexRuntimeClient, InMemoryRoutePlanner } = await import('@sentropic/llm-mesh');
    const stateDir = await mkdtemp(join(tmpdir(), `gw-codex-fail-${failureKind}-`));
    let dispatches = 0;
    const base = durableHostFixture();
    const codexClient = new CodexRuntimeClient({
      fetch: async () => new Response(new ReadableStream<Uint8Array>({
        start(controller) {
          const enc = new TextEncoder();
          controller.enqueue(enc.encode(`data: ${JSON.stringify({ type: 'response.created', response: { id: 'r1', model: 'gpt-6-astra' } })}\n\n`));
          if (failureKind === 'sse-error') {
            controller.enqueue(enc.encode(`data: ${JSON.stringify({ type: 'error', error: { message: 'rate limit', code: 'rate_limit_exceeded', retryable: true } })}\n\n`));
            controller.close();
          }
        },
        pull() {
          if (failureKind === 'transport-failure') {
            throw new Error('upstream transport read reset');
          }
        },
      }), { status: 200, headers: { 'content-type': 'text/event-stream' } }),
    });
    const contract = { ...routingContract, authorizedAccountRefs: ['internal-a', 'internal-b'], rotateAccounts: true };
    const host = await startGatewayHost({
      stateDir,
      listen: { host: '127.0.0.1', port: 0 },
      mesh: {
        ...base.mesh,
        createRoutePlanner: (options) => new InMemoryRoutePlanner({
          ...options,
          directory: {
            listEligible: async () => ['a', 'b'].map((letter) => ({
              accountRef: `internal-${letter}`,
              diagnosticAccountRef: `account-${letter}`,
              targetProviderId: 'openai',
              transportProviderId: 'codex',
              supportedModelIds: [model],
              enrollmentCompletedAt: '2026-10-01T00:00:00Z',
              readiness: 'ready' as const,
              revision: '1',
            })),
            prepareAttempt: async (input) => ({
              attemptRef: `att-${++dispatches}-${input.accountRef}`,
              generate: (req) => codexClient.generate(req, { auth: { material: { type: 'account-transport', provider: 'codex', accessToken: 'tok', accountId: 'acc' }, descriptor: { sourceType: 'account-transport', accountProviderId: 'codex' } } }),
              stream: (req) => codexClient.stream(req, { auth: { material: { type: 'account-transport', provider: 'codex', accessToken: 'tok', accountId: 'acc' }, descriptor: { sourceType: 'account-transport', accountProviderId: 'codex' } } }),
              markCommitted: async () => undefined, complete: async () => undefined,
              releaseCancelled: async () => undefined, recordOutcome: async () => undefined,
            }),
          },
        }),
      },
    });
    try {
      const control = createGatewayControlClient({ controlSocket: host.controlSocket });
      const issued = await control.acquireSession({ ownerScopeRef: 'owner-a', workspaceRef: 'w', clientSessionRef: `c-fail-${failureKind}`, routingContract: contract });
      const res = await fetch(`${host.endpoint}/v1/chat/completions`, {
        method: 'POST',
        headers: { authorization: `Bearer ${issued.key}`, 'content-type': 'application/json' },
        body: JSON.stringify({ model, messages: [{ role: 'user', content: 'hi' }] }),
      });
      expect(res.status, failureKind).toBe(404);
      expect(dispatches, failureKind).toBe(1);
      const receipt = await control.readReceipt({ ownerScopeRef: 'owner-a', receiptId: res.headers.get('x-sentropic-receipt')! });
      expect(receipt).toMatchObject({
        settlement: 'error',
        attempts: 1,
        physicalAttempts: [{
          selectedModel: model,
          outcome: 'unsupported-model',
          observedServedModel: 'gpt-6-astra',
          modelEvidence: 'provider-reported',
        }],
      });
    } finally {
      await host.stop();
      await rm(stateDir, { recursive: true, force: true });
    }
  },
);
