import { S3Client } from '@aws-sdk/client-s3';
import {
  computePolicyDigest,
  validateRetentionByChannel,
  type RetentionByChannel,
} from '@sentropic/cluster-mesh';

export type SessionContentErrorCode =
  | 'storage_unavailable'
  | 'control_unavailable'
  | 'invalid_request'
  | 'invalid_retention'
  | 'unsigned_retention'
  | 'policy_digest_mismatch'
  | 'challenge_replayed'
  | 'challenge_expired'
  | 'challenge_unknown'
  | 'project_not_found'
  | 'project_not_active'
  | 'project_revoked'
  | 'tombstoned_scope'
  | 'session_excluded'
  | 'suppressed_scope'
  | 'ineligible_session'
  | 'cross_tenant_refused'
  | 'cross_owner_refused'
  | 'source_reauthorization_required'
  | 'membership_required'
  | 'revision_conflict'
  | 'quota_exceeded'
  | 'frame_too_large'
  | 'attempt_conflict'
  | 'unknown_outcome'
  | 'grant_not_found'
  | 'grant_revoked'
  | 'grant_closed'
  | 'history_authorization_required'
  | 'history_authorization_revoked'
  | 'object_expired'
  | 'epoch_unavailable'
  | 'epoch_stale'
  | 'epoch_disabled'
  | 'purge_pending'
  | 'not_found'
  | 'cross_prefix_refused'
  | 'admin_read_refused'
  | 'namespace_not_found';

export class SessionContentError extends Error {
  constructor(
    readonly code: SessionContentErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'SessionContentError';
  }
}

/** Explicit D2 storage configuration. No DOC_STORAGE fallback: when no
 * session config is present the service refuses with storage_unavailable
 * and performs zero S3 calls. CM2-F3: production activation stays fenced
 * off; tests inject disposable fixture credentials explicitly. */
export interface SessionContentStorageConfig {
  readonly endpoint: string;
  readonly region: string;
  readonly bucket: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
}

const readEnv = (name: string): string | undefined => {
  const raw = process.env[name];
  if (!raw) return undefined;
  const trimmed = raw.trim();
  return trimmed ? trimmed : undefined;
};

/** Resolve the dedicated D2 storage config from an explicit value or the
 * `SESSION_CONTENT_STORAGE_*` environment. Retention is never an env
 * setting: it lives only in the owner-confirmed project/channel payload. */
export const resolveSessionContentStorage = (
  explicit?: Partial<SessionContentStorageConfig>,
): SessionContentStorageConfig | null => {
  const config: SessionContentStorageConfig = {
    endpoint: explicit?.endpoint ?? readEnv('SESSION_CONTENT_STORAGE_ENDPOINT') ?? '',
    region: explicit?.region ?? readEnv('SESSION_CONTENT_STORAGE_REGION') ?? 'fr-par-1',
    bucket: explicit?.bucket ?? readEnv('SESSION_CONTENT_STORAGE_BUCKET') ?? '',
    accessKeyId: explicit?.accessKeyId ?? readEnv('SESSION_CONTENT_STORAGE_ACCESS_KEY') ?? '',
    secretAccessKey:
      explicit?.secretAccessKey ?? readEnv('SESSION_CONTENT_STORAGE_SECRET_KEY') ?? '',
  };
  if (!config.endpoint || !config.bucket || !config.accessKeyId || !config.secretAccessKey) {
    return null;
  }
  return config;
};

export const createSessionContentS3Client = (config: SessionContentStorageConfig): S3Client =>
  new S3Client({
    region: config.region,
    endpoint: config.endpoint,
    forcePathStyle: true,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  });

/** Immutable tenant/owner/epoch object scope. Keys never carry payloads. */
export const namespaceIdFor = (tenantId: string, ownerId: string, epoch: string): string =>
  `scc:${tenantId}:${ownerId}:${epoch}`;

export const objectKeyFor = (
  namespaceId: string,
  bindingId: string,
  sessionId: string,
  channel: string,
  objectId: string,
): string => `${namespaceId}/${bindingId}/${sessionId}/${channel}/${objectId}`;

/** External authority epoch verdict. The record lives outside PostgreSQL
 * backups (operations activation record); missing means off. */
export interface ContentAuthorityEpoch {
  readonly epoch: string;
  readonly revision: number;
  readonly enabled: boolean;
  readonly validUntil: number;
}

export interface ContentAuthorityEpochPort {
  readCurrent(issuer: string): Promise<ContentAuthorityEpoch>;
}

export const readAuthorityRecordFile = async (recordPath: string): Promise<unknown> => {
  const { readFile } = await import('node:fs/promises');
  return JSON.parse(await readFile(recordPath, 'utf8'));
};

