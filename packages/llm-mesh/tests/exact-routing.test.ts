import { expect, it } from 'vitest';
import { InMemoryRoutePlanner } from '../src/route-planner.js';
import { DEFAULT_ROUTE_POLICY } from '../src/routing-policy.js';
import { createCanonicalTargetCandidatesResolver } from '../src/routing-targets.js';
import { freezeLaunchRoutingContract, mappingContentSha256 } from '../src/launch-routing-contract.js';
const subject = { principalRef: 'p', ownerScopeRef: 'owner-a' };
const target = { providerId: 'gemini', transportProviderId: 'cloud-code', model: 'gemini-4-argon', effort: 'high' };
const requestedModel = 'claude-opus-5-5';
const rig = () => {
  let acquired = 0;
  const planner = new InMemoryRoutePlanner({ directory: {
    listEligible: async () => [{ accountRef: 'argon', diagnosticAccountRef: 'opaque', targetProviderId: 'gemini', transportProviderId: 'cloud-code', supportedModelIds: [target.model], enrollmentCompletedAt: '2026-10-01T00:00:00Z', revision: '1', readiness: 'ready' }],
    prepareAttempt: async () => { acquired += 1; throw new Error('not dispatched in planning tests'); },
  } });
  return { planner, acquired: () => acquired };
};
it('defaults aliases, quote and planning to exact identity without acquiring Argon', async () => {
  expect(DEFAULT_ROUTE_POLICY.allowEquivalentModels).toBe(false);
  expect(createCanonicalTargetCandidatesResolver()(requestedModel).every((t) => t.providerId === 'anthropic')).toBe(true);
  expect(createCanonicalTargetCandidatesResolver({ allowEquivalentModels: true })(requestedModel).some((t) => t.model === target.model)).toBe(true);
  const f = rig(); await expect(f.planner.plan(subject, { requestedModel })).rejects.toMatchObject({ code: 'no-route' });
  expect(f.acquired()).toBe(0);
});
it('permits only a selected mapping revision and authorized account set', async () => {
  const f = rig(); const targets = { [requestedModel]: [target] };
  const contract = freezeLaunchRoutingContract({ version: 1, revision: 'p1', ownerScopeRef: subject.ownerScopeRef, exactModels: [requestedModel], authorizedAccountRefs: ['argon'], rotateAccounts: false,
    effortPolicy: { mode: 'preserve' }, mapping: { id: 'g', revision: '2026-10-15', contentSha256: mappingContentSha256(targets), targets } });
  const plan = await f.planner.plan(subject, { requestedModel, launchRoutingContract: contract });
  expect(plan.diagnostics[0].actualModelId).toBe(target.model); expect(plan.policy.allowEquivalentModels).toBe(false);
  await expect(f.planner.plan(subject, { requestedModel, launchRoutingContract: contract, policyOverride: { allowEquivalentModels: true } })).rejects.toMatchObject({ code: 'routing-contract-invalid' });
});
