import { RequestTooLargeError } from '@sentropic/llm-mesh';
import type { RoutePlanInput, RoutePlanner, VerifiedRoutingSubject } from '@sentropic/llm-mesh';
import { describe, expect, it } from 'vitest';
import { classifyRouteError, prepareRouteFlow, retainRouteBody, terminalGatewayError } from '../src/route-flow-core.js';
import { CheckedGatewayBody, GatewayBodyBytePool, toProviderShapedError } from '../src/index.js';
import { stubGatewayConfig } from '../src/stubs.js';

describe('route body retention (N07)', () => {
  const leased = () => {
    const pool = new GatewayBodyBytePool(64);
    const lease = pool.acquire(); lease.extend(9);
    return { pool, owner: new CheckedGatewayBody({ model: 'm' }, 9, lease) };
  };
  const preparedFor = () => ({
    cost: { tenantId: 't', principalId: 'u', source: 'test', correlationId: 'c' },
    subject: { principalRef: 'u', ownerScopeRef: 't:u', grants: [] },
    canonical: { request: { modelId: 'claude-sonnet-5', messages: [{ role: 'user', content: 'hi' }] }, requiredCapabilities: [{ capability: 'reasoning', required: true }] },
    plan: { planRef: 'p', expiresAt: '2027-01-01T00:00:00Z', candidateRefs: [], policy: {}, councilRevision: 'r', diagnostics: [] },
  });

  it('scrubs the retry projection when the owner detaches, keeping it dispatchable', () => {
    const { owner } = leased();
    const prepared = preparedFor() as unknown as Parameters<typeof retainRouteBody>[0];
    const request = { bodyLease: owner };
    retainRouteBody(prepared, request as Parameters<typeof retainRouteBody>[1]);
    expect(prepared.canonical.request.messages).toHaveLength(1);
    owner.detach();
    expect(prepared.canonical.request.messages).toEqual([]);
    expect(prepared.canonical.requiredCapabilities).toEqual([]);
    expect(prepared.canonical.requiredExecutionFeatures).toBeUndefined();
  });

  it('ignores requests without a checked owner', () => {
    const prepared = preparedFor() as unknown as Parameters<typeof retainRouteBody>[0];
    retainRouteBody(prepared, {} as Parameters<typeof retainRouteBody>[1]);
    expect(prepared.canonical.request.messages).toHaveLength(1);
  });
});

describe('terminal 413 preservation (N09)', () => {
  const target = { providerId: 'anthropic', transportProviderId: 'anthropic', model: 'claude-sonnet-5' };
  const size = { requestBytes: 111, limitBytes: 100, source: 'upstream' as const };

  it('keeps typed size evidence instead of collapsing into bad-request or pooled 503', () => {
    const error = new RequestTooLargeError(size);
    for (const classification of [{ reason: 'invalid-request' }, { reason: 'provider-5xx' }] as const) {
      const terminal = terminalGatewayError(
        { ...classification, retryable: false, healthScope: 'route' as const }, target, 'all planned routes failed', error,
      );
      expect(terminal.kind).toBe('request-too-large');
      expect(terminal.requestSize).toEqual(size);
    }
  });

  it('keeps existing classes when no size evidence is present', () => {
    expect(terminalGatewayError(
      { reason: 'invalid-request', retryable: false, healthScope: 'route' }, target, 'fallback',
    ).kind).toBe('bad-request');
    expect(terminalGatewayError(
      { reason: 'provider-5xx', retryable: false, healthScope: 'route' }, target, 'fallback',
      { status: 500 },
    ).kind).toBe('pooled-account-unavailable');
  });

  it('never masks cancellation with a size refusal', () => {
    const terminal = terminalGatewayError(
      { reason: 'cancelled', retryable: false, healthScope: 'route' }, target, 'fallback',
      new RequestTooLargeError(size),
    );
    expect(terminal.kind).not.toBe('request-too-large');
  });
});

