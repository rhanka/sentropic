import type {
  AccountTransportAcquireInput,
  AccountTransportAcquisition,
} from '../account-transports.js';
import type { AccountTransportProviderId } from '../auth.js';
import type {
  EnrollmentProvider,
  EnrollmentSession,
  StartEnrollmentInput,
} from '../enrollment/contracts.js';
import { ClaudeCodeEnrollmentProvider } from '../enrollment/claude-code.js';
import { CloudCodeEnrollmentProvider } from '../enrollment/cloud-code.js';
import { CodexEnrollmentProvider } from '../enrollment/codex.js';
import { EncryptedFileKeyring } from '../node/keyring/encrypted-file-keyring.js';
import { InMemoryKeyring } from '../node/keyring/in-memory-keyring.js';
import { CloudCodeProviderAdapter } from '../transport/cloud-code-transport.js';
import { LocalAccountTransportService } from './local-account-transport-service.js';
import type { LlmMesh } from '../mesh.js';
import {
  InMemoryRoutePlanner, type InMemoryRoutePlannerOptions,
} from '../route-planner.js';
import type { RoutePlanner } from '../routing-contracts.js';

export interface ProviderRequest {
  modelId: string;
  contents: unknown[];
  generationConfig?: unknown;
  systemInstruction?: unknown;
  tools?: unknown[];
}

export type ProviderEvent =
  | { kind: 'content'; delta: string }
  | { kind: 'reasoning'; delta: string }
  | { kind: 'tool-call'; id: string; name: string; arguments: unknown }
  | { kind: 'done'; usage: unknown }
  | {
      kind: 'error'; code: string; message: string;
      statusCode?: number; retryAfterMs?: number;
    };

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
  /** Explicit owner used only to bind pre-ownerScope local keyring records. */
  legacyAccountOwnerScopeRef?: string;
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
  createRoutePlanner(
    runtime: Pick<LlmMesh, 'generate' | 'stream'>,
    options?: Omit<InMemoryRoutePlannerOptions, 'directory'>,
  ): RoutePlanner;
}

export function createLlmMeshFacade(options: FacadeOptions): LlmMeshFacade {
  if (!options) {
    throw new Error('LlmMeshFacade: options is required');
  }

  if (!options.configResolver) {
    throw new Error('configResolver is required');
  }

  const keyring =
    options.keyring ??
    (options.mode === 'cli' ? new EncryptedFileKeyring() : new InMemoryKeyring());
  const providers = new Map<string, EnrollmentProvider>([
    [
      'cloud-code',
      new CloudCodeEnrollmentProvider({ configResolver: options.configResolver }),
    ],
    ['codex', new CodexEnrollmentProvider({ configResolver: options.configResolver })],
    ['claude-code', new ClaudeCodeEnrollmentProvider()],
  ]);

  const service = new LocalAccountTransportService(
    keyring,
    providers,
    options.configResolver,
    options.legacyAccountOwnerScopeRef,
  );

  return {
    async enroll(providerId, input) {
      return service.enroll(providerId, input);
    },
    async waitForCallback(enrollmentId) {
      return service.waitForCallback(enrollmentId);
    },
    async pollForCompletion(enrollmentId) {
      return service.pollForCompletion(enrollmentId);
    },
    async cancel(enrollmentId) {
      return service.cancel(enrollmentId);
    },
    async acquire(input) {
      return service.acquire(input);
    },
    async release(acquisition) {
      return service.release(acquisition);
    },
    getAdapter(providerId) {
      if (providerId === 'cloud-code') {
        return new CloudCodeProviderAdapter();
      }
      throw new Error(`Adapter for ${providerId} not available locally`);
    },
    createRoutePlanner(runtime, routeOptions = {}) {
      return new InMemoryRoutePlanner({
        ...routeOptions,
        directory: service.createRouteDirectory(runtime),
      });
    },
  };
}
