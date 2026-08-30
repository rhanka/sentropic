import type {
  ClusterMeshCutoverStore,
  NamespaceCutoverKey,
  NamespaceCutoverRecord,
} from '../persistence/ports.js';

export interface SessionRuntimeShadowProof {
  readonly strategy: 'runtime-shadow';
  readonly shadowMatched: boolean;
  readonly driveIntentValidated: boolean;
  readonly previousGenerationId: string;
}

export interface SessionParitySuiteProof {
  readonly strategy: 'parity-suite';
  readonly suiteRefs: readonly string[];
  readonly intentValidationRef: string;
  readonly previousGenerationId: string;
}

export type SessionCutoverProof = SessionRuntimeShadowProof | SessionParitySuiteProof;

type SessionCutoverEvidence = {
  readonly strategy: 'runtime-shadow';
  readonly readLegacy: () => Promise<unknown>;
  readonly readCandidate: () => Promise<unknown>;
  readonly validateDriveIntent: () => Promise<boolean>;
} | {
  readonly strategy: 'parity-suite';
  readonly suiteRefs: readonly string[];
  readonly intentValidationRef: string;
};

export async function activateSessionCutover(input: {
  readonly store: ClusterMeshCutoverStore;
  readonly key: NamespaceCutoverKey;
  readonly generationId: string;
  readonly previousGenerationId: string;
  readonly author: string;
} & SessionCutoverEvidence): Promise<NamespaceCutoverRecord> {
  let proof: SessionCutoverProof;
  if (input.strategy === 'runtime-shadow') {
    const [legacy, candidate, driveIntentValidated] = await Promise.all([
      input.readLegacy(),
      input.readCandidate(),
      input.validateDriveIntent(),
    ]);
    if (JSON.stringify(legacy) !== JSON.stringify(candidate) || !driveIntentValidated) {
      throw new Error('session cutover shadow proof failed');
    }
    proof = {
      strategy: 'runtime-shadow', shadowMatched: true, driveIntentValidated: true,
      previousGenerationId: input.previousGenerationId,
    };
  } else {
    if (input.suiteRefs.length === 0 || !input.intentValidationRef) {
      throw new Error('session cutover parity-suite evidence is missing');
    }
    proof = {
      strategy: 'parity-suite', suiteRefs: input.suiteRefs,
      intentValidationRef: input.intentValidationRef,
      previousGenerationId: input.previousGenerationId,
    };
  }
  const shadow: NamespaceCutoverRecord = {
    ...input.key,
    selectedGenerationId: input.generationId,
    previousGenerationId: input.previousGenerationId,
    activeAuthor: input.author,
    status: 'shadow',
    shadowComparison: proof,
    rollbackCheckpoint: {
      generationId: input.previousGenerationId,
      activeAuthor: 'unavailable-after-replacement',
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
