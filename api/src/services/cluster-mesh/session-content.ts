import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { and, eq, gt, inArray, lte, sql } from 'drizzle-orm';
import {
  computePolicyDigest,
  validateRetentionByChannel,
  type RetentionByChannel,
} from '@sentropic/cluster-mesh';
import { db } from '../../db/client';
import {
  sessionContentAdmissions,
  sessionContentAttempts,
  sessionContentGrants,
  sessionContentHistoryAuthorizations,
  sessionContentNamespaces,
  sessionContentObjects,
  sessionContentOfflineReceipts,
  sessionContentProjects,
  sessionContentPurgeJobs,
  sessionContentReservations,
  sessionContentTombstones,
  sessionWorkspaceBindings,
} from '../../db/control-schema';
import { tenantMemberships, tenants, users, workspaces } from '../../db/schema';

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

export interface SessionContentOptions {
  readonly nowMs?: () => number;
  readonly newId?: () => string;
  readonly quotas?: Partial<SessionContentQuotas>;
  readonly storage?: Partial<SessionContentStorageConfig>;
  readonly epochs?: ContentAuthorityEpochPort;
  readonly issuer?: string;
}

/** CM2-R2-3 empty-state fast path: indexed lookup of affected D2 state. An
 * absent D2 footprint returns empty without allocating namespace, tombstone
 * or job. Missing/unreadable control tables are NOT empty-state evidence. */
export interface SessionContentEmptyState {
  readonly empty: boolean;
  readonly namespaces: number;
  readonly projects: number;
  readonly grants: number;
  readonly reservations: number;
  readonly purgeJobs: number;
}

export interface PreparedSessionProject {
  readonly policy: Record<string, unknown>;
  readonly digest: string;
  readonly expectedRevision: number | null;
}

export interface AcceptSessionProjectInput extends PreparedSessionProject {
  readonly offlineReadAccepted: boolean;
}

export interface DeriveSessionGrantInput {
  readonly projectId: string;
  readonly sessionId: string;
  readonly bindingId: string;
  readonly bindingVersion: number;
  readonly d1Version: number;
  readonly d1Incarnation: number;
  readonly d1StartSeq: number;
  readonly workspaceId: string;
  readonly sessionCreatedAt: number;
  readonly sourceGeneration: string;
  readonly sourceTrustVersion: string;
  readonly nativeStartSeq: number;
}

export interface SessionContentUsage {
  readonly committedBytes: number;
  readonly stagedBytes: number;
  readonly reservedBytes: number;
  readonly pendingDeletionBytes: number;
  readonly closedBytes: number;
  readonly objectCount: number;
}

export interface PaginatedObjectInventory {
  readonly objects: ReadonlyArray<{
    readonly objectId: string;
    readonly sessionId: string;
    readonly channel: string;
    readonly bytesRaw: number;
    readonly bytesEncoded: number;
    readonly expiresAt: number | null;
    readonly state: string;
  }>;
  readonly nextCursor: string | null;
}

type DbClient = typeof db;

export class SessionContentService {
  private readonly nowMs: () => number;
  private readonly newId: () => string;
  private readonly quotas: SessionContentQuotas;
  private readonly explicitStorage?: Partial<SessionContentStorageConfig>;
  private readonly epochs: ContentAuthorityEpochPort;
  private readonly issuer: string;
  private s3: S3Client | null = null;
  private storageConfig: SessionContentStorageConfig | null = null;

  constructor(options: SessionContentOptions = {}) {
    this.nowMs = options.nowMs ?? (() => Date.now());
    this.newId = options.newId ?? (() => crypto.randomUUID());
    this.quotas = { ...DEFAULT_SESSION_CONTENT_QUOTAS, ...options.quotas };
    this.explicitStorage = options.storage;
    this.epochs = options.epochs ?? createFileContentAuthorityEpochPort();
    this.issuer = options.issuer ?? 'sentropic-product';
  }

  /** Storage client with zero S3 calls when unconfigured: valid DOC_STORAGE
   * plus no SESSION_CONTENT_STORAGE configuration refuses here. */
  private storage(): { client: S3Client; config: SessionContentStorageConfig } {
    if (!this.s3 || !this.storageConfig) {
      const config = resolveSessionContentStorage(this.explicitStorage);
      if (!config) {
        throw new SessionContentError(
          'storage_unavailable',
          'dedicated session content storage is not configured',
        );
      }
      this.storageConfig = config;
      this.s3 = createSessionContentS3Client(config);
    }
    return { client: this.s3, config: this.storageConfig };
  }

