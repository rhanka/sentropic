import { afterEach, describe, expect, it, vi } from 'vitest';

import { CloudCodePaProviderRuntime } from '../../src/services/providers/cloudcode-pa-provider';
import {
  ANTIGRAVITY_GENERATE_CONTENT_ENDPOINT,
  ANTIGRAVITY_STREAM_GENERATE_CONTENT_ENDPOINT,
} from '../../src/services/antigravity-provider-auth';

function makeReadableStream(payload: string): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(payload));
      controller.close();
    },
  });
}

async function collectEvents(iterable: AsyncIterable<unknown>): Promise<unknown[]> {
  const events: unknown[] = [];
  for await (const event of iterable) {
    events.push(event);
  }
  return events;
}

describe('CloudCodePaProviderRuntime', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('advertises zero catalog models and is validated only with an account token', () => {
    const runtime = new CloudCodePaProviderRuntime();
    expect(runtime.provider.providerId).toBe('cloudcode-pa');
    expect(runtime.listModels()).toEqual([]);
    expect(runtime.validateCredential().ok).toBe(false);
    expect(runtime.validateCredential('ya29-token').ok).toBe(true);
  });

  it('wraps the Gemini body with model+project and sends Antigravity headers, unwrapping .response', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({ response: { candidates: [{ content: { parts: [{ text: 'hi' }] } }] } }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );

    const runtime = new CloudCodePaProviderRuntime();
    const result = await runtime.generate({
      mode: 'antigravity-generate-content',
      requestOptions: {
        model: 'claude-sonnet-4-6',
        project: 'proj-123',
        body: { contents: [{ role: 'user', parts: [{ text: 'yo' }] }] },
      },
      credential: 'ya29-access',
    });

    // Response envelope unwrapped to the bare Gemini shape.
    expect(result).toEqual({ candidates: [{ content: { parts: [{ text: 'hi' }] } }] });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(ANTIGRAVITY_GENERATE_CONTENT_ENDPOINT);
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer ya29-access');
    expect(headers['Client-Metadata']).toContain('ANTIGRAVITY');
    expect(headers['User-Agent']).toContain('antigravity');
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body.model).toBe('claude-sonnet-4-6');
    expect(body.project).toBe('proj-123');
    expect(body.request).toEqual({ contents: [{ role: 'user', parts: [{ text: 'yo' }] }] });
  });

  it('rejects a dispatch without an enrolled account token (personal-passthrough)', async () => {
    const runtime = new CloudCodePaProviderRuntime();
    await expect(
      runtime.generate({
        mode: 'antigravity-generate-content',
        requestOptions: { model: 'gemini-3-pro-high', project: 'p', body: {} },
      }),
    ).rejects.toThrow(/account access token/i);
  });

  it('streams SSE chunks against the stream endpoint and unwraps each .response', async () => {
    const rawSse = [
      'data: {"response":{"candidates":[{"content":{"parts":[{"text":"a"}]}}]}}',
      '',
      'data: {"response":{"candidates":[{"content":{"parts":[{"text":"b"}]}}]}}',
      '',
    ].join('\n');

    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(makeReadableStream(rawSse), {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      }),
    );

    const runtime = new CloudCodePaProviderRuntime();
    const stream = await runtime.streamGenerate({
      mode: 'antigravity-stream-generate-content',
      requestOptions: { model: 'gemini-3-pro-high', project: 'proj', body: { contents: [] } },
      credential: 'ya29-access',
    });
    const events = await collectEvents(stream);

    expect(events).toEqual([
      { candidates: [{ content: { parts: [{ text: 'a' }] } }] },
      { candidates: [{ content: { parts: [{ text: 'b' }] } }] },
    ]);
    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toBe(ANTIGRAVITY_STREAM_GENERATE_CONTENT_ENDPOINT);
  });

  it('normalizes a google.rpc.Status error with retryability by HTTP status', async () => {
    const runtime = new CloudCodePaProviderRuntime();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ error: { status: 'RESOURCE_EXHAUSTED', message: 'quota' } }), {
        status: 429,
      }),
    );
    await expect(
      runtime.generate({
        mode: 'antigravity-generate-content',
        requestOptions: { model: 'gemini-3-pro-high', project: 'p', body: {} },
        credential: 'ya29-access',
      }),
    ).rejects.toMatchObject({ message: 'quota', status: 429, code: 'RESOURCE_EXHAUSTED' });
  });
});
