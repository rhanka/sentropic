import { describe, expect, it } from 'vitest';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { InMemoryRoutePlanner, type GenerateResponse, type PreparedRouteAttempt, type StreamEvent } from '@sentropic/llm-mesh';
import { startGatewayHost } from '../src/node/gateway-host.js';
import { createGatewayControlClient } from '../src/node/control-client.js';
import type { MeshBinding } from '../src/node/host-types.js';
import { stubGatewayConfig } from '../src/stubs.js';
import { normalizeGatewayIngress } from '../src/canonical-ingress.js';
import { encodeGatewayResponse } from '../src/canonical-egress.js';
import { encodeGatewayStream } from '../src/canonical-stream.js';
import { StageRewriteEngine } from '../src/rewrite/stage-rewrite.js';

const MODEL = 'claude-sonnet-5';
const CONTRACT = {
  version: 1 as const, revision: 'p1', ownerScopeRef: 'owner-a', exactModels: [MODEL],
  authorizedAccountRefs: ['acct-1'], rotateAccounts: false, effortPolicy: { mode: 'preserve' as const },
};
const CACHE_USAGE = { inputTokens: 10, outputTokens: 5, totalTokens: 15, providerRawUsage: { cache_read_input_tokens: 8, cache_creation_input_tokens: 2 } };

const parityMesh = (): MeshBinding => ({
  ownerScopeRef: 'owner-a', keyring: { getSecret: async () => 'a'.repeat(64) }, unlockKeyring: async () => undefined,
  resolveOwner: (caller, ctx) => ({
    ownerScopeRef: caller.ownerScopeRef, tenantId: 't1', principalId: 'u1',
    workspaceId: caller.workspaceRef, source: 'parity', correlationId: ctx.requestId,
  }),
  gateway: { config: stubGatewayConfig, routeMetering: { settleRoute: () => undefined }, requestId: () => 'req-fixed' },
  createRoutePlanner: (options) => new InMemoryRoutePlanner({
    ...options,
    directory: {
      listEligible: async () => [{
        accountRef: 'acct-1', diagnosticAccountRef: 'diag-1', targetProviderId: 'anthropic',
        transportProviderId: 'claude-code', supportedModelIds: [MODEL],
        enrollmentCompletedAt: '2026-10-01T00:00:00Z', readiness: 'ready', revision: '1',
      }],
      prepareAttempt: async () => ({
        attemptRef: 'att-1',
        generate: async (): Promise<GenerateResponse> => ({
          id: 'resp-fixed', providerId: 'anthropic', modelId: MODEL,
          message: { role: 'assistant', content: 'hello' }, text: 'hello', toolCalls: [], finishReason: 'stop', usage: CACHE_USAGE,
        }),
        stream: async () => (async function* (): AsyncGenerator<StreamEvent> {
          yield { type: 'content_delta', data: { delta: 'hello' } };
          yield { type: 'done', data: { finishReason: 'stop', responseId: 'resp-fixed', usage: CACHE_USAGE } };
        })(),
        markCommitted: async () => undefined, complete: async () => undefined,
        releaseCancelled: async () => undefined, recordOutcome: async () => undefined,
      }) as unknown as PreparedRouteAttempt,
    },
  }),
});

