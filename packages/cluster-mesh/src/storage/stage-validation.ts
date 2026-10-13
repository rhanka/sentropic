// K4 bounded seal validation (L3a v4.1 frozen §7.5): guards and dependency
// closure are checked against the captured base root in bounded steps, so a
// large unit seals progressively and resumes persisted validation state.
// Data-only: fragment intake and publication live in staged-runtime.ts.
// No pg, no drizzle, no engram imports.

import { StorageInvalidCommandError } from './errors.js';
import { validateCommitRoot, type StagedCommitRoot, type StagedUnitSeal } from './staged-units.js';

export interface SealValidationProgress {
  readonly checked: string;
  readonly total: string;
}

export type SealValidationOutcome =
  | { readonly state: 'validating'; readonly progress: SealValidationProgress }
  | { readonly state: 'sealed'; readonly seal: StagedUnitSeal };

export interface SealValidationFragment {
  readonly ordinal: string;
  readonly predecessorHash: string | null;
  readonly fragmentDigest: string;
}

/** Maximum validation items checked per step (root checks plus fragments). */
export const STAGE_VALIDATION_STEP_BUDGET = 8;

/**
 * Incremental seal validator over a frozen fragment list and commit root.
 * Steps are resumable: keep the instance across sealStep calls to resume
 * persisted validation state. Throws StorageInvalidCommandError at the step
 * that discovers a closure violation.
 */
export class StagedSealValidation {
  private stepIndex = 0;
  private readonly total: number;

  constructor(
    private readonly unitId: string,
    private readonly fragments: readonly SealValidationFragment[],
    private readonly root: StagedCommitRoot,
  ) {
    this.total = 2 + fragments.length;
  }

  get checked(): number {
    return this.stepIndex;
  }

  get totalItems(): number {
    return this.total;
  }

  step(): SealValidationOutcome {
    const budget = Math.min(STAGE_VALIDATION_STEP_BUDGET, this.total - this.stepIndex);
    for (let n = 0; n < budget; n += 1) {
      this.checkItem(this.stepIndex);
      this.stepIndex += 1;
      if (this.stepIndex >= this.total) {
        return { state: 'sealed', seal: { unitId: this.unitId, commitRoot: this.root } };
      }
    }
    return {
      state: 'validating',
      progress: { checked: String(this.stepIndex), total: String(this.total) },
    };
  }

  private checkItem(index: number): void {
    if (index === 0) {
      const shape = validateCommitRoot(this.root);
      if (!shape.ok) throw new StorageInvalidCommandError(shape.errors.join('; '));
      return;
    }
    if (index === 1) {
      if (this.root.fragmentCount !== String(this.fragments.length)) {
        throw new StorageInvalidCommandError('wrong counts cannot seal');
      }
      const last = this.fragments[this.fragments.length - 1];
      if (!last || this.root.finalFragmentHash !== last.fragmentDigest) {
        throw new StorageInvalidCommandError('truncated chains cannot seal');
      }
      return;
    }
    const position = index - 2;
    const fragment = this.fragments[position];
    if (!fragment || fragment.ordinal !== String(position)) {
      throw new StorageInvalidCommandError('gaps and reordering cannot seal');
    }
    if (position === 0) {
      if (fragment.predecessorHash !== null) {
        throw new StorageInvalidCommandError('the first predecessor is null');
      }
      return;
    }
    const predecessor = this.fragments[position - 1];
    if (fragment.predecessorHash !== predecessor.fragmentDigest) {
      throw new StorageInvalidCommandError('predecessor must bind the sealed frontier');
    }
  }
}
