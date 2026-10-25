/** Compile the actual frozen observer ABI against the operational construction. */
import type {
  ArtifactCommitCoordinator, ArtifactCommitParticipant,
  CommitBarrierObserver, CreateArtifactCommitBarrier,
} from '../../l0-freeze/commit-contract.js';
import { createArtifactCommitBarrier } from '../../src/testing.js';
import type { CommitBarrierObserver as CallbackObserver } from '../../src/testing.js';
import { createArtifactCommitCoordinator } from '../../src/server/commit/coordinator.js';
import type { CommitCoordinatorOptions } from '../../src/server/commit/types.js';
import type { FinalizationCoordinator, CommitPolicyParticipant } from '../../src/server/commit/types.js';

declare const operationalCoordinator: FinalizationCoordinator;
declare const operationalParticipant: CommitPolicyParticipant;
const frozenCoordinator: ArtifactCommitCoordinator = operationalCoordinator;
const frozenParticipant: ArtifactCommitParticipant = operationalParticipant;
void frozenCoordinator;
void frozenParticipant;

const createBarrier: CreateArtifactCommitBarrier = createArtifactCommitBarrier;
const observer: CommitBarrierObserver = createBarrier().observer;
const callback: CallbackObserver = createArtifactCommitBarrier().observer;
declare const options: Omit<CommitCoordinatorOptions, 'testObserver'>;
createArtifactCommitCoordinator({ ...options, testObserver: observer });
createArtifactCommitCoordinator({ ...options, testObserver: callback });
createArtifactCommitCoordinator({
  ...options, testObserver: observer, testPoints: ['before_commit'],
});
