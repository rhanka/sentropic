import { createJevAdapter } from '../src/decision/adapter.js';
import { createProviderRegistry } from '../src/registry.js';
import { assessmentFixture } from './decision-assessment-fixtures.js';
import { decisionServiceFixture } from './decision-fixtures.js';

/** Synthetic recorded calibration for the exact production scope; no provider qualification. */
export function productionFixture() {
  const f = decisionServiceFixture();
  const a = assessmentFixture();
  delete a.descriptor.executionProfile;
  delete f.options.executionProfile;
  f.options.registry = createProviderRegistry([createJevAdapter({ descriptor: a.descriptor, transport: f.transport })]);
  f.options.resolveEvaluator = () => a.descriptor;
  f.options.readiness = { contractConformance: true, transportAccessible: true, policy: a.policy, assessments: [a.assessment] };
  return { ...f, ...a };
}