  private async checkEpoch(): Promise<ContentAuthorityEpoch> {
    return this.epochs.readCurrent(this.issuer);
  }

  private async checkMembership(
    client: DbClient,
    tenantId: string,
    principalId: string,
  ): Promise<void> {
    const [tenant] = await client
      .select({ status: tenants.status })
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .limit(1);
    if (!tenant || tenant.status !== 'active') {
      throw new SessionContentError('membership_required', 'tenant is not active');
    }
    const [membership] = await client
      .select({ status: tenantMemberships.status })
      .from(tenantMemberships)
      .where(
        and(
          eq(tenantMemberships.tenantId, tenantId),
          eq(tenantMemberships.userId, principalId),
        ),
      )
      .limit(1);
    if (membership?.status !== 'approved') {
      throw new SessionContentError('membership_required', 'principal is not an approved member');
    }
  }

  private async checkTombstones(
    client: DbClient,
    kinds: ReadonlyArray<{ kind: 'tenant' | 'user' | 'workspace'; id: string }>,
  ): Promise<void> {
    for (const { kind, id } of kinds) {
      const [tomb] = await client
        .select({ tombstoneId: sessionContentTombstones.tombstoneId })
        .from(sessionContentTombstones)
        .where(
          and(
            eq(sessionContentTombstones.kind, kind),
            eq(sessionContentTombstones.publicId, id),
          ),
        )
        .limit(1);
      if (tomb) {
        throw new SessionContentError('tombstoned_scope', `${kind} ${id} was offboarded`);
      }
    }
  }

  async probeEmptyState(tenantId: string): Promise<SessionContentEmptyState> {
    let namespaces = 0;
    let projects = 0;
    let grants = 0;
    let reservations = 0;
    let purgeJobs = 0;
    try {
      const [n] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(sessionContentNamespaces)
        .where(eq(sessionContentNamespaces.tenantId, tenantId));
      namespaces = n?.count ?? 0;
      const [p] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(sessionContentProjects)
        .where(eq(sessionContentProjects.tenantId, tenantId));
      projects = p?.count ?? 0;
      const [g] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(sessionContentGrants)
        .where(eq(sessionContentGrants.tenantId, tenantId));
      grants = g?.count ?? 0;
      const [r] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(sessionContentReservations)
        .innerJoin(
          sessionContentNamespaces,
          eq(sessionContentReservations.namespaceId, sessionContentNamespaces.namespaceId),
        )
        .where(eq(sessionContentNamespaces.tenantId, tenantId));
      reservations = r?.count ?? 0;
      const [j] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(sessionContentPurgeJobs)
        .innerJoin(
          sessionContentNamespaces,
          eq(sessionContentPurgeJobs.namespaceId, sessionContentNamespaces.namespaceId),
        )
        .where(eq(sessionContentNamespaces.tenantId, tenantId));
      purgeJobs = j?.count ?? 0;
    } catch {
      throw new SessionContentError('control_unavailable', 'control tables are unreadable');
    }
    const empty =
      namespaces === 0 && projects === 0 && grants === 0 && reservations === 0 && purgeJobs === 0;
    return { empty, namespaces, projects, grants, reservations, purgeJobs };
  }

  /** Validate retention and bind the source-verified canonical digest
   * before any proof. Rejects zero/negative/malformed/unsigned durations
   * and altered digests with zero authorization. */
  prepareProject(policy: Record<string, unknown>): PreparedSessionProject {
    const retention = validateRetentionByChannel(
      (policy as Record<string, unknown>)['retentionByChannel'],
    );
    void retention;
    const digest = computePolicyDigest(policy);
    const revisionRaw = (policy as Record<string, unknown>)['projectRevision'];
    const expectedRevision =
      typeof revisionRaw === 'number' && Number.isSafeInteger(revisionRaw) && revisionRaw > 0
        ? revisionRaw
        : null;
    return { policy, digest, expectedRevision };
  }

