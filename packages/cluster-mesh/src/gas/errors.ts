// Typed, fail-closed errors for the GAS bundle. Pure: no Node built-ins, no async.
export type GasProbeCode =
  | 'probe_digest_unavailable'
  | 'probe_digest_mismatch'
  | 'probe_props_unavailable'
  | 'probe_props_chunk'
  | 'probe_lock_unavailable';

export interface GasProbeError {
  readonly code: GasProbeCode;
  readonly detail: string;
}

export class GasProbeFailedError extends Error {
  readonly code = 'gas_probe_failed';
  constructor(public readonly errors: readonly GasProbeError[]) {
    super(`GAS runtime probe failed: ${errors.map((e) => e.code).join(',')}`);
    this.name = 'GasProbeFailedError';
  }
}

export class KeyBudgetExceededError extends Error {
  readonly code = 'props_key_budget_exceeded';
  constructor(public readonly budget: number) {
    super(`Properties key budget exceeded (${budget})`);
    this.name = 'KeyBudgetExceededError';
  }
}

export class LockTimeoutError extends Error {
  readonly code = 'lock_timeout';
  constructor() {
    super('Script lock could not be acquired');
    this.name = 'LockTimeoutError';
  }
}
