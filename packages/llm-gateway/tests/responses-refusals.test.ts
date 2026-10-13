/**
 * Refusal lease effects (spec §16.6): a pre-dispatch Responses refusal
 * takes no lease, plans nothing, prepares no attempt and settles nothing.
 * Responses adds no count endpoint: both count_tokens paths stay unmounted.
 */
import { describe, expect, it, vi } from 'vitest';
import type { PreparedRouteAttempt, RoutePlanner } from '@sentropic/llm-mesh';

import {
  createGatewayRouter,
  PersonalPassthroughCallerAuth,
  stubGatewayConfig,
  VerifiedCostContextResolver,
} from '../src/index.js';

const rig = () => {
  const verify = vi.fn(() => ({ tenantId: 't', principalId: 'p', source: 'test', ownerScopeRef: 'enrolled:p' }));
  const plan = vi.fn(async () => ({ planRef: 'p', candidateRefs: ['c'], diagnostics: [] }));
  const prepareAttempt = vi.fn(async () => ({} as unknown as PreparedRouteAttempt));
  const settleRoute = vi.fn();
  const app = createGatewayRouter({ config: { ...stubGatewayConfig,
    callerAuth: new PersonalPassthroughCallerAuth({ verifyToken: { verify }, costContextResolver: new VerifiedCostContextResolver() }),
  }, routePlanner: { plan, prepareAttempt } as unknown as RoutePlanner,
  routeMetering: { settleRoute }, requestId: () => 'refusal-request' });
  const send = (path: string, body: Record<string, unknown>) => app.request(path, { method: 'POST',
    headers: { 'x-api-key': 'trusted-token', 'content-type': 'application/json' },
    body: JSON.stringify(body) });
  return { send, plan, prepareAttempt, settleRoute };
};

const REFUSAL = { model: 'gpt-6.1-sol', stream: false, input: 'hi', store: true };

describe('responses pre-dispatch refusal (spec §16.6)', () => {
  it.each(['/responses', '/v1/responses'] as const)('refuses stateful %s with zero dispatch effects', async (path) => {
    const f = rig();
    const res = await f.send(path, REFUSAL);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: { message: 'invalid request',
      type: 'invalid_request_error', code: 'unsupported_parameter', param: 'store' } });
    expect(f.plan).not.toHaveBeenCalled();
    expect(f.prepareAttempt).not.toHaveBeenCalled();
    expect(f.settleRoute).not.toHaveBeenCalled();
  });

  it('echoes a charset-safe unknown key in param and drops a hostile one (R4-MIN-9)', async () => {
    const f = rig();
    const clean = await f.send('/responses',
      { model: 'gpt-6.1-sol', input: 'hi', future_flag: true });
    expect(clean.status).toBe(400);
    expect(await clean.json()).toEqual({ error: expect.objectContaining({
      code: 'unsupported_parameter', param: 'future_flag' }) });
    const hostile = await f.send('/responses',
      { model: 'gpt-6.1-sol', input: 'hi', 'weird key");': true });
    expect(hostile.status).toBe(400);
    const hostileBody = await hostile.json() as { error: Record<string, unknown> };
    expect(hostileBody.error.code).toBe('unsupported_parameter');
    expect(hostileBody.error).not.toHaveProperty('param');
    expect(f.plan).not.toHaveBeenCalled();
    expect(f.settleRoute).not.toHaveBeenCalled();
  });

  it.each(['/responses/count_tokens', '/v1/responses/count_tokens'] as const)('serves no count endpoint at %s', async (path) => {
    const f = rig();
    const res = await f.send(path, { model: 'gpt-6.1-sol', input: 'hi' });
    expect(res.status).toBe(404);
    expect(f.plan).not.toHaveBeenCalled();
    expect(f.settleRoute).not.toHaveBeenCalled();
  });
});