  /** Atomically persist the accepted project, its offline-risk receipt and
   * its namespace. Public-row locks precede first allocation so delete
   * cannot race new D2 state. */
  async acceptProject(input: AcceptSessionProjectInput, ctx: SessionContentContext) {
    requireContext(ctx);
    if (input.offlineReadAccepted !== true) {
      throw new SessionContentError('invalid_request', 'offlineReadAccepted must be accepted');
    }
    if (computePolicyDigest(input.policy) !== input.digest) {
      throw new SessionContentError('policy_digest_mismatch', 'prepared policy was altered');
    }
    const policy = input.policy as Record<string, unknown> & {
      projectId: string;
      tenantId: string;
      workspaceId: string;
      ownerId: string;
      readers: string[];
    };
    if (policy['tenantId'] !== ctx.tenantId || policy['ownerId'] !== ctx.ownerId) {
      throw new SessionContentError('cross_owner_refused', 'policy scope must match the caller');
    }
    if (!Array.isArray(policy['readers']) || policy['readers'].length !== 1 || policy['readers'][0] !== ctx.ownerId) {
      throw new SessionContentError('cross_owner_refused', 'project readers are owner-only');
    }
    const epoch = await this.checkEpoch();
    return db.transaction(async (tx) => {
      await this.checkMembership(tx, ctx.tenantId, ctx.principalId);
      await this.checkTombstones(tx, [
        { kind: 'tenant', id: ctx.tenantId },
        { kind: 'user', id: ctx.ownerId },
        { kind: 'workspace', id: String(policy['workspaceId']) },
      ]);
      await tx.execute(
        sql`SELECT id FROM tenants WHERE id = ${ctx.tenantId} FOR UPDATE`,
      );
      const [existing] = await tx
        .select()
        .from(sessionContentProjects)
        .where(eq(sessionContentProjects.projectId, String(policy['projectId'])))
        .limit(1);
      const revision = input.expectedRevision ?? 0;
      if (input.expectedRevision === null) {
        if (existing) throw new SessionContentError('revision_conflict', 'project already exists');
      } else {
        if (!existing || existing.projectRevision !== input.expectedRevision) {
          throw new SessionContentError('revision_conflict', 'project revision mismatch');
        }
      }
      const now = new Date(this.nowMs());
      const row = {
        projectId: String(policy['projectId']),
        projectRevision: revision,
        tenantId: ctx.tenantId,
        workspaceId: String(policy['workspaceId']),
        workspaceIncarnation: Number(policy['workspaceIncarnation'] ?? 1),
        ownerId: ctx.ownerId,
        state: 'active',
        channels: policy['channels'] ?? {},
        futureSessions: policy['futureSessions'] === true,
        selectedSessionIds: policy['selectedSessionIds'] ?? [],
        namedHistories: policy['namedHistories'] ?? [],
        retentionByChannel: policy['retentionByChannel'] ?? {},
        retentionDigest: input.digest,
        acceptedPolicy: input.policy,
        authorityEpoch: epoch.epoch,
        offlineReadAccepted: true,
        exclusionRevision: 0,
        excludedSessionIds: [],
        requiresFreshAmendment: false,
        activatedAt: now,
        updatedAt: now,
      };
      if (existing) {
        await tx
          .update(sessionContentProjects)
          .set({ ...row, createdAt: existing.createdAt })
          .where(
            and(
              eq(sessionContentProjects.projectId, row.projectId),
              eq(sessionContentProjects.projectRevision, input.expectedRevision),
            ),
          );
      } else {
        await tx.insert(sessionContentProjects).values(row);
      }
      await tx.insert(sessionContentOfflineReceipts).values({
        receiptId: this.newId(),
        projectId: row.projectId,
        ownerId: ctx.ownerId,
        policyDigest: input.digest,
      });
      const namespaceId = namespaceIdFor(ctx.tenantId, ctx.ownerId, epoch.epoch);
      await tx
        .insert(sessionContentNamespaces)
        .values({
          namespaceId,
          tenantId: ctx.tenantId,
          ownerId: ctx.ownerId,
          epoch: epoch.epoch,
          status: 'active',
        })
        .onConflictDoNothing();
      return { projectId: row.projectId, revision, namespaceId, digest: input.digest };
    });
  }

