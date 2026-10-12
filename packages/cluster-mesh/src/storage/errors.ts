// K1 error compatibility (L3a v4 §15). Frozen comments vocabulary is
// preserved; transport/operational failures never masquerade as canonical codes.

export const KERNEL_CONDITIONS = [
  'cas-conflict',
  'idempotency-conflict',
  'invalid-command',
  'denied',
  'not-found',
  'incomplete',
  'inaccessible',
  'capacity-exceeded',
  'resync-required',
  'fence-conflict',
  'unavailable',
  'uncertain-commit',
  'corruption',
] as const;
export type KernelCondition = (typeof KERNEL_CONDITIONS)[number];

export const FROZEN_TREATMENTS = [
  'cas-conflict',
  'idempotency-conflict',
  'invalid-command',
  'denied',
  'not-found',
  'incomplete',
  'inaccessible',
  'capacity-exceeded',
  'transport-failure',
] as const;
export type FrozenTreatment = (typeof FROZEN_TREATMENTS)[number];

const CONDITION_MAP: Readonly<Record<KernelCondition, FrozenTreatment>> = {
  'cas-conflict': 'cas-conflict',
  'idempotency-conflict': 'idempotency-conflict',
  'invalid-command': 'invalid-command',
  denied: 'denied',
  'not-found': 'not-found',
  incomplete: 'incomplete',
  inaccessible: 'inaccessible',
  'capacity-exceeded': 'capacity-exceeded',
  'resync-required': 'transport-failure',
  'fence-conflict': 'transport-failure',
  unavailable: 'transport-failure',
  'uncertain-commit': 'transport-failure',
  corruption: 'transport-failure',
};

export const mapKernelCondition = (condition: KernelCondition): FrozenTreatment => CONDITION_MAP[condition];

export const isKernelCondition = (value: unknown): value is KernelCondition =>
  typeof value === 'string' && (KERNEL_CONDITIONS as readonly string[]).includes(value);

type StorageErrorCode =
  | 'cas-conflict'
  | 'idempotency-conflict'
  | 'invalid-command'
  | 'denied'
  | 'not-found'
  | 'capacity-exceeded'
  | 'unavailable'
  | 'unsupported-profile';

const STORAGE_ERROR_CODES: readonly string[] = [
  'cas-conflict',
  'idempotency-conflict',
  'invalid-command',
  'denied',
  'not-found',
  'capacity-exceeded',
  'unavailable',
  'unsupported-profile',
];

export const isStorageError = (error: unknown): error is Error & { readonly code: StorageErrorCode } =>
  error instanceof Error &&
  typeof (error as { code?: unknown }).code === 'string' &&
  STORAGE_ERROR_CODES.includes((error as unknown as { code: string }).code);

const withCode = <T extends Error>(error: T, code: StorageErrorCode): T & { readonly code: StorageErrorCode } =>
  Object.assign(error, { code });

export class StorageCasConflictError extends Error {
  readonly code = 'cas-conflict' as const;
  constructor(message = 'Compare-and-swap conflict') {
    super(message);
    this.name = 'StorageCasConflictError';
  }
}

export class StorageIdempotencyConflictError extends Error {
  readonly code = 'idempotency-conflict' as const;
  constructor(message = 'Idempotency conflict') {
    super(message);
    this.name = 'StorageIdempotencyConflictError';
  }
}

export class StorageInvalidCommandError extends Error {
  readonly code = 'invalid-command' as const;
  constructor(message = 'Invalid command') {
    super(message);
    this.name = 'StorageInvalidCommandError';
  }
}

export class StorageDeniedError extends Error {
  readonly code = 'denied' as const;
  constructor(message = 'Denied') {
    super(message);
    this.name = 'StorageDeniedError';
  }
}

export class StorageNotFoundError extends Error {
  readonly code = 'not-found' as const;
  constructor(message = 'Not found') {
    super(message);
    this.name = 'StorageNotFoundError';
  }
}

export class StorageCapacityExceededError extends Error {
  readonly code = 'capacity-exceeded' as const;
  constructor(message = 'Capacity exceeded') {
    super(message);
    this.name = 'StorageCapacityExceededError';
  }
}

export class StorageUnavailableError extends Error {
  readonly code = 'unavailable' as const;
  constructor(message = 'Storage unavailable') {
    super(message);
    this.name = 'StorageUnavailableError';
  }
}

export class UnsupportedProfileError extends Error {
  readonly code = 'unsupported-profile' as const;
  constructor(public readonly profile: string) {
    super(`Unsupported profile: ${profile}`);
    this.name = 'UnsupportedProfileError';
  }
}

export { withCode };
export type { StorageErrorCode };