/** Real operations-managed adapter: explicit
 * `SESSION_CONTENT_AUTHORITY_RECORD_PATH`, missing means off. Never the
 * test fake. CM2-F3: activation requires this external record plus fresh
 * human/source consent; nothing here invents an operational profile. */
export const createFileContentAuthorityEpochPort = (
  recordPath = readEnv('SESSION_CONTENT_AUTHORITY_RECORD_PATH') ?? '',
  nowMs: () => number = () => Date.now(),
): ContentAuthorityEpochPort => ({
  async readCurrent(issuer: string): Promise<ContentAuthorityEpoch> {
    if (!recordPath) {
      throw new SessionContentError('epoch_unavailable', 'content authority is not activated');
    }
    let record: Record<string, unknown>;
    try {
      record = (await readAuthorityRecordFile(recordPath)) as Record<string, unknown>;
    } catch {
      throw new SessionContentError('epoch_unavailable', 'content authority record is unreadable');
    }
    if (record['issuer'] !== issuer) {
      throw new SessionContentError('epoch_unavailable', 'content authority issuer mismatch');
    }
    const epoch: ContentAuthorityEpoch = {
      epoch: String(record['epoch'] ?? ''),
      revision: Number(record['revision'] ?? 0),
      enabled: record['enabled'] === true,
      validUntil: Number(record['validUntil'] ?? 0),
    };
    if (!epoch.epoch) {
      throw new SessionContentError('epoch_unavailable', 'content authority epoch is missing');
    }
    if (!epoch.enabled) {
      throw new SessionContentError('epoch_disabled', 'content authority is disabled');
    }
    if (nowMs() > epoch.validUntil) {
      throw new SessionContentError('epoch_stale', 'content authority epoch expired');
    }
    return epoch;
  },
});

/** Test-only epoch port: rotate/setUnavailable/expireRead with a fake
 * clock, preserved across service restarts and restored DB rows because the
 * instance is shared. Never selected in production composition. */
export const createFakeContentAuthorityEpochPort = (
  initial: ContentAuthorityEpoch = { epoch: 'epoch-test-1', revision: 1, enabled: true, validUntil: Number.MAX_SAFE_INTEGER },
): ContentAuthorityEpochPort & {
  rotate(epoch: string): void;
  setUnavailable(): void;
  expireRead(): void;
  restore(initial: ContentAuthorityEpoch): void;
} => {
  let current: ContentAuthorityEpoch | null = initial;
  let expired = false;
  return {
    async readCurrent(): Promise<ContentAuthorityEpoch> {
      if (!current) {
        throw new SessionContentError('epoch_unavailable', 'fake authority is unavailable');
      }
      if (!current.enabled) {
        throw new SessionContentError('epoch_disabled', 'fake authority is disabled');
      }
      if (expired) {
        throw new SessionContentError('epoch_stale', 'fake authority epoch expired');
      }
      return current;
    },
    rotate(epoch: string): void {
      current = { epoch, revision: (current?.revision ?? 0) + 1, enabled: true, validUntil: Number.MAX_SAFE_INTEGER };
      expired = false;
    },
    setUnavailable(): void {
      current = null;
    },
    expireRead(): void {
      expired = true;
    },
    restore(next: ContentAuthorityEpoch): void {
      current = next;
      expired = false;
    },
  };
};

export { computePolicyDigest, validateRetentionByChannel };
export type { RetentionByChannel };

/** Architect qualification defaults: quotas pause new capture instead of
 * evicting retained copies. Tests inject smaller values explicitly. */
export interface SessionContentQuotas {
  readonly maxBytesPerSession: number;
  readonly maxBytesPerTenant: number;
  readonly maxBytesPerChannel: number;
  readonly maxFrameBytesRaw: number;
  readonly maxFrameBytesEncoded: number;
  readonly maxObjectsPerSession: number;
}

export const DEFAULT_SESSION_CONTENT_QUOTAS: SessionContentQuotas = {
  maxBytesPerSession: 256 * 1024 * 1024,
  maxBytesPerTenant: 1024 * 1024 * 1024,
  maxBytesPerChannel: 128 * 1024 * 1024,
  maxFrameBytesRaw: 8 * 1024 * 1024,
  maxFrameBytesEncoded: 8 * 1024 * 1024,
  maxObjectsPerSession: 4096,
};

export interface SessionContentContext {
  readonly tenantId: string;
  readonly principalId: string;
  readonly ownerId: string;
}

const requireContext = (ctx: SessionContentContext): void => {
  for (const [field, value] of Object.entries(ctx)) {
    if (typeof value !== 'string' || !value.trim()) {
      throw new SessionContentError('invalid_request', `${field} is required`);
    }
  }
};