  /** A confirmed amendment establishes the next capture boundary only:
   * existing no-expiry copies and finite deadlines are never rewritten. */
  async amendProject(
    projectId: string,
    policy: Record<string, unknown>,
    ctx: SessionContentContext,
  ) {
    requireContext(ctx);
    const prepared = this.prepareProject(policy);
    return db.transaction(async (tx) => {
      await this.checkMembership(tx, ctx.tenantId, ctx.principalId);
      const [existing] = await tx
        .select()
        .from(sessionContentProjects)
        .where(eq(sessionContentProjects.projectId, projectId))
        .limit(1);
      if (!existing) throw new SessionContentError('project_not_found', 'unknown project');
      if (existing.tenantId !== ctx.tenantId || existing.ownerId !== ctx.ownerId) {
        throw new SessionContentError('cross_owner_refused', 'project belongs to another owner');
      }
      if (existing.state !== 'active') {
        throw new SessionContentError('project_not_active', 'project is not active');
      }
      const nextRevision = existing.projectRevision + 1;
      await tx
        .update(sessionContentProjects)
        .set({
          projectRevision: nextRevision,
          channels: policy['channels'] ?? {},
          futureSessions: policy['futureSessions'] === true,
          selectedSessionIds: policy['selectedSessionIds'] ?? [],
          namedHistories: policy['namedHistories'] ?? [],
          retentionByChannel: policy['retentionByChannel'] ?? {},
          retentionDigest: prepared.digest,
          acceptedPolicy: policy,
          excludedSessionIds: [],
          requiresFreshAmendment: false,
          updatedAt: new Date(this.nowMs()),
        })
        .where(
          and(
            eq(sessionContentProjects.projectId, projectId),
            eq(sessionContentProjects.projectRevision, existing.projectRevision),
          ),
        );
      return { projectId, revision: nextRevision, digest: prepared.digest };
    });
  }

  async revokeProject(projectId: string, ctx: SessionContentContext) {
    requireContext(ctx);
    return db.transaction(async (tx) => {
      await this.checkMembership(tx, ctx.tenantId, ctx.principalId);
      const [existing] = await tx
        .select()
        .from(sessionContentProjects)
        .where(eq(sessionContentProjects.projectId, projectId))
        .limit(1);
      if (!existing) throw new SessionContentError('project_not_found', 'unknown project');
      if (existing.tenantId !== ctx.tenantId || existing.ownerId !== ctx.ownerId) {
        throw new SessionContentError('cross_owner_refused', 'project belongs to another owner');
      }
      await tx
        .update(sessionContentProjects)
        .set({ state: 'revoked', updatedAt: new Date(this.nowMs()) })
        .where(eq(sessionContentProjects.projectId, projectId));
      await tx
        .update(sessionContentGrants)
        .set({ state: 'revoked', updatedAt: new Date(this.nowMs()) })
        .where(eq(sessionContentGrants.projectId, projectId));
      return { projectId, state: 'revoked' as const };
    });
  }

  async excludeSession(projectId: string, sessionId: string, ctx: SessionContentContext) {
    requireContext(ctx);
    return db.transaction(async (tx) => {
      await this.checkMembership(tx, ctx.tenantId, ctx.principalId);
      const [existing] = await tx
        .select()
        .from(sessionContentProjects)
        .where(eq(sessionContentProjects.projectId, projectId))
        .limit(1);
      if (!existing) throw new SessionContentError('project_not_found', 'unknown project');
      if (existing.tenantId !== ctx.tenantId || existing.ownerId !== ctx.ownerId) {
        throw new SessionContentError('cross_owner_refused', 'project belongs to another owner');
      }
      const excluded = new Set((existing.excludedSessionIds as string[]).map(String));
      excluded.add(sessionId);
      await tx
        .update(sessionContentProjects)
        .set({
          excludedSessionIds: [...excluded],
          exclusionRevision: existing.exclusionRevision + 1,
          updatedAt: new Date(this.nowMs()),
        })
        .where(eq(sessionContentProjects.projectId, projectId));
      await tx
        .update(sessionContentGrants)
        .set({ state: 'excluded', updatedAt: new Date(this.nowMs()) })
        .where(eq(sessionContentGrants.sessionId, sessionId));
      return { projectId, sessionId, exclusionRevision: existing.exclusionRevision + 1 };
    });
  }

