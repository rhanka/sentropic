import { canonicalJson, sha256Hex } from '@sentropic/comments';
import type { CanonicalBatchImportResponse } from '@sentropic/comments';
import type { AuthenticatedStagedHandle } from '../storage/staged-state.js';
import type { StagedBeginInput, StagedCommitRoot } from '../storage/staged-units.js';
import type { AtomicUnit } from '../storage/atomic.js';
import { deriveStagedDependencies, stagedEffectDigest } from '../storage/staged-codec.js';
import {
  startPortableDigest,
  updatePortableDigest,
  finishPortableDigest,
  type PortableDigestState,
} from '../storage/postgres/digest.js';
import { COMMENTS_CONTRACT_DIGEST } from './contract.js';
import { COMMENTS_TRANSPORT_LIMITS, type CommentsImportBinding, type CommentsUnitRoot } from './transport-contracts.js';
export const COMMENTS_IMPORT_CONTRACT_DIGEST = sha256Hex(
  canonicalJson(['comments-import-contract', 'v1', COMMENTS_CONTRACT_DIGEST, COMMENTS_TRANSPORT_LIMITS]),
);
export interface CommentsImportState {
  readonly version: 'comments-preparation-v1';
  readonly binding: CommentsImportBinding;
  readonly bindingDigest: string;
  readonly begin: StagedBeginInput;
  unit: AuthenticatedStagedHandle | null;
  readonly issuedAt: number;
  readonly rootReference: string;
  nextOrdinal: string;
  frontier: string | null;
  kernelFrontier: string | null;
  dependency: PortableDigestState;
  effect: PortableDigestState;
  readonly units: { readonly unitId: string; records: string; digest: PortableDigestState }[];
  root: StagedCommitRoot | null;
  canonical: CanonicalBatchImportResponse | null;
  roots: readonly CommentsUnitRoot[];
  terminalHashes: readonly string[];
}
export const startCommentsImportDigests = (binding: CommentsImportBinding) => ({
  dependency: updatePortableDigest(startPortableDigest(), Buffer.from('["staged-dependency-root","v1",[')),
  effect: updatePortableDigest(startPortableDigest(), Buffer.from('["staged-effect-root","v1",[')),
  units: binding.unitIds.map((unitId) => ({
    unitId,
    records: '0',
    digest: updatePortableDigest(
      startPortableDigest(),
      Buffer.from(`${canonicalJson(['comments-unit-payload', 'v1', unitId]).slice(0, -1)},[`),
    ),
  })),
});
export const appendCommentsKernelCommitment = (
  state: CommentsImportState,
  effects: AtomicUnit,
  digest: string,
  transportDigest: string,
): void => {
  const comma = state.nextOrdinal === '0' ? '' : ',';
  state.dependency = updatePortableDigest(
    state.dependency,
    Buffer.from(comma + JSON.stringify([state.nextOrdinal, deriveStagedDependencies(effects)])),
  );
  state.effect = updatePortableDigest(
    state.effect,
    Buffer.from(comma + JSON.stringify([state.nextOrdinal, stagedEffectDigest(effects)])),
  );
  state.frontier = transportDigest;
  state.kernelFrontier = digest;
  state.nextOrdinal = (BigInt(state.nextOrdinal) + 1n).toString();
};
export const commentsKernelCommitRoot = (state: CommentsImportState): StagedCommitRoot => ({
  operationId: state.begin.operationKey,
  contractDigest: state.begin.contractDigest,
  sourceBoundary: state.begin.sourceBoundary,
  finalFragmentHash: state.kernelFrontier!,
  fragmentCount: state.nextOrdinal,
  dependencyRoot: finishPortableDigest(updatePortableDigest(state.dependency, Buffer.from(']]'))),
  effectRoot: finishPortableDigest(updatePortableDigest(state.effect, Buffer.from(']]'))),
});