describe('route flow core', () => {
  it('derives routing ownership only from verified caller state', async () => {
    let captured: { subject: VerifiedRoutingSubject; input: RoutePlanInput } | undefined;
    const routePlanner = {
      async plan(subject: VerifiedRoutingSubject, input: RoutePlanInput) {
        captured = { subject, input };
        return {
          planRef: 'plan-1', expiresAt: '2026-08-08T12:01:00Z', candidateRefs: [],
          policy: {
            strategy: { kind: 'last-enrolled' }, rules: [], fallbackMode: 'retest-preferred',
            negativeCacheTtlMs: 300_000, maxAttempts: 3, preferSameTransport: true,
            stickyAccount: true, rotateEquivalentAccounts: false, allowEquivalentModels: true,
          },
          councilRevision: 'fixture', diagnostics: [],
        };
      },
    } as unknown as RoutePlanner;
    const config = {
      ...stubGatewayConfig,
      callerAuth: { async verify() {
        return {
          ok: true as const,
          cost: {
            tenantId: 'tenant-1', workspaceId: 'workspace-1', principalId: 'user-1',
            ownerScopeRef: 'cli:stable-owner', source: 'test', correlationId: 'session-1',
          },
        };
      } },
    };

    await prepareRouteFlow({
      config, routePlanner, metering: { settleRoute() {} },
    }, {
      wire: 'openai-chat-completions', headers: {}, authContext: { method: "POST", url: "https://gateway.test/v1/chat/completions", requestId: "req-test" }, model: 'gpt-5.6-terra', stream: false,
      body: {
        model: 'gpt-5.6-terra', ownerScopeRef: 'attacker',
        messages: [{ role: 'user', content: 'hello' }],
      },
    });

    expect(captured).toMatchObject({
      subject: { principalRef: 'user-1', ownerScopeRef: 'cli:stable-owner' },
      input: {
        requestedModel: 'gpt-5.6-terra', workspaceId: 'workspace-1', affinityKey: 'session-1',
      },
    });
    expect(JSON.stringify(captured)).not.toContain('attacker');
  });

  it('falls back to tenant and principal ownership for existing callers', async () => {
    let subject: VerifiedRoutingSubject | undefined;
    const routePlanner = {
      async plan(value: VerifiedRoutingSubject) {
        subject = value;
        return {
          planRef: 'plan-legacy', expiresAt: '2026-08-08T12:01:00Z', candidateRefs: [],
          policy: {
            strategy: { kind: 'last-enrolled' }, rules: [], fallbackMode: 'retest-preferred',
            negativeCacheTtlMs: 300_000, maxAttempts: 3, preferSameTransport: true,
            stickyAccount: true, rotateEquivalentAccounts: false, allowEquivalentModels: true,
          },
          councilRevision: 'fixture', diagnostics: [],
        };
      },
    } as unknown as RoutePlanner;

    await prepareRouteFlow({
      config: {
        ...stubGatewayConfig,
        callerAuth: { async verify() {
          return {
            ok: true as const,
            cost: {
              tenantId: 'tenant-legacy', principalId: 'principal-legacy',
              source: 'test', correlationId: 'session-legacy',
            },
          };
        } },
      },
      routePlanner,
      metering: { settleRoute() {} },
    }, {
      wire: 'openai-chat-completions', headers: {}, authContext: { method: "POST", url: "https://gateway.test/v1/chat/completions", requestId: "req-test" }, model: 'gpt-5.6-terra', stream: false,
      body: { model: 'gpt-5.6-terra', messages: [{ role: 'user', content: 'hello' }] },
    });

    expect(subject).toEqual({
      principalRef: 'principal-legacy',
      ownerScopeRef: 'tenant-legacy:principal-legacy',
    });
  });

  it('classifies retryable availability without making auth retryable', () => {
    expect(classifyRouteError({ status: 429, retryAfterMs: 42_000 })).toEqual({
      reason: 'rate-limited', retryable: true, retryAfterMs: 42_000,
      healthScope: 'provider-model',
    });
    expect(classifyRouteError({ statusCode: 502 })).toEqual({
      reason: 'provider-5xx', retryable: true, healthScope: 'provider-model',
    });
    expect(classifyRouteError({ status: 401 })).toEqual({
      reason: 'auth-failed', retryable: false, healthScope: 'account',
    });
    expect(classifyRouteError(new Error('cancelled'), true)).toEqual({
      reason: 'cancelled', retryable: false, healthScope: 'route',
    });
  });

  it('treats status-less model_not_found / not_found codes as unsupported-model', () => {
    for (const code of ['model_not_found', 'not_found_error', 'not_found', 'unsupported_model']) {
      expect(classifyRouteError({ code })).toEqual({
        reason: 'unsupported-model', retryable: false, healthScope: 'provider-model',
      });
    }
    expect(classifyRouteError({ status: 404 })).toEqual({
      reason: 'unsupported-model', retryable: false, healthScope: 'provider-model',
    });
  });

  it('converts a terminal unsupported-model into unknown-model with the served target', () => {
    const target = { providerId: 'openai', transportProviderId: 'codex', model: 'gpt-5.6-terra' };
    const error = terminalGatewayError(
      { reason: 'unsupported-model', retryable: false, healthScope: 'provider-model' },
      target, 'all planned routes failed',
    );
    expect(error.kind).toBe('unknown-model');
    expect(error.retryAfterSeconds).toBeUndefined();
    expect(error.servedTarget).toBe(target);
    // The wire message names the REQUESTED model, never the served detail.
    const mapped = toProviderShapedError('anthropic-messages', error, 'requested-x');
    expect(mapped.status).toBe(404);
    expect((mapped.body as { error: { message: string } }).error.message).toBe(
      'Unknown model: "requested-x"',
    );
    expect(JSON.stringify(mapped.body)).not.toContain('gpt-5.6-terra');
  });

  it('classifies a pre-content provider invalid failure by code alone', () => {
    // Live-proven: a Codex `response.failed` event carrying
    // `invalid_request_error` arrives with no HTTP status — it must still
    // surface as invalid-request, never as provider-5xx.
    expect(classifyRouteError({ code: 'invalid_request_error' })).toEqual({
      reason: 'invalid-request', retryable: false, healthScope: 'route',
    });
    // An auth-shaped code without a 401 status stays out of invalid-request.
    expect(classifyRouteError({ code: 'invalid_api_key' })).toEqual({
      reason: 'provider-5xx', retryable: false, healthScope: 'route',
    });
  });

  it('forwards Responses execution features from validated input into plan input', async () => {
    // Spec §16.3: the codec derives features (here an explicit output
    // ceiling); the canonical entry point forwards them — no gateway table.
    let captured: RoutePlanInput | undefined;
    const routePlanner = {
      async plan(_subject: VerifiedRoutingSubject, input: RoutePlanInput) {
        captured = input;
        return {
          planRef: 'plan-features', expiresAt: '2026-08-08T12:01:00Z', candidateRefs: [],
          policy: {
            strategy: { kind: 'last-enrolled' }, rules: [], fallbackMode: 'retest-preferred',
            negativeCacheTtlMs: 300_000, maxAttempts: 3, preferSameTransport: true,
            stickyAccount: true, rotateEquivalentAccounts: false, allowEquivalentModels: true,
          },
          councilRevision: 'fixture', diagnostics: [],
        };
      },
    } as unknown as RoutePlanner;
    const config = {
      ...stubGatewayConfig,
      callerAuth: { async verify() {
        return {
          ok: true as const,
          cost: {
            tenantId: 'tenant-1', workspaceId: 'workspace-1', principalId: 'user-1',
            ownerScopeRef: 'cli:stable-owner', source: 'test', correlationId: 'session-1',
          },
        };
      } },
    };

    await prepareRouteFlow({
      config, routePlanner, metering: { settleRoute() {} },
    }, {
      wire: 'openai-responses', headers: {},
      authContext: { method: 'POST', url: 'https://gateway.test/v1/responses', requestId: 'req-resp' },
      model: 'gpt-6.1-sol', stream: false,
      body: { model: 'gpt-6.1-sol', input: 'hello', max_output_tokens: 50 },
    });

    expect(captured?.requestedModel).toBe('gpt-6.1-sol');
    expect(captured?.requiredExecutionFeatures).toEqual(['explicit-output-ceiling']);
  });
});