  /** Derive one eligible future/selected child with no new prompt, bound
   * to its new D1 version/incarnation/start sequence. Reattachment never
   * reuses an old grant; source replacement requires reauthorization. */
  async deriveGrant(input: DeriveSessionGrantInput, ctx: SessionContentContext) {
    requireContext(ctx);
    const epoch = await this.checkEpoch();
    return db.transaction(async (tx) => {
      await this.checkMembership(tx, ctx.tenantId, ctx.principalId);
      await this.checkTombstones(tx, [
        { kind: 'tenant', id: ctx.tenantId },
        { kind: 'user', id: ctx.ownerId },
        { kind: 'workspace', id: input.workspaceId },
      ]);
      const [project] = await tx
        .select()
        .from(sessionContentProjects)
        .where(eq(sessionContentProjects.projectId, input.projectId))
        .limit(1);
      if (!project) throw new SessionContentError('project_not_found', 'unknown project');
      if (project.tenantId !== ctx.tenantId || project.ownerId !== ctx.ownerId) {
        throw new SessionContentError('cross_owner_refused', 'project belongs to another owner');
      }
      if (project.state !== 'active') {
        throw new SessionContentError('project_not_active', 'project is not active');
      }
      if ((project.excludedSessionIds as string[]).map(String).includes(input.sessionId)) {
        throw new SessionContentError('session_excluded', 'session is excluded');
      }
      if (project.requiresFreshAmendment) {
        throw new SessionContentError('suppressed_scope', 'a fresh amendment is required');
      }
      const policy = project.acceptedPolicy as Record<string, unknown> & {
        sourceTrustVersions: string[];
        selectedSessionIds: string[];
      };
      const trustVersions = (policy['sourceTrustVersions'] as string[]).map(String);
      if (!trustVersions.includes(input.sourceTrustVersion)) {
        throw new SessionContentError(
          'source_reauthorization_required',
          'source trust version is not covered',
        );
      }
      const [binding] = await tx
        .select()
        .from(sessionWorkspaceBindings)
        .where(eq(sessionWorkspaceBindings.sessionId, input.sessionId))
        .limit(1);
      if (!binding || binding.tenantId !== ctx.tenantId) {
        throw new SessionContentError('ineligible_session', 'no eligible D1 binding');
      }
      if (binding.bindingId !== input.bindingId || binding.version !== input.bindingVersion) {
        throw new SessionContentError('ineligible_session', 'binding version mismatch (ABA)');
      }
      const [existing] = await tx
        .select()
        .from(sessionContentGrants)
        .where(eq(sessionContentGrants.sessionId, input.sessionId))
        .limit(1);
      if (existing) throw new SessionContentError('revision_conflict', 'grant already derived');
      const now = new Date(this.nowMs());
      const namespaceId = namespaceIdFor(ctx.tenantId, ctx.ownerId, epoch.epoch);
      await tx
        .insert(sessionContentNamespaces)
        .values({
          namespaceId,
          tenantId: ctx.tenantId,
          ownerId: ctx.ownerId,
          epoch: epoch.epoch,
          status: 'active',
        })
        .onConflictDoNothing();
      const row = {
        grantId: this.newId(),
        sessionId: input.sessionId,
        projectId: input.projectId,
        projectRevision: project.projectRevision,
        bindingId: input.bindingId,
        bindingVersion: input.bindingVersion,
        d1Version: input.d1Version,
        d1Incarnation: input.d1Incarnation,
        d1StartSeq: input.d1StartSeq,
        tenantId: ctx.tenantId,
        workspaceId: input.workspaceId,
        ownerId: ctx.ownerId,
        sourceGeneration: input.sourceGeneration,
        sourceTrustVersion: input.sourceTrustVersion,
        nativeBoundarySeq: input.nativeStartSeq,
        channels: project.channels,
        retentionSnapshot: project.retentionByChannel,
        state: 'active',
        version: 1,
        lastFreshnessAckAt: input.sessionCreatedAt,
        localDenyPending: false,
        retainedCopies: false,
        createdAt: now,
        updatedAt: now,
      };
      await tx.insert(sessionContentGrants).values(row);
      return { grantId: row.grantId, sessionId: row.sessionId, version: 1 };
    });
  }

