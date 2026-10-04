import { describe, expect, it } from 'vitest';
import { GatewayError, SAFEGUARDS_NOT_SUPPORTED_MESSAGE, runNativeCountTokens,
  type NativeCountTokensResult } from '../src/index.js';
import { COUNT_COST, countHarness, sendCount } from './fixtures/native-count.js';

describe('native count authentication, switch and model gates', () => {
  it.each([false, undefined])('requires exact enabled=true (%s), after caller authentication', async enabled => {
    const h = countHarness({ nativeMessagesEnabled: enabled });
    for (const safeguards of [false, true]) {
      const response = await sendCount(h, { model: 'unknown', ...(safeguards ? { safeguards: null } : {}) });
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ type: 'error', error: { type: 'invalid_request_error',
        message: safeguards ? SAFEGUARDS_NOT_SUPPORTED_MESSAGE
          : 'Token counting is not supported by this gateway route while native Messages is disabled.' } });
      expect(response.headers.has('x-sentropic-relay')).toBe(false);
    }
    expect(h.auth).toHaveBeenCalledTimes(2); expect(h.prepare).not.toHaveBeenCalled();
    expect(h.execute).not.toHaveBeenCalled();
  });
  it('rejects caller/partition before validation or the disabled switch', async () => {
    const denied = countHarness({ nativeMessagesEnabled: false });
    denied.options.config.callerAuth.verify = async () => ({ ok: false });
    const response = await sendCount(denied, {});
    expect(response.status).toBe(401); expect(await response.json()).toEqual({ type: 'error',
      error: { type: 'authentication_error', message: 'authentication failed' } });
    expect(denied.prepare).not.toHaveBeenCalled();
    const partition = countHarness();
    Object.assign(partition.options.config, { mode: 'cross-user-pool', crossUserPoolEnabled: false });
    expect((await sendCount(partition, {})).status).toBe(400);
    expect(partition.auth).toHaveBeenCalledTimes(1); expect(partition.prepare).not.toHaveBeenCalled();
  });
  it.each([null, [], {}, { model: '' }, { model: 2 }])('validates only object/nonempty model (%j)', async body => {
    const h = countHarness(); const response = await sendCount(h, body);
    expect(response.status).toBe(400); expect(h.auth).toHaveBeenCalledTimes(1);
    expect(h.prepare).not.toHaveBeenCalled(); expect(h.execute).not.toHaveBeenCalled();
  });
  it.each(['missing_port', 'missing_capability', 'wrong_model', 'wrong_provider', 'denied_model', 'version'])
    ('refuses known native-denied requests without dispatch (%s)', async reason => {
      const h = countHarness(reason === 'missing_port' ? { nativeCountTokens: undefined } : {});
      if (reason === 'missing_capability') h.prepare.mockResolvedValue(undefined);
      if (reason === 'wrong_model') h.prepare.mockResolvedValue({ ...h.capability, modelId: 'other' });
      if (reason === 'wrong_provider') h.prepare.mockResolvedValue({ ...h.capability, providerId: 'openai' });
      if (reason === 'denied_model') h.port.modelIds.length = 0;
      for (const safeguards of [false, true]) {
        const response = await sendCount(h, { model: h.model, ...(safeguards ? { safeguards: {} } : {}) },
          reason === 'version' ? { 'anthropic-version': 'unsupported' } : {});
        expect(response.status).toBe(400); expect(await response.json()).toEqual({ type: 'error',
          error: { type: 'invalid_request_error', message: safeguards ? SAFEGUARDS_NOT_SUPPORTED_MESSAGE
            : 'Token counting is not supported by this gateway route for this request.' } });
      }
      expect(h.execute).not.toHaveBeenCalled();
    });
  it('keeps genuinely unknown models at the existing model-only 404', async () => {
    const h = countHarness(); h.prepare.mockRejectedValue(new GatewayError('unknown-model', 'secret catalog'));
    const response = await sendCount(h, { model: 'absent' });
    expect(response.status).toBe(404); expect(await response.json()).toEqual({ type: 'error',
      error: { type: 'not_found_error', message: 'Unknown model: "absent"' } });
    expect(h.execute).not.toHaveBeenCalled();
  });
});

