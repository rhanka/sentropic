import { describe, expect, it, vi } from 'vitest';
import { createJevAdapter } from '../src/decision/adapter.js';
import { createDecisionService, preflightDecisionRequest } from '../src/decision/service.js';
import type { DecisionSelectionOptions } from '../src/decision/service.js';
import type { EvaluatorRef } from '../src/decision/request.js';
import { decisionRequest, decisionServiceFixture, qualifiedDescriptor } from './decision-fixtures.js';

const setup = (evaluatorAllowlist?: readonly EvaluatorRef[]) => {
  const descriptor = qualifiedDescriptor();
  const send = vi.fn();
  const adapter = createJevAdapter({ descriptor, transport: { send } });
  const getProvider = vi.fn((id: string) => adapter.provider.providerId === id ? adapter : null);
  const resolveEvaluator = vi.fn(() => descriptor);
  const options = { registry: { getProvider } as never, resolveEvaluator, evaluatorAllowlist,
  } as unknown as DecisionSelectionOptions;
  return { options, getProvider, resolveEvaluator, descriptor, send };
};

describe('explicit evaluator allowlist (P28)', () => {
  it('admits an exactly listed evaluator through provider lookup', async () => {
    const descriptor = qualifiedDescriptor();
    const { options, getProvider, resolveEvaluator } = setup([descriptor.evaluator]);
    const result = await preflightDecisionRequest(decisionRequest(), options);
    expect(result).toEqual(expect.objectContaining({ ok: true }));
    expect(getProvider).toHaveBeenCalledTimes(1);
    expect(resolveEvaluator).toHaveBeenCalledTimes(1);
  });
  it('refuses a catalogue-present but unlisted revision before provider lookup', async () => {
    const descriptor = qualifiedDescriptor();
    const { options, getProvider, resolveEvaluator } =
      setup([{ ...descriptor.evaluator, revision: 'other-revision' }]);
    const result = await preflightDecisionRequest(decisionRequest(), options);
    expect(result).toEqual({ ok: false, code: 'EVALUATOR_UNKNOWN' });
    expect(getProvider).not.toHaveBeenCalled();
    expect(resolveEvaluator).not.toHaveBeenCalled();
  });
  it('refuses everything under an empty allowlist', async () => {
    const { options, getProvider } = setup([]);
    expect(await preflightDecisionRequest(decisionRequest(), options))
      .toEqual({ ok: false, code: 'EVALUATOR_UNKNOWN' });
    expect(getProvider).not.toHaveBeenCalled();
  });
  it('never matches a malformed allowlist entry in direct preflight', async () => {
    const { options } = setup([{ providerId: 'typesafe' } as unknown as EvaluatorRef]);
    expect(await preflightDecisionRequest(decisionRequest(), options))
      .toEqual({ ok: false, code: 'EVALUATOR_UNKNOWN' });
  });
  it('rejects a malformed allowlist at service construction', async () => {
    const fixture = decisionServiceFixture();
    expect(() => createDecisionService({ ...fixture.options,
      evaluatorAllowlist: [{ providerId: 'typesafe' }] as never })).toThrow('Invalid decision host configuration.');
  });
  it('refuses a full service call before admission or dispatch', async () => {
    const fixture = decisionServiceFixture();
    const service = createDecisionService({ ...fixture.options,
      evaluatorAllowlist: [{ ...qualifiedDescriptor().evaluator, revision: 'other-revision' }] });
    const result = await service.decide(decisionRequest());
    expect(result).toMatchObject({ ok: false, error: { code: 'EVALUATOR_UNKNOWN' } });
    expect(fixture.transport.send).not.toHaveBeenCalled();
    expect(fixture.budget.admit).not.toHaveBeenCalled();
  });
});
