import type { GitAppOwnerRepository } from './contracts.js';

/** Internal custody material. Never export from the public package entry. */
export interface AppCredential {
  appId: string;
  slug: string;
  privateKey: string;
  webhookSecret: string;
}
export interface MintedToken {
  token: string;
  expiresAt: string;
  permissions: Record<string, string>;
  repositoryIds: string[];
}
export interface GitHubAppApi {
  exchange(code: string): Promise<AppCredential>;
  inspectInstallation(app: AppCredential, installationId: string): Promise<{
    permissions: Record<string, string>; suspended: boolean;
  }>;
  resolveRepository(app: AppCredential, installationId: string, locator: string): Promise<string>;
  mint(app: AppCredential, installationId: string, repositoryId: string, permissions: Record<string, string>): Promise<MintedToken>;
  verifyKey(app: AppCredential): Promise<void>;
  updateWebhookSecret(app: AppCredential): Promise<void>;
  revokeToken(token: string): Promise<void>;
}
export type RevocationReason = 'suspended' | 'uninstalled' | 'repository_removed' | 'permissions_lost' | 'owner_revoked';
export interface EnrollmentRecord {
  target: GitAppOwnerRepository;
  installationRef: string;
  webhookSecretRef: string;
  state: 'manifest' | 'install' | 'ready' | 'revoked';
  callbackState: string;
  callbackExpiresAt: number;
  credentialVersion: string;
  app?: AppCredential;
  installationId?: string;
  repositoryId?: string;
  previousWebhook?: { secret: string; version: string; until: number };
  webhookVersion: string;
  webhookRotationPending?: boolean;
  /** Encrypted revocation cache, never an audit journal; expired entries are erased. */
  leases: { token: string; expiresAt: string }[];
}

/** Host transaction must be durable, serializable and shared across replicas. */
export interface GitAppEnvelopeStore {
  transaction<T>(ref: string, action: (sealed: string | null) => Promise<{ sealed: string; result: T }>): Promise<T>;
}
export interface GitAppCustodian {
  create(record: EnrollmentRecord): Promise<void>;
  withRecord<T>(ref: string, action: (record: EnrollmentRecord) => Promise<T>): Promise<T>;
}
