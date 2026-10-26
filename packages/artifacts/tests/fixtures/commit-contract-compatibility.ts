/** Compile the actual frozen observer ABI against the operational construction. */
import type {
  ArtifactCommitCoordinator as FrozenCoordinator, ArtifactCommitParticipant as FrozenParticipant,
  ArtifactAuthorizationFence as FrozenFence, ArtifactCommitTransaction as FrozenTransaction,
  CommitBarrierObserver, CreateArtifactCommitBarrier,
} from '../../l0-freeze/commit-contract.js';
import { createArtifactCommitBarrier } from '../../src/testing.js';
import type { CommitBarrierObserver as CallbackObserver } from '../../src/testing.js';
import { createArtifactCommitCoordinator } from '../../src/server/commit/coordinator.js';
import type { CommitCoordinatorOptions } from '../../src/server/commit/types.js';
import type { ArtifactCommitCoordinator, ArtifactCommitParticipant,
  ArtifactAuthorizationFence, ArtifactCommitTransaction } from '../../src/server/commit/types.js';

declare const operationalCoordinator: ArtifactCommitCoordinator;
declare const operationalParticipant: ArtifactCommitParticipant;
const frozenCoordinator: FrozenCoordinator = operationalCoordinator;
const frozenParticipant: FrozenParticipant = operationalParticipant;
void frozenCoordinator;
void frozenParticipant;
declare const operationalFence: ArtifactAuthorizationFence;
declare const operationalTransaction: ArtifactCommitTransaction;
const frozenFence: FrozenFence = operationalFence;
const frozenTransaction: FrozenTransaction = operationalTransaction;
void frozenFence;
void frozenTransaction;
declare const publishedFence: import('@sentropic/artifacts/server/commit-contract').ArtifactAuthorizationFence;
declare const publishedTransaction: import('@sentropic/artifacts/server/commit-contract').ArtifactCommitTransaction;
const frozenPublishedFence: FrozenFence = publishedFence;
const frozenPublishedTransaction: FrozenTransaction = publishedTransaction;
void frozenPublishedFence;
void frozenPublishedTransaction;

// Literal credentials must remain impossible after nominal ABI convergence.
// @ts-expect-error — only the coordinator mints opaque fences
const forgedFence: ArtifactAuthorizationFence = { fenceId: 'f', transactionId: 't', invocationId: 'i', policyRevision: 'r' };
void forgedFence;

const createBarrier: CreateArtifactCommitBarrier = createArtifactCommitBarrier;
const observer: CommitBarrierObserver = createBarrier().observer;
const callback: CallbackObserver = createArtifactCommitBarrier().observer;
declare const options: Omit<CommitCoordinatorOptions, 'testObserver'>;
createArtifactCommitCoordinator({ ...options, testObserver: observer });
createArtifactCommitCoordinator({ ...options, testObserver: callback });
createArtifactCommitCoordinator({
  ...options, testObserver: observer, testPoints: ['before_commit'],
});
