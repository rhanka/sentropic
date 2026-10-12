/**
 * Execution-feature eligibility (spec §16.3): requirements finer than
 * `requiredCapabilities` (named/parallel tool control, strict schema,
 * structured output, reasoning controls, native reasoning replay, verbosity,
 * explicit output ceiling). Unknown support is not support — fail closed.
 */
import { describe, expect, it } from 'vitest';

import {
  EXECUTION_FEATURES,
  transportSupportsExecutionFeatures,
} from '../src/execution-features.js';

describe('execution features (spec §16.3)', () => {
  it('fixes the finer-than-capability feature taxonomy', () => {
    expect([...EXECUTION_FEATURES].sort()).toEqual([
      'custom-tools',
      'explicit-output-ceiling',
      'named-tool-choice',
      'native-reasoning-replay',
      'parallel-tool-control',
      'reasoning-context',
      'reasoning-controls',
      'strict-schema',
      'structured-output',
      'verbosity',
    ]);
  });

  it('requires nothing when the request declares no execution features', () => {
    for (const required of [undefined, []] as const) {
      expect(transportSupportsExecutionFeatures('codex', required)).toBe(true);
      expect(transportSupportsExecutionFeatures('muse', required)).toBe(true);
      expect(transportSupportsExecutionFeatures('unknown-transport', required)).toBe(true);
      expect(transportSupportsExecutionFeatures(undefined, required)).toBe(true);
    }
  });

  it('fails closed on undeclared support (populated with adapter proofs in D16-C)', () => {
    expect(transportSupportsExecutionFeatures('codex', ['named-tool-choice'])).toBe(false);
    expect(transportSupportsExecutionFeatures('codex', ['custom-tools', 'reasoning-context'])).toBe(false);
    expect(transportSupportsExecutionFeatures('muse', ['structured-output'])).toBe(false);
    expect(transportSupportsExecutionFeatures('unknown-transport', ['verbosity'])).toBe(false);
  });

  it('defers unpinned targets to the plan-time account check', () => {
    // Quoting is account-independent (a superset): an unpinned target cannot
    // be judged, so it stays. `selectRouteCandidates` enforces per account
    // before acquisition.
    expect(transportSupportsExecutionFeatures(undefined, ['named-tool-choice'])).toBe(true);
  });

  it('honors a trusted per-account declaration over the static table', () => {
    expect(transportSupportsExecutionFeatures('codex', ['named-tool-choice'], ['named-tool-choice'])).toBe(true);
    expect(transportSupportsExecutionFeatures('codex', ['named-tool-choice', 'verbosity'], ['named-tool-choice'])).toBe(false);
    expect(transportSupportsExecutionFeatures('codex', ['named-tool-choice'], [])).toBe(false);
  });
});
