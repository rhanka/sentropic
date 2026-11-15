import { describe, expect, it, vi } from 'vitest';
import { CloudCodeRuntimeClient } from '../../src/transport/cloud-code-runtime-client.js';
import { CLOUD_CODE_FETCH_AVAILABLE_MODELS_URL } from '../../src/enrollment/cloud-code.js';
import { CLOUD_CODE_STREAM_URL } from '../../src/transport/cloud-code-transport.js';

const context = {
  auth: {
    material: {
      type: 'account-transport' as const, provider: 'cloud-code' as const,
      accessToken: 'fixture-token', accountId: 'cloud-account-argon',
      metadata: { stableSessionId: 'stable-argon', cloudaicompanionProject: 'project-argon' },
    },
    descriptor: { sourceType: 'account-transport' as const, accountProviderId: 'cloud-code' as const },
  },
};

/**
 * Fixture of the Cloud Code gate measured on 2026-11-15 against a real seat:
 * a client announcing `antigravity/cli/<1.3.0` without a `cl=` changelist gets
 * a catalogue without Argon and a 404 NOT_FOUND on Argon generation, while the
 * provider CLI identity (agy 1.5.9) gets Argon in both.
 */
const announcesArgonCapableClient = (userAgent: string): boolean => {
  const match = /^antigravity\/cli\/(\d+)\.(\d+)\.(\d+) \(([^)]*)\)$/.exec(userAgent);
  if (!match) return false;
  const [major, minor] = [Number(match[1]), Number(match[2])];
  return major > 1 || (major === 1 && minor >= 3) || /(^|; )cl=\d+/.test(match[4]);
};

const gatedFetch = () => vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
  const userAgent = new Headers(init?.headers).get('user-agent') ?? '';
  const argon = announcesArgonCapableClient(userAgent);
  if (url.toString() === CLOUD_CODE_FETCH_AVAILABLE_MODELS_URL) {
    const models = ['gemini-3.8-flash-tiered', ...(argon
      ? ['gemini-4-argon-low', 'gemini-4-argon-medium', 'gemini-4-argon-high']
      : [])];
    return new Response(JSON.stringify({
      models: Object.fromEntries(models.map((id) => [id, {}])),
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  }
  const wireModel = String(JSON.parse(String(init?.body ?? '{}')).model ?? '');
  if (!argon && wireModel.includes('argon')) {
    return new Response(JSON.stringify({
      error: { code: 404, message: 'Requested entity was not found.', status: 'NOT_FOUND' },
    }), { status: 404, headers: { 'content-type': 'application/json' } });
  }
  const payload = { response: { candidates: [{ content: { parts: [{ text: 'OK' }] }, finishReason: 'STOP' }] } };
  return new Response(`data: ${JSON.stringify(payload)}\n\n`, {
    status: 200, headers: { 'content-type': 'text/event-stream' },
  });
});

describe('Cloud Code client identity', () => {
  it('should reach gemini-4-argon like the provider CLI when the seat is enrolled', async () => {
    const fetchFn = gatedFetch();
    const client = new CloudCodeRuntimeClient(fetchFn);

    const response = await client.generate({
      providerId: 'gemini', modelId: 'gemini-4-argon',
      messages: [{ role: 'user', content: 'Reply with exactly: OK' }],
      reasoning: { effort: 'low' },
    }, context);

    expect(response.text).toBe('OK');
    const stream = fetchFn.mock.calls.find(([url]) => url.toString() === CLOUD_CODE_STREAM_URL);
    expect(JSON.parse(String(stream?.[1]?.body))).toMatchObject({ model: 'gemini-4-argon-low' });
  });

  it('should announce one client identity on catalogue and generation requests', async () => {
    const fetchFn = gatedFetch();
    await new CloudCodeRuntimeClient(fetchFn).generate({
      providerId: 'gemini', modelId: 'gemini-3.8-flash',
      messages: [{ role: 'user', content: 'hello' }],
    }, context);

    const agents = fetchFn.mock.calls.map(([, init]) => new Headers(init?.headers).get('user-agent'));
    expect(agents).toHaveLength(2);
    expect(new Set(agents).size).toBe(1);
  });

  it('should classify a model missing from the catalogue as a 404 model_not_found', async () => {
    const fetchFn = gatedFetch();
    const client = new CloudCodeRuntimeClient(fetchFn);

    await expect(client.generate({
      providerId: 'gemini', modelId: 'gemini-9.9-unknown',
      messages: [{ role: 'user', content: 'hello' }],
    }, context)).rejects.toMatchObject({ statusCode: 404, code: 'model_not_found' });
  });
});
