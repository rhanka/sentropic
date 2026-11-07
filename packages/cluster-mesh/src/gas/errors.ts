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

/** Version rule refusal (spec §5 / N3 r3 OQ13): every refusal of the contiguous 1..latest rule answers this code. */
export class VersionConflictError extends Error {
  readonly code = 'version_conflict';
  constructor(public readonly detail: string) {
    super(`version_conflict: ${detail}`);
    this.name = 'VersionConflictError';
  }
}

/** Any other store refusal (shape, envelope, integrity, pins). The store re-validates and never rebuilds. */
export type StoreRefusalCode = 'registry_invalid' | 'envelope_invalid' | 'integrity_mismatch' | 'build_pin_mismatch' | 'not_canonical';
export class StoreRefusedError extends Error {
  constructor(public readonly code: StoreRefusalCode, public readonly detail: string) {
    super(`${code}: ${detail}`);
    this.name = 'StoreRefusedError';
  }
}
