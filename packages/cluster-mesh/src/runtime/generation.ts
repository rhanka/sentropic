import type { VerifiedInvocationContextPort } from '@sentropic/contracts';
import type { InvocationReceiptPort } from '@sentropic/events';
import {
  resolveClusterMeshConfig,
  type ClusterMeshConfig,
  type ClusterMeshConfigInput,
} from '../config.js';
import { createCapacityAdmission, type CapacityAdmission } from './admission.js';
import type { RegistrationGate } from './registration.js';
import {
  createInvocationReceiptEmitter,
  type InvocationReceiptEmitter,
} from './receipts.js';

export interface ClusterMeshGeneration {
  readonly generationId: string;
  readonly status: 'active';
  readonly createdAt: string;
  readonly config: ClusterMeshConfig;
}

export interface ClusterMeshRuntime {
  readonly generation: ClusterMeshGeneration;
  readonly admission: CapacityAdmission;
  readonly context: VerifiedInvocationContextPort;
  readonly registration: RegistrationGate;
  readonly receiptPort: InvocationReceiptPort;
  readonly receipts: InvocationReceiptEmitter;
}

export function createClusterMeshRuntime(input: {
  readonly generationId: string;
  readonly config: ClusterMeshConfigInput;
  readonly context: VerifiedInvocationContextPort;
  readonly registration: RegistrationGate;
  readonly receipts: InvocationReceiptPort;
  readonly now?: () => Date;
}): ClusterMeshRuntime {
  const config = resolveClusterMeshConfig(input.config);
  const now = input.now ?? (() => new Date());
  const generation: ClusterMeshGeneration = {
    generationId: input.generationId,
    status: 'active',
    createdAt: now().toISOString(),
    config,
  };
  return {
    generation,
    admission: createCapacityAdmission({
      generationId: input.generationId,
      config: config.capacity,
      now,
    }),
    context: input.context,
    registration: input.registration,
    receiptPort: input.receipts,
    receipts: createInvocationReceiptEmitter({
      generationId: input.generationId,
      port: input.receipts,
      now,
    }),
  };
}
