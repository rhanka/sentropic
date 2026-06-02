import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// BR-42f Lot 3 — focused VertexProviderRuntime unit test (mocked fetch + stubbed
// ADC mint). Proves the transport envelope (URL + `Authorization: Bearer`, NO
// `?key=`), the SSE reuse, the ADC token cache/single-flight/skew (D-ADC1), and
// the D-ERR1 error mapping. NO live Vertex call. The broader catalog/stream-
// matrix non-regression edits are Lot 4.
// ---------------------------------------------------------------------------

vi.mock('../../src/config/env', () => ({
  env: {
    VERTEX_PROJECT_ID: 'my-project',
    VERTEX_LOCATION: 'us-central1',
  },
}));

import {
  VertexProviderRuntime,
  parseVertexModelId,
  mintVertexAccessToken,
  __setVertexAdcMinter,
  __resetVertexTokenCache,
  type VertexStreamGenerateRequest,
} from '../../src/services/providers/vertex-provider';

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

describe('parseVertexModelId', () => {
  it('strips the @vertex qualifier into publisher + wire model', () => {
    expect(parseVertexModelId('google/gemini-3.5-flash@vertex')).toEqual({
      publisher: 'google',
      model: 'gemini-3.5-flash',
    });
  });

  it('throws on a malformed key', () => {
    expect(() => parseVertexModelId('gemini-3.5-flash')).toThrow();
  });
});

describe('VertexProviderRuntime.validateCredential (D-ADC2 sync)', () => {
  it('is ready when project + location are configured', () => {
    const runtime = new VertexProviderRuntime();
    expect(runtime.validateCredential().ok).toBe(true);
    expect(runtime.provider.status).toBe('ready');
  });
});

describe('VertexProviderRuntime transport envelope', () => {
  beforeEach(() => {
    __resetVertexTokenCache();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('builds the Vertex URL with a Bearer header and NO ?key=', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(makeReadableStream('data: {"candidates":[]}\n\n'), {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const runtime = new VertexProviderRuntime();
    const request: VertexStreamGenerateRequest = {
      mode: 'vertex-stream-generate-content',
      requestOptions: {
        project: 'my-project',
        location: 'us-central1',
        publisher: 'google',
        model: 'gemini-3.5-flash',
        body: { contents: [] },
      },
      credential: 'stub-bearer-token',
    };

    await runtime.streamGenerate(request);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      'https://us-central1-aiplatform.googleapis.com/v1' +
        '/projects/my-project/locations/us-central1' +
        '/publishers/google/models/gemini-3.5-flash' +
        ':streamGenerateContent?alt=sse',
    );
    expect(url).not.toContain('key=');
    const headers = init.headers as Record<string, string>;
    expect(headers.authorization).toBe('Bearer stub-bearer-token');
  });

  it('parses the identical Gemini SSE envelope into raw chunks', async () => {
    const sse = [
      'data: {"candidates":[{"content":{"parts":[{"text":"hi"}]}}]}',
      '',
      'data: {"candidates":[{"content":{"parts":[]},"finishReason":"STOP"}]}',
      '',
    ].join('\n');
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(makeReadableStream(sse), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const runtime = new VertexProviderRuntime();
    const stream = await runtime.streamGenerate({
      mode: 'vertex-stream-generate-content',
      requestOptions: {
        project: 'my-project',
        location: 'us-central1',
        publisher: 'google',
        model: 'gemini-3.5-flash',
        body: { contents: [] },
      },
      credential: 'stub-bearer-token',
    } satisfies VertexStreamGenerateRequest);

    const events = await collectEvents(stream);
    expect(events).toEqual([
      { candidates: [{ content: { parts: [{ text: 'hi' }] } }] },
      { candidates: [{ content: { parts: [] }, finishReason: 'STOP' }] },
    ]);
  });
});

describe('VertexProviderRuntime.normalizeError (D-ERR1)', () => {
  const runtime = new VertexProviderRuntime();

  it.each([
    [401, false],
    [403, false],
    [404, false],
    [429, true],
    [500, true],
    [503, true],
  ])('maps HTTP %i to retryable=%s', (status, retryable) => {
    const normalized = runtime.normalizeError({
      message: 'boom',
      status,
      code: 'PERMISSION_DENIED',
    });
    expect(normalized.providerId).toBe('vertex');
    expect(normalized.retryable).toBe(retryable);
    expect(normalized.code).toBe('PERMISSION_DENIED');
  });
});

describe('mintVertexAccessToken (D-ADC1 cache/single-flight/skew)', () => {
  beforeEach(() => {
    __resetVertexTokenCache();
  });
  afterEach(() => {
    __resetVertexTokenCache();
  });

  it('caches the minted token and reuses it before the skew window', async () => {
    const minter = vi.fn().mockResolvedValue({
      token: 'token-1',
      expiresAtMs: 10_000_000,
    });
    const restore = __setVertexAdcMinter(minter);

    const t1 = await mintVertexAccessToken({
      project: 'p',
      location: 'l',
      now: 1_000,
    });
    const t2 = await mintVertexAccessToken({
      project: 'p',
      location: 'l',
      now: 2_000,
    });

    expect(t1).toBe('token-1');
    expect(t2).toBe('token-1');
    expect(minter).toHaveBeenCalledTimes(1);
    restore();
  });

  it('re-mints once the token enters the 60s skew window', async () => {
    const minter = vi
      .fn()
      .mockResolvedValueOnce({ token: 'token-1', expiresAtMs: 100_000 })
      .mockResolvedValueOnce({ token: 'token-2', expiresAtMs: 200_000 });
    const restore = __setVertexAdcMinter(minter);

    const t1 = await mintVertexAccessToken({ project: 'p', location: 'l', now: 1_000 });
    // now within 60s of expiry (100_000 - 60_000 = 40_000) -> re-mint
    const t2 = await mintVertexAccessToken({ project: 'p', location: 'l', now: 50_000 });

    expect(t1).toBe('token-1');
    expect(t2).toBe('token-2');
    expect(minter).toHaveBeenCalledTimes(2);
    restore();
  });

  it('single-flights concurrent mints for the same key', async () => {
    let resolveMint: (value: { token: string; expiresAtMs: number }) => void = () => {};
    const minter = vi.fn().mockImplementation(
      () =>
        new Promise<{ token: string; expiresAtMs: number }>((resolve) => {
          resolveMint = resolve;
        }),
    );
    const restore = __setVertexAdcMinter(minter);

    const p1 = mintVertexAccessToken({ project: 'p', location: 'l', now: 1_000 });
    const p2 = mintVertexAccessToken({ project: 'p', location: 'l', now: 1_000 });
    resolveMint({ token: 'token-shared', expiresAtMs: 10_000_000 });

    const [t1, t2] = await Promise.all([p1, p2]);
    expect(t1).toBe('token-shared');
    expect(t2).toBe('token-shared');
    expect(minter).toHaveBeenCalledTimes(1);
    restore();
  });

  it('does not cache a failed mint (retries on the next call)', async () => {
    const minter = vi
      .fn()
      .mockRejectedValueOnce(new Error('mint failed'))
      .mockResolvedValueOnce({ token: 'token-ok', expiresAtMs: 10_000_000 });
    const restore = __setVertexAdcMinter(minter);

    await expect(
      mintVertexAccessToken({ project: 'p', location: 'l', now: 1_000 }),
    ).rejects.toThrow('mint failed');
    const t2 = await mintVertexAccessToken({ project: 'p', location: 'l', now: 2_000 });

    expect(t2).toBe('token-ok');
    expect(minter).toHaveBeenCalledTimes(2);
    restore();
  });
});