  /** Revocation commits before readers/producers close: the grant is
   * fenced first, uncommitted work settles, committed copies persist for
   * writer-settled purge. */
  async revokeGrant(sessionId: string, ctx: SessionContentContext) {
    requireContext(ctx);
    return db.transaction(async (tx) => {
      await this.checkMembership(tx, ctx.tenantId, ctx.principalId);
      const [grant] = await tx
        .select()
        .from(sessionContentGrants)
        .where(eq(sessionContentGrants.sessionId, sessionId))
        .limit(1);
      if (!grant) throw new SessionContentError('grant_not_found', 'unknown grant');
      if (grant.tenantId !== ctx.tenantId || grant.ownerId !== ctx.ownerId) {
        throw new SessionContentError('cross_owner_refused', 'grant belongs to another owner');
      }
      await tx
        .update(sessionContentGrants)
        .set({ state: 'revoked', updatedAt: new Date(this.nowMs()) })
        .where(eq(sessionContentGrants.sessionId, sessionId));
      await tx
        .update(sessionContentReservations)
        .set({ state: 'cancelled', updatedAt: new Date(this.nowMs()) })
        .where(
          and(
            eq(sessionContentReservations.sessionId, sessionId),
            eq(sessionContentReservations.state, 'reserved'),
          ),
        );
      return { sessionId, state: 'revoked' as const };
    });
  }

  /** Retained-closed transition (O4=B): live closes, committed copies stay
   * readable only under a distinct history authorization. Never enqueues
   * committed-copy purge; merely closing a viewer purges nothing. */
  async closeGrant(sessionId: string, ctx: SessionContentContext) {
    requireContext(ctx);
    return db.transaction(async (tx) => {
      await this.checkMembership(tx, ctx.tenantId, ctx.principalId);
      const [grant] = await tx
        .select()
        .from(sessionContentGrants)
        .where(eq(sessionContentGrants.sessionId, sessionId))
        .limit(1);
      if (!grant) throw new SessionContentError('grant_not_found', 'unknown grant');
      if (grant.tenantId !== ctx.tenantId || grant.ownerId !== ctx.ownerId) {
        throw new SessionContentError('cross_owner_refused', 'grant belongs to another owner');
      }
      const [committed] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(sessionContentObjects)
        .where(
          and(
            eq(sessionContentObjects.sessionId, sessionId),
            eq(sessionContentObjects.state, 'committed'),
          ),
        );
      await tx
        .update(sessionContentGrants)
        .set({
          state: 'closed',
          retainedCopies: (committed?.count ?? 0) > 0,
          updatedAt: new Date(this.nowMs()),
        })
        .where(eq(sessionContentGrants.sessionId, sessionId));
      await tx
        .update(sessionContentReservations)
        .set({ state: 'cancelled', updatedAt: new Date(this.nowMs()) })
        .where(
          and(
            eq(sessionContentReservations.sessionId, sessionId),
            eq(sessionContentReservations.state, 'reserved'),
          ),
        );
      return { sessionId, state: 'closed' as const, retainedCopies: (committed?.count ?? 0) > 0 };
    });
  }

  /** Distinct closed-history reading authority. Ceilings mirror the covered
   * objects' existing immutable deadlines and can never create a duration. */
  async grantHistoryAuthorization(
    sessionId: string,
    ctx: SessionContentContext,
  ) {
    requireContext(ctx);
    await this.checkEpoch();
    return db.transaction(async (tx) => {
      await this.checkMembership(tx, ctx.tenantId, ctx.principalId);
      const [grant] = await tx
        .select()
        .from(sessionContentGrants)
        .where(eq(sessionContentGrants.sessionId, sessionId))
        .limit(1);
      if (!grant) throw new SessionContentError('grant_not_found', 'unknown grant');
      if (grant.tenantId !== ctx.tenantId || grant.ownerId !== ctx.ownerId) {
        throw new SessionContentError('cross_owner_refused', 'grant belongs to another owner');
      }
      if (grant.state !== 'closed') {
        throw new SessionContentError('history_authorization_required', 'session is not closed');
      }
      const objects = await tx
        .select()
        .from(sessionContentObjects)
        .where(
          and(
            eq(sessionContentObjects.sessionId, sessionId),
            eq(sessionContentObjects.state, 'committed'),
          ),
        );
      const ceilings: Record<string, number | null> = {
        'terminal.cache': null,
        'native.mirror': null,
      };
      for (const object of objects) {
        const channel = object.channel as 'terminal.cache' | 'native.mirror';
        const deadline = object.expiresAt ?? null;
        if (ceilings[channel] === null) ceilings[channel] = deadline;
        else if (deadline === null) ceilings[channel] = null;
        else ceilings[channel] = Math.min(ceilings[channel] as number, deadline);
      }
      const authorizationId = this.newId();
      await tx.insert(sessionContentHistoryAuthorizations).values({
        authorizationId,
        projectId: grant.projectId,
        sessionId,
        bindingId: grant.bindingId,
        projectRevision: grant.projectRevision,
        ceilings,
        state: 'active',
        version: 1,
      });
      return { authorizationId, sessionId, ceilings };
    });
  }