describe('P2-3 & P2-5: default-OFF byte-identity parity with origin/main and Anthropic SSE/nested cache_control', () => {
  it('preserves origin/main byte-identity on startGatewayHost default options (no loopback mint, no capture dir, no rewrite, no cache usage drift)', async () => {
    const stateDir = await mkdtemp(join(tmpdir(), 'gw-default-off-'));
    const host = await startGatewayHost({ stateDir, mesh: parityMesh(), listen: { host: '127.0.0.1', port: 0 } });
    try {
      expect((await fetch(`${host.endpoint}/v1/session`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status).toBe(404);
      const control = createGatewayControlClient({ controlSocket: host.controlSocket });
      const issued = await control.acquireSession({ ownerScopeRef: 'owner-a', workspaceRef: 'w', clientSessionRef: 'def-1', routingContract: CONTRACT });
      const auth = { 'content-type': 'application/json', authorization: `Bearer ${issued.key}` };

      const msgJsonRes = await fetch(`${host.endpoint}/v1/messages`, { method: 'POST', headers: auth, body: JSON.stringify({ model: MODEL, messages: [{ role: 'user', content: 'hi' }] }) });
      expect(msgJsonRes.status).toBe(200);
      expect(await msgJsonRes.text()).toBe(JSON.stringify({
        id: 'resp-fixed', type: 'message', role: 'assistant', model: MODEL,
        content: [{ type: 'text', text: 'hello' }], stop_reason: 'end_turn', stop_sequence: null,
        usage: { input_tokens: 10, output_tokens: 5 },
      }));
      const receipt = await control.readReceipt({ ownerScopeRef: 'owner-a', receiptId: msgJsonRes.headers.get('x-sentropic-receipt')! });
      expect(receipt.originModel).toBeUndefined();
      expect(receipt.stageRewrites).toBeUndefined();
      expect(receipt.guardVerdict).toBeUndefined();

      const msgSseRes = await fetch(`${host.endpoint}/v1/messages`, { method: 'POST', headers: auth, body: JSON.stringify({ model: MODEL, stream: true, messages: [{ role: 'user', content: 'hi' }] }) });
      expect(msgSseRes.status).toBe(200);
      const msgSseText = await msgSseRes.text();
      expect(msgSseText).toContain('"usage":{"output_tokens":5}');
      expect(msgSseText).not.toContain('cache_read_input_tokens');

      const chatJsonRes = await fetch(`${host.endpoint}/v1/chat/completions`, { method: 'POST', headers: auth, body: JSON.stringify({ model: MODEL, messages: [{ role: 'user', content: 'hi' }] }) });
      expect(chatJsonRes.status).toBe(200);
      expect(await chatJsonRes.text()).toBe(JSON.stringify({
        id: 'resp-fixed', object: 'chat.completion', model: MODEL,
        choices: [{ index: 0, message: { role: 'assistant', content: 'hello' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      }));
      const chatSseRes = await fetch(`${host.endpoint}/v1/chat/completions`, { method: 'POST', headers: auth, body: JSON.stringify({ model: MODEL, stream: true, messages: [{ role: 'user', content: 'hi' }] }) });
      expect(chatSseRes.status).toBe(200);
      expect(await chatSseRes.text()).toContain('data: [DONE]\n\n');
      await expect(stat(join(stateDir, 'captures'))).rejects.toMatchObject({ code: 'ENOENT' });
    } finally { await host.stop(); await rm(stateDir, { recursive: true, force: true }); }
  });

  it('projects Anthropic SSE/JSON cache usage when enabled and extracts nested tool_result cache_control markers', async () => {
    const sampleResp: GenerateResponse = {
      id: 'r1', providerId: 'anthropic', modelId: MODEL, message: { role: 'assistant', content: 'ok' },
      text: 'ok', toolCalls: [], finishReason: 'stop', usage: CACHE_USAGE,
    };
    expect((encodeGatewayResponse('anthropic-messages', sampleResp).body as { usage: Record<string, number> }).usage)
      .toEqual({ input_tokens: 10, output_tokens: 5 });
    expect((encodeGatewayResponse('anthropic-messages', sampleResp, undefined, { includeCacheUsage: true }).body as { usage: Record<string, number> }).usage)
      .toEqual({ input_tokens: 10, output_tokens: 5, cache_creation_input_tokens: 2, cache_read_input_tokens: 8 });

    const events = async function* (): AsyncGenerator<StreamEvent> {
      yield { type: 'content_delta', data: { delta: 'ok' } };
      yield { type: 'done', data: { finishReason: 'stop', usage: CACHE_USAGE } };
    };
    const sseFrames: string[] = [];
    for await (const f of encodeGatewayStream('anthropic-messages', MODEL, 'r1', events(), { anthropicInputTokens: 10, includeCacheUsage: true })) {
      sseFrames.push(f.raw);
    }
    expect(sseFrames.join('')).toContain('"cache_creation_input_tokens":2');
    expect(sseFrames.join('')).toContain('"cache_read_input_tokens":8');

    const stateDir = await mkdtemp(join(tmpdir(), 'gw-cache-on-'));
    const host = await startGatewayHost({
      stateDir, mesh: parityMesh(), listen: { host: '127.0.0.1', port: 0 },
      stageRewrite: new StageRewriteEngine({ stageId: 'wkst:1', rules: [] }),
    });
    try {
      const control = createGatewayControlClient({ controlSocket: host.controlSocket });
      const issued = await control.acquireSession({ ownerScopeRef: 'owner-a', workspaceRef: 'w', clientSessionRef: 'c-1', routingContract: CONTRACT });
      const sseRes = await fetch(`${host.endpoint}/v1/messages`, {
        method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${issued.key}` },
        body: JSON.stringify({ model: MODEL, stream: true, messages: [{ role: 'user', content: 'hi' }] }),
      });
      expect(await sseRes.text()).toContain('"cache_read_input_tokens":8');
    } finally { await host.stop(); await rm(stateDir, { recursive: true, force: true }); }

    const ingress = normalizeGatewayIngress('anthropic-messages', {
      model: MODEL,
      messages: [{ role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu_1', content: [{ type: 'text', text: 'out', cache_control: { type: 'ephemeral' } }] }] }],
    });
    expect(ingress.request.providerOptions?.cacheControl).toEqual({
      messages: [{ messageIndex: 0, blockIndex: 0, subBlockIndex: 0, cache_control: { type: 'ephemeral' } }],
    });
  });
});
