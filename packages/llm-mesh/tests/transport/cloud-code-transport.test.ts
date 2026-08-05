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
      reservationId: 'reservation_test_123',
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
  it('builds a valid daily-cloudcode request envelope with exact UA and no project fallback', () => {
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

  it('executes a 200 OK stream and records success outcome', async () => {
    const { acquisition, outcomes } = createMockAcquisition();
    const mockStream = new ReadableStream({
      start(controller) {
        controller.enqueue(
          new TextEncoder().encode(
            'data: {"candidates":[{"content":{"parts":[{"text":"Hello from Cloud Code!"}]}}]}\n\n',
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
    expect(outcomes).toEqual([{ status: 'success' }]);
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
    expect(outcomes).toHaveLength(0); // Q2B: 0 outcome recorded on abort
  });
});
