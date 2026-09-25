import { expect, it } from 'vitest';
import type {
  CallerAuthPort, CallerAuthResult, CostContext, GatewayFlowRequest, VerifyToken,
} from '../src/index.js';

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

// Regression (PR #605): an un-annotated verifier infers `ok: boolean`, which the strict union rejects.
const legacyVerifier = (cost: CostContext | undefined) => ({
  async verify(_headers: Readonly<Record<string, string>>) {
    return cost ? { ok: true, cost } : { ok: false, reason: 'verified caller unavailable' };
  },
});
// @ts-expect-error boolean-inferred ok is not a CallerAuthResult discriminant
const legacyPort: CallerAuthPort = legacyVerifier(undefined);
const strictVerifier = (cost: CostContext | undefined) => ({
  async verify(_headers: Readonly<Record<string, string>>): Promise<CallerAuthResult> {
    return cost ? { ok: true, cost } : { ok: false, reason: 'verified caller unavailable' };
  },
});
const strictPort: CallerAuthPort = strictVerifier(undefined);

it('retains header-only custom implementations', () => {
  const auth: CallerAuthPort = { async verify(_headers) { return { ok: false }; } };
  expect(auth.verify).toBeTypeOf('function');
  expect(contracts).toBeTypeOf('function');
  expect([legacyPort, strictPort]).toHaveLength(2);
});
