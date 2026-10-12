// K1 staged coherent units and groups (L3a v4 §7). Protocol types plus
// data-pure fragment/state validators. Hidden-state and publication
// machinery arrive in K4; no backend here.

import {
  encodeCompoundKey,
  errResult,
  isDecimalCounter,
  isNonEmptyString,
  okResult,
  validateStorageScope,
  validateWorkLimits,
  validateWriterFence,
  type StorageModuleId,
  type StorageScope,
  type ValidationResult,
  type WorkLimits,
  type WriterFence,
} from './contracts.js';
import { validateAtomicUnit } from './atomic.js';
import type { AtomicUnit } from './atomic.js';

export const STAGED_STATES = ['staging', 'sealing', 'sealed', 'committed', 'aborted'] as const;
export type StagedState = (typeof STAGED_STATES)[number];

export const STAGED_EVENTS = ['begin-seal', 'seal', 'commit', 'abort'] as const;
export type StagedEvent = (typeof STAGED_EVENTS)[number];

const STAGED_TRANSITIONS: Readonly<Record<StagedState, Partial<Record<StagedEvent, StagedState>>>> = {
  staging: { 'begin-seal': 'sealing', abort: 'aborted' },
  sealing: { seal: 'sealed', abort: 'aborted' },
  sealed: { commit: 'committed', abort: 'aborted' },
  committed: {},
  aborted: {},
};

export const nextStagedState = (current: StagedState, event: StagedEvent): StagedState | null =>
  STAGED_TRANSITIONS[current][event] ?? null;

export interface StagedUnitHandle {
  readonly unitId: string;
  readonly operationKey: string;
  readonly moduleId: StorageModuleId;
  readonly scope: StorageScope;
  readonly state: StagedState;
}

export interface StagedBeginInput {
  readonly operationKey: string;
  readonly inputDigest: string;
  readonly contractDigest: string;
  readonly sourceBoundary: string;
  readonly fence: WriterFence;
}

export const validateBeginInput = (input: StagedBeginInput): ValidationResult => {
  const errors: string[] = [];
  if (!isNonEmptyString(input.operationKey)) errors.push('begin requires an operationKey');
  if (!isNonEmptyString(input.inputDigest)) errors.push('begin requires an inputDigest');
  if (!isNonEmptyString(input.contractDigest)) errors.push('begin requires a contractDigest');
  if (!isNonEmptyString(input.sourceBoundary)) errors.push('begin requires a sourceBoundary');
  const fence = validateWriterFence(input.fence);
  if (!fence.ok) errors.push(fence.errors.join('; '));
  return errors.length === 0 ? okResult() : errResult(...errors);
};

export interface FragmentBinding {
  readonly moduleId: StorageModuleId;
  readonly scope: StorageScope;
  readonly operationId: string;
  readonly contractVersion: string;
  readonly sourceBoundary: string;
  readonly ordinal: string;
  readonly predecessorHash: string | null;
  readonly effectDigest: string;
}

// Canonical fragment binding (§7.3): module + scope + operation/unit/group
// identity, contract version + source boundary, ordinal + predecessor +
// canonical effect digest. Domain-separated and explicitly versioned.
export const canonicalFragmentEncoding = (binding: FragmentBinding): string =>
  encodeCompoundKey([
    'staged-fragment',
    'v1',
    binding.moduleId,
    binding.scope.tenantId,
    binding.scope.workspaceId,
    binding.operationId,
    binding.contractVersion,
    binding.sourceBoundary,
    binding.ordinal,
    binding.predecessorHash ?? '',
    binding.effectDigest,
  ]);

export interface StagedFragmentInput {
  readonly unitId: string;
  readonly ordinal: string;
  readonly predecessorHash: string | null;
  readonly fragmentDigest: string;
  readonly effects: AtomicUnit;
  readonly fence: WriterFence;
}

export const validateFragmentInput = (input: StagedFragmentInput, limits?: WorkLimits): ValidationResult => {
  const errors: string[] = [];
  if (!isNonEmptyString(input.unitId)) errors.push('fragment requires a unitId');
  if (!isDecimalCounter(input.ordinal)) errors.push('fragment requires a decimal ordinal');
  if (input.ordinal !== '0' && !isNonEmptyString(input.predecessorHash)) {
    errors.push('non-first fragments require a predecessorHash');
  }
  if (input.ordinal === '0' && input.predecessorHash !== null) {
    errors.push('the first fragment binds a null predecessor');
  }
  if (!isNonEmptyString(input.fragmentDigest)) errors.push('fragment requires a fragmentDigest');
  const unit = validateAtomicUnit(input.effects, limits);
  if (!unit.ok) errors.push(unit.errors.join('; '));
  const fence = validateWriterFence(input.fence);
  if (!fence.ok) errors.push(fence.errors.join('; '));
  return errors.length === 0 ? okResult() : errResult(...errors);
};