  async revokeHistoryAuthorization(authorizationId: string, ctx: SessionContentContext) {
    requireContext(ctx);
    return db.transaction(async (tx) => {
      await this.checkMembership(tx, ctx.tenantId, ctx.principalId);
      const [authorization] = await tx
        .select()
        .from(sessionContentHistoryAuthorizations)
        .where(eq(sessionContentHistoryAuthorizations.authorizationId, authorizationId))
        .limit(1);
      if (!authorization) throw new SessionContentError('not_found', 'unknown authorization');
      const [grant] = await tx
        .select()
        .from(sessionContentGrants)
        .where(eq(sessionContentGrants.sessionId, authorization.sessionId))
        .limit(1);
      if (!grant || grant.tenantId !== ctx.tenantId || grant.ownerId !== ctx.ownerId) {
        throw new SessionContentError('cross_owner_refused', 'authorization belongs elsewhere');
      }
      await tx
        .update(sessionContentHistoryAuthorizations)
        .set({ state: 'revoked' })
        .where(eq(sessionContentHistoryAuthorizations.authorizationId, authorizationId));
      await tx
        .update(sessionContentObjects)
        .set({ state: 'purge_pending', updatedAt: new Date(this.nowMs()) })
        .where(
          and(
            eq(sessionContentObjects.sessionId, authorization.sessionId),
            eq(sessionContentObjects.state, 'committed'),
          ),
        );
      const [covered] = await tx
        .select({ namespaceId: sessionContentObjects.namespaceId })
        .from(sessionContentObjects)
        .where(eq(sessionContentObjects.sessionId, authorization.sessionId))
        .limit(1);
      let namespaceId = covered?.namespaceId;
      if (!namespaceId) {
        const [fallback] = await tx
          .select({ namespaceId: sessionContentNamespaces.namespaceId })
          .from(sessionContentNamespaces)
          .where(
            and(
              eq(sessionContentNamespaces.tenantId, ctx.tenantId),
              eq(sessionContentNamespaces.ownerId, ctx.ownerId),
            ),
          )
          .limit(1);
        namespaceId = fallback?.namespaceId;
      }
      if (namespaceId) {
        await tx.insert(sessionContentPurgeJobs).values({
          purgeJobId: this.newId(),
          namespaceId,
          bindingId: grant.bindingId,
          scope: 'history',
          state: 'pending',
        });
      }
      return { authorizationId, state: 'revoked' as const };
    });
  }

  async clearExclusion(projectId: string, sessionId: string, ctx: SessionContentContext) {
    requireContext(ctx);
    return db.transaction(async (tx) => {
      await this.checkMembership(tx, ctx.tenantId, ctx.principalId);
      const [existing] = await tx
        .select()
        .from(sessionContentProjects)
        .where(eq(sessionContentProjects.projectId, projectId))
        .limit(1);
      if (!existing) throw new SessionContentError('project_not_found', 'unknown project');
      if (existing.tenantId !== ctx.tenantId || existing.ownerId !== ctx.ownerId) {
        throw new SessionContentError('cross_owner_refused', 'project belongs to another owner');
      }
      const excluded = new Set((existing.excludedSessionIds as string[]).map(String));
      excluded.delete(sessionId);
      await tx
        .update(sessionContentProjects)
        .set({
          excludedSessionIds: [...excluded],
          requiresFreshAmendment: true,
          updatedAt: new Date(this.nowMs()),
        })
        .where(eq(sessionContentProjects.projectId, projectId));
      return { projectId, sessionId, requiresFreshAmendment: true as const };
    });
  }
}
