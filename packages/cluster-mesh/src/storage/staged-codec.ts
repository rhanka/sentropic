// Shared canonical staged codec (L3a v4.1 frozen §§5.1, 7.2-7.3; storage
// integrity note N1-N3). One versioned, domain-separated, framed encoding
// for effects, derived dependencies, fragment commitments and commit roots,
// so references, corpora and backends recompute identical values instead of
// trusting caller-declared digests. Positional tagged tuples keep types,
// field boundaries, null/absence and collection boundaries distinct.

import { createHash } from 'node:crypto';
import type { AtomicUnit, ChainExpectation, RegisteredGuard } from './atomic.js';
import type { StorageModuleId, StorageScope } from './contracts.js';
import type { StagedCommitRoot } from './staged-units.js';

export const STAGED_CODEC_VERSION = 'v1';
export const encodeStagedCommitRoot = (root: StagedCommitRoot): string => JSON.stringify([
  'staged-commit-root', STAGED_CODEC_VERSION, root.operationId, root.contractDigest, root.sourceBoundary,
  root.finalFragmentHash, root.fragmentCount, root.dependencyRoot, root.effectRoot,
]);

type Frame = readonly unknown[];

export type StagedDependency =
  | readonly ['guard', Frame]
  | readonly ['append-expectation', string, string, Frame];

export interface StagedFragmentBinding {
  readonly moduleId: StorageModuleId;
  readonly scope: StorageScope;
  readonly operationId: string;
  readonly contractDigest: string;
  readonly sourceBoundary: string;
  readonly ordinal: string;
  readonly predecessorHash: string | null;
}

export interface StagedRootFragment {
  readonly ordinal: string;
  readonly effects: AtomicUnit;
}

const sha256 = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');

const guardFrame = (guard: RegisteredGuard): Frame => {
  switch (guard.kind) {
    case 'head':
      return ['head', guard.chainId, guard.hash];
    case 'absent':
      return ['absent', guard.chainId];
    case 'aggregate-version':
      return ['aggregate-version', guard.key, guard.version];
    case 'predicate':
      return ['predicate', guard.predicateId, guard.dependency];
  }
};

const expectationFrame = (expectation: ChainExpectation): Frame =>
  expectation.kind === 'absent' ? ['absent', expectation.allocation] : ['head', expectation.hash];

/** Dependencies are derived from canonical guards and append expectations
 * (N1: existing canonical guards/references supply dependency metadata). */
export const deriveStagedDependencies = (effects: AtomicUnit): readonly StagedDependency[] => [
  ...effects.guards.map((guard): StagedDependency => ['guard', guardFrame(guard)]),
  ...effects.appends.map(
    (entry): StagedDependency => ['append-expectation', entry.chainId, entry.record.id, expectationFrame(entry.expectation)],
  ),
];

export const encodeStagedEffects = (effects: AtomicUnit): string =>
  JSON.stringify([
    'staged-effects',
    STAGED_CODEC_VERSION,
    effects.guards.map(guardFrame),
    effects.records.map((entry) => ['record', entry.key, entry.bytes.format, entry.bytes.data, entry.contentHash]),
    effects.appends.map((entry) => [
      'append',
      entry.chainId,
      entry.record.id,
      entry.record.bytes,
      entry.record.hash,
      expectationFrame(entry.expectation),
    ]),
    effects.updates.map((entry) => ['update', entry.key, entry.version, entry.value.format, entry.value.data]),
    effects.relationships.map((entry) => ['relationship', entry.kind, entry.relation, entry.from, entry.to]),
    effects.barriers.map((entry) => ['barrier', entry.boundary, entry.reason]),
    effects.purgeIntents.map((entry) => ['purge-intent', entry.target, entry.intentId, entry.authorizedBy]),
    effects.indexWrites.map((entry) => [
      'index',
      entry.key,
      entry.digest,
      [...entry.resultIds],
      entry.resultHash === null ? ['null'] : ['hash', entry.resultHash],
    ]),
    effects.moduleResult === undefined ? ['absent'] : ['present', effects.moduleResult.format, effects.moduleResult.data],
    deriveStagedDependencies(effects),
  ]);

export const stagedEffectDigest = (effects: AtomicUnit): string => sha256(encodeStagedEffects(effects));

export const stagedFragmentDigest = (binding: StagedFragmentBinding, effects: AtomicUnit): string =>
  sha256(
    JSON.stringify([
      'staged-fragment',
      STAGED_CODEC_VERSION,
      binding.moduleId,
      binding.scope.tenantId,
      binding.scope.workspaceId,
      binding.operationId,
      binding.contractDigest,
      binding.sourceBoundary,
      binding.ordinal,
      binding.predecessorHash === null ? ['null'] : ['hash', binding.predecessorHash],
      stagedEffectDigest(effects),
    ]),
  );

export const stagedCommitRoots = (
  fragments: readonly StagedRootFragment[],
): { readonly dependencyRoot: string; readonly effectRoot: string } => ({
  dependencyRoot: sha256(
    JSON.stringify([
      'staged-dependency-root',
      STAGED_CODEC_VERSION,
      fragments.map((fragment) => [fragment.ordinal, deriveStagedDependencies(fragment.effects)]),
    ]),
  ),
  effectRoot: sha256(
    JSON.stringify([
      'staged-effect-root',
      STAGED_CODEC_VERSION,
      fragments.map((fragment) => [fragment.ordinal, stagedEffectDigest(fragment.effects)]),
    ]),
  ),
});
