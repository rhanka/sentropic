import type {
  AccountTransportAcquireInput,
  AccountTransportAcquisition,
} from '../account-transports.js';
import type { AccountTransportProviderId } from '../auth.js';
import type { EnrollmentSession, StartEnrollmentInput } from '../enrollment/contracts.js';

export interface ProviderRequest {
  modelId: string;
  contents: unknown[];
  generationConfig?: unknown;
}

export type ProviderEvent =
  | { kind: 'content'; delta: string }
  | { kind: 'done'; usage: unknown }
  | { kind: 'error'; code: string; message: string };

export interface ProviderAdapter {
  execute(
    acquisition: AccountTransportAcquisition,
    request: ProviderRequest,
    signal: AbortSignal,
  ): AsyncIterable<ProviderEvent>;
}

export interface KeyringAdapter {
  getSecret(key: string): Promise<string | null>;
  setSecret(key: string, secret: string): Promise<void>;
  deleteSecret(key: string): Promise<void>;
}

export interface ConfigResolver {
  resolveConfig(configRef: string): Promise<Record<string, unknown>>;
}

export interface FacadeOptions {
  configResolver: ConfigResolver;
  keyring?: KeyringAdapter;
  mode: 'cli' | 'portal';
}

export interface LlmMeshFacade {
  // CLI enrollment
  enroll(
    providerId: AccountTransportProviderId,
    input: StartEnrollmentInput,
  ): Promise<EnrollmentSession>;
  waitForCallback(enrollmentId: string): Promise<{ accountId: string; label: string }>;
  pollForCompletion(enrollmentId: string): Promise<{ accountId: string; label: string }>;
  cancel(enrollmentId: string): Promise<void>;

  // Runtime gateway (Q3A — acquire per request, 0 token in SessionEntry)
  acquire(input: AccountTransportAcquireInput): Promise<AccountTransportAcquisition>;
  release(acquisition: AccountTransportAcquisition): Promise<void>;

  // Provider adapter
  getAdapter(providerId: AccountTransportProviderId): ProviderAdapter;
}

export function createLlmMeshFacade(options: FacadeOptions): LlmMeshFacade {
  if (!options) {
    throw new Error('LlmMeshFacade: options is required');
  }

  if (!options.configResolver) {
    throw new Error('configResolver is required');
  }

  return {
    async enroll() {
      throw new Error('Not implemented');
    },
    async waitForCallback() {
      throw new Error('Not implemented');
    },
    async pollForCompletion() {
      throw new Error('Not implemented');
    },
    async cancel() {
      // no-op stub
    },
    async acquire() {
      throw new Error('Not implemented');
    },
    async release() {
      // no-op stub
    },
    getAdapter() {
      throw new Error('Not implemented');
    },
  };
}
