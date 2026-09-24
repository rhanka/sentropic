import { expect, it } from 'vitest';
import type { CallerAuthPort, CallerAuthResult, GatewayFlowRequest, VerifyToken } from '../src/index.js';

// Compiled by tsconfig.test.json; intentionally never executed.
const contracts = (auth: CallerAuthPort, verifier: VerifyToken) => {
  // @ts-expect-error request context is required
  void auth.verify({});
  // @ts-expect-error request context is required
  void verifier.verify('t', 'Bearer', {});
  // @ts-expect-error success must carry cost
  const success: CallerAuthResult = { ok: true };
  // @ts-expect-error failure cannot carry cost
  const failure: CallerAuthResult = { ok: false, cost: {} };
  const cost = { tenantId: 't', principalId: 'p', source: 's', correlationId: 'c' };
  // @ts-expect-error success cannot carry reason even with valid cost
  const reason: CallerAuthResult = { ok: true, cost, reason: 'failure' };
  // @ts-expect-error direct flow requests require context
  const request: GatewayFlowRequest = { wire: 'anthropic-messages', headers: {}, body: {}, model: 'm', stream: false };
  return [success, failure, reason, request];
};
it('retains header-only custom implementations', () => {
  const auth: CallerAuthPort = { async verify(_headers) { return { ok: false }; } };
  expect(auth.verify).toBeTypeOf('function');
  expect(contracts).toBeTypeOf('function');
});
