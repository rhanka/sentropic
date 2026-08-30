import type {
  ClusterMeshCutoverStore,
  NamespaceCutoverKey,
  NamespaceCutoverRecord,
} from '../persistence/ports.js';

export interface SessionCutoverProof {
  readonly shadowMatched: boolean;
  readonly driveIntentValidated: boolean;
  readonly previousGenerationId: string;
}

export async function activateSessionCutover(input: {
  readonly store: ClusterMeshCutoverStore;
  readonly key: NamespaceCutoverKey;
  readonly generationId: string;
  readonly previousGenerationId: string;
  readonly author: string;
  readonly readLegacy: () => Promise<unknown>;
  readonly readCandidate: () => Promise<unknown>;
  readonly validateDriveIntent: () => Promise<boolean>;
}): Promise<NamespaceCutoverRecord> {
  const [legacy, candidate, driveIntentValidated] = await Promise.all([
    input.readLegacy(),
    input.readCandidate(),
    input.validateDriveIntent(),
  ]);
  const shadowMatched = JSON.stringify(legacy) === JSON.stringify(candidate);
  if (!shadowMatched || !driveIntentValidated) {
    throw new Error('session cutover shadow proof failed');
  }
  const proof: SessionCutoverProof = {
    shadowMatched,
    driveIntentValidated,
    previousGenerationId: input.previousGenerationId,
  };
  const shadow: NamespaceCutoverRecord = {
    ...input.key,
    selectedGenerationId: input.generationId,
    previousGenerationId: input.previousGenerationId,
    activeAuthor: input.author,
    status: 'shadow',
    shadowComparison: proof,
    rollbackCheckpoint: {
      generationId: input.previousGenerationId,
      activeAuthor: 'legacy-session',
    },
  };
  await input.store.activate(shadow);
  const active = { ...shadow, status: 'active' as const, activatedAt: new Date().toISOString() };
  await input.store.activate(active);
  return active;
}

export async function rollbackSessionCutover(input: {
  readonly store: ClusterMeshCutoverStore;
  readonly key: NamespaceCutoverKey;
}): Promise<NamespaceCutoverRecord> {
  const current = await input.store.find(input.key);
  if (!current?.previousGenerationId || !current.rollbackCheckpoint) {
    throw new Error('session rollback checkpoint is missing');
  }
  await input.store.rollback(input.key, current.previousGenerationId);
  const rolledBack = await input.store.find(input.key);
  if (!rolledBack || rolledBack.status !== 'rolled_back') {
    throw new Error('session rollback was not persisted');
  }
  return rolledBack;
}
