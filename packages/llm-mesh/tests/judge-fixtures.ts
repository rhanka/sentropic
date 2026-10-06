import type { JudgeRequest } from '../src/judge/request.js';
import { jevDescriptor } from '../src/judge/jev-descriptor.js';

/** Synthetic qualification only: these IDs/evidence do not activate the built-in descriptor. */
export const qualifiedDescriptor = () => structuredClone({ ...jevDescriptor,
  evaluator: { ...jevDescriptor.evaluator, revision: 'synthetic-v1' },
  acceptedServedModelIds: ['synthetic-served-model'],
  qualification: { servedIdentity: 'qualified' as const, billingBound: 'qualified' as const,
    evidenceRefs: ['fixture:synthetic-qualification'] },
});
export const judgeRequest = (overrides: Partial<JudgeRequest> = {}): JudgeRequest => ({
  schemaVersion: 1, evaluator: qualifiedDescriptor().evaluator,
  inputs: { output: 'synthetic candidate' }, criterion: { kind: 'binary', instructions: 'Check evidence.' },
  ...overrides,
});
export const jevResponse = (answer: unknown = { noul: 0.25 }) => ({
  model: 'synthetic-served-model', answers: { verdict: answer }, usage: { input_tokens: 1000, output_tokens: 0 },
});
