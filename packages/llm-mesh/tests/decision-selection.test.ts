import { describe, expect, it, vi } from 'vitest';
import { createProviderRegistry } from '../src/registry.js';
import { createJevAdapter } from '../src/decision/adapter.js';
import { preflightDecisionRequest } from '../src/decision/service.js';
import { decisionRequest, qualifiedDescriptor } from './decision-fixtures.js';
import { jevDescriptor } from '../src/decision/descriptor.js';

const setup = (descriptor = qualifiedDescriptor()) => {
  const send = vi.fn();
  const adapter = createJevAdapter({ descriptor, transport: { send } });
  return { send, options: { registry: createProviderRegistry([adapter]), resolveEvaluator: vi.fn(() => descriptor) } };
};
describe('exact decision preflight selection', () => {
  it.each([['unknown-provider', 'jev-1.13.0', 'synthetic-v1', 'PROVIDER_UNKNOWN'],
    ['typesafe', 'other', 'synthetic-v1', 'EVALUATOR_UNKNOWN'],
    ['typesafe', 'jev-1.13.0', 'other', 'REVISION_MISMATCH']])('refuses %s/%s/%s without egress', async (providerId, evaluatorId, revision, code) => {
    const { send, options } = setup();
    const result = await preflightDecisionRequest(decisionRequest({ evaluator: { providerId, evaluatorId, revision } as never }), options);
    expect(result).toEqual({ ok: false, code });
    expect(send).not.toHaveBeenCalled();
    expect(options.resolveEvaluator).not.toHaveBeenCalled();
  });
  it.each([{ policy: { explanation: 'required' } }, { decision: { kind: 'provider' } },
    { decision: { kind: 'threshold', field: 'score', op: 'gte', value: 2 } },
    { raw: { mode: 'allowlisted' } }])('refuses unsupported capabilities and native thresholds', async (override) => {
    const { send, options } = setup();
    expect((await preflightDecisionRequest(decisionRequest(override as never), options)).ok).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });
  it('validates registered decision rules against the resolved native scale', async () => {
    const descriptor = qualifiedDescriptor();
    descriptor.registeredCriteria = [{ criteriaId: 'binary', revision: 'r1', criterion: { kind: 'binary', instructions: 'Check.' } }];
    const { options } = setup(descriptor);
    expect(await preflightDecisionRequest(decisionRequest({ criterion: { kind: 'registered', criteriaId: 'binary', revision: 'r1' },
      decision: { kind: 'threshold', field: 'score', op: 'gte', value: 2 } }), options)).toEqual({ ok: false, code: 'REQUEST_INVALID' });
  });
  it('keeps the accepted request detached and frozen across configuration awaits', async () => {
    const original = decisionRequest();
    const { options } = setup();
    options.resolveEvaluator.mockImplementation(() => { original.inputs.output = 'mutated caller value'; return qualifiedDescriptor(); });
    const result = await preflightDecisionRequest(original, options);
    expect(result.ok && result.request.inputs.output).toBe('synthetic candidate');
    expect(result.ok && Object.isFrozen(result.request.inputs)).toBe(true);
    expect(Object.isFrozen(original)).toBe(false);
  });
  it('compares exact identity fields independently of JSON property order', async () => {
    const { options } = setup();
    expect((await preflightDecisionRequest(decisionRequest({ evaluator: { revision: 'synthetic-v1',
      evaluatorId: 'jev-1.13.0', providerId: 'typesafe' } }), options)).ok).toBe(true);
  });
  it('refuses undeclared passing labels for a registered choice', async () => {
    const descriptor = qualifiedDescriptor();
    descriptor.registeredCriteria = [{ criteriaId: 'choose', revision: 'r1', criterion: { kind: 'choice', instructions: 'Choose.',
      options: [{ id: 'A', description: 'First' }, { id: 'B', description: 'Second' }] } }];
    const { options, send } = setup(descriptor);
    expect(await preflightDecisionRequest(decisionRequest({ criterion: { kind: 'registered', criteriaId: 'choose', revision: 'r1' },
      decision: { kind: 'labels', passing: ['C'] } }), options)).toEqual({ ok: false, code: 'REQUEST_INVALID' });
    expect(send).not.toHaveBeenCalled();
  });
  it('refuses registered rubrics whose instructions differ between service and adapter descriptors', async () => {
    const send = vi.fn();
    const serviceDescriptor = qualifiedDescriptor();
    serviceDescriptor.registeredCriteria = [{ criteriaId: 'rubric', revision: 'r1',
      criterion: { kind: 'binary', instructions: 'Decision according to rule B.' } }];
    const adapterDescriptor = qualifiedDescriptor();
    adapterDescriptor.registeredCriteria = [{ criteriaId: 'rubric', revision: 'r1',
      criterion: { kind: 'binary', instructions: 'Decision according to rule A.' } }];
    const adapter = createJevAdapter({ descriptor: adapterDescriptor, transport: { send } });
    const options = { registry: createProviderRegistry([adapter]), resolveEvaluator: vi.fn(() => serviceDescriptor) };
    const result = await preflightDecisionRequest(decisionRequest({ criterion: { kind: 'registered',
      criteriaId: 'rubric', revision: 'r1' } }), options);
    expect(result).toEqual({ ok: false, code: 'PROVIDER_UNAVAILABLE' });
    expect(send).not.toHaveBeenCalled();
  });
  it('refuses when service and adapter descriptors differ before any send', async () => {
    const send = vi.fn();
    const serviceDescriptor = qualifiedDescriptor();
    const unqualifiedDesc = { ...jevDescriptor, evaluator: { ...jevDescriptor.evaluator, revision: 'synthetic-v1' } };
    const adapter = createJevAdapter({ descriptor: unqualifiedDesc, transport: { send } });
    const options = { registry: createProviderRegistry([adapter]), resolveEvaluator: vi.fn(() => serviceDescriptor) };
    const result = await preflightDecisionRequest(decisionRequest(), options);
    expect(result).toEqual({ ok: false, code: 'PROVIDER_UNAVAILABLE' });
    expect(send).not.toHaveBeenCalled();
  });
});
