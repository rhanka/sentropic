import { describe, expect, it, vi } from 'vitest';
import type { AccountTransportAcquisition } from '../../src/account-transports.js';
import type { ProviderRequest } from '../../src/service/facade.js';
import {
  CLOUD_CODE_STREAM_URL,
  CLOUD_CODE_USER_AGENT,
  CloudCodeProviderAdapter,
  buildCloudCodeRequest,
} from '../../src/transport/cloud-code-transport.js';

function createMockAcquisition(project = 'test-cloud-code-proj'): {
  acquisition: AccountTransportAcquisition;
  outcomes: any[];
} {
  const outcomes: any[] = [];
  const acquisition: AccountTransportAcquisition = {
    material: {
      type: 'account-transport',
      provider: 'cloud-code',
      accessToken: 'token-abc-123',
      accountId: 'acct_cc_999',
      metadata: { cloudaicompanionProject: project },
    },
    descriptor: {
      sourceType: 'account-transport',
      accountProviderId: 'cloud-code',
      accountId: 'acct_cc_999',
    },
    lease: {
      leaseId: 'lease_1',
      accountId: 'acct_cc_999',
      stableSessionId: 'session_1',
      createdAt: new Date().toISOString(),
    },
    reservation: {
      reservationId: 'reservation_foo-bar',
      accountId: 'acct_cc_999',
      leaseId: 'lease_1',
      expiresAt: new Date().toISOString(),
    },
    runtime: {
      stableSessionId: 'session_1',
      metadata: { cloudaicompanionProject: project },
    },
    async recordOutcome(outcome) {
      outcomes.push(outcome);
    },
  };

  return { acquisition, outcomes };
}