export interface AcceptedFragment {
  readonly ordinal: string;
  readonly fragmentDigest: string;
}

// Next-ordinal acceptance (§7.3): the next ordinal is accepted, identical
// retries return the same receipt, gaps and reordering cannot advance.
export const validateFragmentSequence = (
  accepted: readonly AcceptedFragment[],
  next: { readonly ordinal: string; readonly predecessorHash: string | null; readonly fragmentDigest: string },
): ValidationResult => {
  if (!isDecimalCounter(next.ordinal)) return errResult('fragment ordinal must be decimal');
  if (accepted.length === 0) {
    if (next.ordinal !== '0') return errResult('the first ordinal is zero');
    if (next.predecessorHash !== null) return errResult('the first predecessor is null');
    return okResult();
  }
  const last = accepted[accepted.length - 1];
  const expectedOrdinal = String(Number(last.ordinal) + 1);
  if (next.ordinal === last.ordinal) {
    if (next.fragmentDigest === last.fragmentDigest) return okResult();
    return errResult('changed bytes at an accepted ordinal conflict');
  }
  if (next.ordinal !== expectedOrdinal) return errResult('gaps and reordering cannot advance the frontier');
  if (next.predecessorHash !== last.fragmentDigest) return errResult('predecessor must bind the accepted frontier');
  return okResult();
};

export interface StagedCommitRoot {
  readonly operationId: string;
  readonly contractDigest: string;
  readonly sourceBoundary: string;
  readonly finalFragmentHash: string;
  readonly fragmentCount: string;
  readonly dependencyRoot: string;
  readonly effectRoot: string;
}

export const validateCommitRoot = (root: StagedCommitRoot): ValidationResult => {
  const errors: string[] = [];
  if (!isNonEmptyString(root.operationId)) errors.push('root requires an operationId');
  if (!isNonEmptyString(root.contractDigest)) errors.push('root requires a contractDigest');
  if (!isNonEmptyString(root.sourceBoundary)) errors.push('root requires a sourceBoundary');
  if (!isNonEmptyString(root.finalFragmentHash)) errors.push('root requires a finalFragmentHash');
  if (!isDecimalCounter(root.fragmentCount) || root.fragmentCount === '0') {
    errors.push('root requires a positive fragmentCount');
  }
  if (!isNonEmptyString(root.dependencyRoot)) errors.push('root requires a dependencyRoot');
  if (!isNonEmptyString(root.effectRoot)) errors.push('root requires an effectRoot');
  return errors.length === 0 ? okResult() : errResult(...errors);
};

export interface StagedUnitSeal {
  readonly unitId: string;
  readonly commitRoot: StagedCommitRoot;
}

export interface FragmentReceipt {
  readonly unitId: string;
  readonly ordinal: string;
  readonly fragmentDigest: string;
}

export type StagedUnitStatus =
  | { readonly state: 'staging'; readonly acceptedFragments: string }
  | { readonly state: 'sealing'; readonly acceptedFragments: string }
  | { readonly state: 'sealed'; readonly seal: StagedUnitSeal }
  | { readonly state: 'committed'; readonly commitId: string }
  | { readonly state: 'aborted'; readonly reason: string };

export interface StagedSealInput {
  readonly unitId: string;
  readonly root: StagedCommitRoot;
  readonly limits: WorkLimits;
  readonly fence: WriterFence;
}

export const validateSealInput = (input: StagedSealInput): ValidationResult => {
  const errors: string[] = [];
  if (!isNonEmptyString(input.unitId)) errors.push('seal requires a unitId');
  const root = validateCommitRoot(input.root);
  if (!root.ok) errors.push(root.errors.join('; '));
  const limits = validateWorkLimits(input.limits);
  if (!limits.ok) errors.push(limits.errors.join('; '));
  const fence = validateWriterFence(input.fence);
  if (!fence.ok) errors.push(fence.errors.join('; '));
  return errors.length === 0 ? okResult() : errResult(...errors);
};

export { validateStorageScope };