describe('opaque count JSON and native headers', () => {
  it('clones only the top level, preserves nested identity and returns JSON unchanged', async () => {
    const h = countHarness();
    const body = Object.freeze({ model: h.model, messages: [{ role: 'user', content: [{ type: 'image',
      source: { type: 'base64', data: 'opaque' } }] }], system: [{ text: 'system', cache_control: { type: 'ephemeral' } }],
      tools: [{ name: 'tool', future: ['unknown'] }], safeguards: null, container: { id: 'opaque' },
      mcp_servers: [{ url: 'https://caller.invalid' }], metadata: { owner: 'forged' }, unknown: { ordered: [2, 1] } });
    const before = JSON.stringify(body); const signal = new AbortController().signal;
    const result = await runNativeCountTokens({ enabled: true, port: h.port, rate: h.rate }, {
      body, cost: COUNT_COST, headers: {}, signal, requestId: 'server-id',
    });
    const sent = h.execute.mock.calls[0]![0];
    expect(sent.body).toEqual(body); expect(sent.body).not.toBe(body);
    for (const key of ['messages', 'system', 'tools', 'container', 'mcp_servers', 'metadata', 'unknown']) {
      expect(sent.body[key]).toBe(body[key as keyof typeof body]);
    }
    expect(JSON.stringify(body)).toBe(before);
    expect(Object.keys(sent.body).sort()).toEqual(Object.keys(body).sort());
    expect(sent).toEqual({ body, signal, requestId: 'server-id',
      headers: { forwarded: {}, anthropicVersion: '2023-06-01' } });
    expect(result).toBe(await h.execute.mock.results[0]!.value);
    expect(h.prepare).toHaveBeenCalledWith({ principalRef: COUNT_COST.principalId, ownerScopeRef: COUNT_COST.ownerScopeRef },
      { workspaceId: COUNT_COST.workspaceId, modelId: h.model, signal });
  });
  it('counts version-only requests with no beta, stream or ceiling insertion', async () => {
    const h = countHarness(); const body = { model: h.model, messages: [], future: { kept: true } };
    const response = await sendCount(h, body, { 'anthropic-version': '2023-06-01' });
    expect(response.status).toBe(200); expect(await response.json()).toEqual({ input_tokens: 0, future: { kept: true } });
    expect(h.execute.mock.calls[0]![0].body).toEqual(body);
    expect(h.execute.mock.calls[0]![0].headers.forwarded).toEqual({ 'anthropic-version': '2023-06-01' });
    expect(response.headers.get('x-sentropic-relay')).toBe('native');
    expect(response.headers.get('x-sentropic-request-id')).toBe('req-count');
    expect(response.headers.has('x-sentropic-served')).toBe(false);
  });
  it('keeps supplied stream/ceiling fields opaque and always responds with JSON', async () => {
    const h = countHarness(); const body = { model: h.model, stream: true, max_tokens: 'upstream-validates', safeguards: {} };
    const response = await sendCount(h, body);
    expect(h.execute.mock.calls[0]![0].body).toEqual(body);
    expect(response.status).toBe(200); expect(response.headers.get('content-type')).toContain('application/json');
  });
  it('shares closed request forwarding and native response exclusions with server-owned diagnostics', async () => {
    const h = countHarness({}, async () => ({ kind: 'json', status: 200, body: { input_tokens: 123 }, headers: {
      'anthropic-organization-id': 'accepted-org', 'anthropic-future': 'kept', 'request-id': 'upstream-id',
      connection: 'anthropic-hop', 'anthropic-hop': 'dropped', authorization: 'secret', 'set-cookie': 'secret',
      'anthropic-api-key': 'secret', 'x-sentropic-request-id': 'spoof', 'x-sentropic-relay': 'spoof',
      'content-length': '9999', 'unlisted-response': 'dropped',
    } }));
    const response = await sendCount(h, { model: h.model }, { 'AnThRoPiC-BeTa': 'future-feature',
      'anthropic-future': 'opaque', 'anthropic-api-key': 'caller-secret', 'x-sentropic-caller-token': 'internal',
      'user-agent': 'caller-agent', 'x-forwarded-for': '192.0.2.1', cookie: 'session',
      connection: 'x-stainless-drop', 'x-stainless-drop': 'nominated', 'x-stainless-keep': 'kept', 'x-app': 'app' });
    expect(h.execute.mock.calls[0]![0].headers).toEqual({ anthropicVersion: '2023-06-01', forwarded: {
      'anthropic-beta': 'future-feature', 'anthropic-future': 'opaque', 'x-stainless-keep': 'kept', 'x-app': 'app' } });
    expect(response.headers.get('anthropic-organization-id')).toBe('accepted-org');
    expect(response.headers.get('anthropic-future')).toBe('kept'); expect(response.headers.get('request-id')).toBe('upstream-id');
    expect(response.headers.get('x-sentropic-request-id')).toBe('req-count');
    expect(response.headers.get('x-sentropic-relay')).toBe('native');
    for (const name of ['anthropic-hop', 'authorization', 'set-cookie', 'anthropic-api-key', 'content-length', 'unlisted-response']) {
      expect(response.headers.has(name)).toBe(false);
    }
  });
  it('refuses a Connection-nominated version instead of silently replacing it', async () => {
    const h = countHarness(); const response = await sendCount(h, { model: h.model },
      { connection: 'Anthropic-Version', 'anthropic-version': '2023-06-01' });
    expect(response.status).toBe(400); expect(h.execute).not.toHaveBeenCalled();
  });
  it.each([-1, 0.5, Number.MAX_SAFE_INTEGER + 1, '2', undefined, null, NaN, Infinity])
    ('rejects invalid successful input_tokens %s without retry or relay', async input_tokens => {
      const h = countHarness({}, async () => ({ kind: 'json', status: 200, headers: {}, body: { input_tokens } }));
      const response = await sendCount(h); expect(response.status).toBe(503);
      expect(await response.json()).toEqual({ type: 'error', error: { type: 'api_error', message: 'upstream protocol failure' } });
      expect(h.execute).toHaveBeenCalledTimes(1); expect(response.headers.has('x-sentropic-relay')).toBe(false);
    });
  it.each([{ kind: 'stream' }, { status: 201 }, { body: [] }, { headers: null }, { headers: { secret: 3 } }])
    ('rejects malformed successful envelopes %j', async patch => {
      const h = countHarness({}, async () => ({ kind: 'json', status: 200, headers: {}, body: { input_tokens: 2 },
        ...patch } as unknown as NativeCountTokensResult));
      expect((await sendCount(h)).status).toBe(503); expect(h.execute).toHaveBeenCalledTimes(1);
    });
});