describe('Cloud Code Transport', () => {
  it('builds a valid daily-cloudcode request envelope with exact UA, UUID requestId (P1-2), and no project fallback', () => {
    const { acquisition } = createMockAcquisition('proj-xyz');
    const request: ProviderRequest = {
      modelId: 'gemini-2.5-flash',
      contents: [{ role: 'user', parts: [{ text: 'Hello Cloud Code' }] }],
    };

    const built = buildCloudCodeRequest(acquisition, request);
    expect(built.url).toBe(CLOUD_CODE_STREAM_URL);
    expect(built.headers['User-Agent']).toBe(CLOUD_CODE_USER_AGENT);
    expect(built.headers.Authorization).toBe('Bearer token-abc-123');
    expect(built.body.project).toBe('proj-xyz');
    expect(built.body.model).toBe('gemini-2.5-flash');
    expect(built.body.userAgent).toBe('antigravity');
    // P1-2: UUID v4 check
    expect(built.body.requestId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
  });

  it('throws an error if cloudaicompanionProject is missing from acquisition metadata', () => {
    const { acquisition } = createMockAcquisition('');
    (acquisition.runtime as any).metadata = {};
    (acquisition.material as any).metadata = {};

    expect(() =>
      buildCloudCodeRequest(acquisition, {
        modelId: 'gemini-2.5-flash',
        contents: [],
      }),
    ).toThrow('cloudaicompanionProject is required');
  });

  it('executes a 200 OK stream, yields done event exactly once (P1-1), and records success outcome', async () => {
    const { acquisition, outcomes } = createMockAcquisition();
    const mockStream = new ReadableStream({
      start(controller) {
        controller.enqueue(
          new TextEncoder().encode(
            'data: {"response":{"candidates":[{"content":{"parts":[{"text":"Hello from Cloud Code!"}]}}],"usageMetadata":{"promptTokens":10}}}\n\n',
          ),
        );
        controller.close();
      },
    });

    const mockFetch = vi.fn(async () => {
      return new Response(mockStream, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      });
    });

    const adapter = new CloudCodeProviderAdapter(mockFetch as unknown as typeof fetch);
    const controller = new AbortController();

    const events: any[] = [];
    for await (const event of adapter.execute(
      acquisition,
      { modelId: 'gemini-2.5-flash', contents: [] },
      controller.signal,
    )) {
      events.push(event);
    }

    expect(events.some((e) => e.kind === 'content' && e.delta.includes('Hello'))).toBe(true);
    // P1-1: Verify exactly ONE done event
    const doneEvents = events.filter((e) => e.kind === 'done');
    expect(doneEvents).toHaveLength(1);
    expect(doneEvents[0].usage).toEqual({ promptTokens: 10 });
    expect(outcomes).toEqual([{ status: 'success' }]);
  });

  it('records failed outcome on SSE stream read error (P0-6)', async () => {
    const { acquisition, outcomes } = createMockAcquisition();
    const errorStream = new ReadableStream({
      start(controller) {
        controller.error(new Error('Network connection reset mid-stream'));
      },
    });

    const mockFetch = vi.fn(async () => {
      return new Response(errorStream, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      });
    });

    const adapter = new CloudCodeProviderAdapter(mockFetch as unknown as typeof fetch);
    const controller = new AbortController();

    const events: any[] = [];
    for await (const event of adapter.execute(
      acquisition,
      { modelId: 'gemini-2.5-flash', contents: [] },
      controller.signal,
    )) {
      events.push(event);
    }

    expect(events).toEqual([
      {
        kind: 'error',
        code: 'stream_error',
        message: 'Network connection reset mid-stream',
      },
    ]);
    expect(outcomes).toEqual([{ status: 'failed', errorCode: 'stream_error' }]);
  });

  it('handles 401/403 auth_failed outcome', async () => {
    const { acquisition, outcomes } = createMockAcquisition();
    const mockFetch = vi.fn(async () => {
      return new Response('Unauthorized', { status: 401 });
    });

    const adapter = new CloudCodeProviderAdapter(mockFetch as unknown as typeof fetch);
    const controller = new AbortController();

    const events: any[] = [];
    for await (const event of adapter.execute(
      acquisition,
      { modelId: 'gemini-2.5-flash', contents: [] },
      controller.signal,
    )) {
      events.push(event);
    }

    expect(events).toEqual([
      {
        kind: 'error',
        code: 'auth_failed',
        message: 'Cloud Code authentication failed (401)',
      },
    ]);
    expect(outcomes).toEqual([{ status: 'auth_failed', providerStatusCode: 401 }]);
  });

  it('handles 429 rate_limited outcome with Retry-After', async () => {
    const { acquisition, outcomes } = createMockAcquisition();
    const mockFetch = vi.fn(async () => {
      return new Response('Rate limited', {
        status: 429,
        headers: { 'Retry-After': '10' },
      });
    });

    const adapter = new CloudCodeProviderAdapter(mockFetch as unknown as typeof fetch);
    const controller = new AbortController();

    const events: any[] = [];
    for await (const event of adapter.execute(
      acquisition,
      { modelId: 'gemini-2.5-flash', contents: [] },
      controller.signal,
    )) {
      events.push(event);
    }

    expect(events).toEqual([
      {
        kind: 'error',
        code: 'rate_limited',
        message: 'Cloud Code rate limit exceeded (429)',
      },
    ]);
    expect(outcomes).toEqual([
      {
        status: 'rate_limited',
        providerStatusCode: 429,
        retryAfterMs: 10000,
      },
    ]);
  });

  it('abort signal generates 0 outcome (Q2B abort=release)', async () => {
    const { acquisition, outcomes } = createMockAcquisition();
    const adapter = new CloudCodeProviderAdapter();
    const controller = new AbortController();
    controller.abort();

    const events: any[] = [];
    for await (const event of adapter.execute(
      acquisition,
      { modelId: 'gemini-2.5-flash', contents: [] },
      controller.signal,
    )) {
      events.push(event);
    }

    expect(events).toHaveLength(0);
    expect(outcomes).toHaveLength(0);
  });
});
