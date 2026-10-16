import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { and, eq, gt, inArray, sql } from 'drizzle-orm';
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
import { tenantMemberships, tenants } from '../../db/schema';

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
        sql`SELECT id FROM "public"."tenants" WHERE id = ${ctx.tenantId} FOR UPDATE`,
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

  private async chargedBytes(
    client: DbClient,
    scope: { namespaceId?: string; sessionId?: string; tenantId?: string },
  ): Promise<number> {
    const conditions = [inArray(sessionContentObjects.state, ['staged', 'committed', 'purge_pending'])];
    if (scope.namespaceId) conditions.push(eq(sessionContentObjects.namespaceId, scope.namespaceId));
    if (scope.sessionId) conditions.push(eq(sessionContentObjects.sessionId, scope.sessionId));
    const [objects] = await client
      .select({ bytes: sql<number>`coalesce(sum(bytes_encoded), 0)::int` })
      .from(sessionContentObjects)
      .where(and(...conditions));
    const reservedConditions = [
      inArray(sessionContentReservations.state, ['reserved', 'stale']),
    ];
    if (scope.namespaceId) {
      reservedConditions.push(eq(sessionContentReservations.namespaceId, scope.namespaceId));
    }
    if (scope.sessionId) {
      reservedConditions.push(eq(sessionContentReservations.sessionId, scope.sessionId));
    }
    const [reserved] = await client
      .select({ bytes: sql<number>`coalesce(sum(bytes_encoded), 0)::int` })
      .from(sessionContentReservations)
      .where(and(...reservedConditions));
    let tenantBytes = 0;
    if (scope.tenantId && !scope.namespaceId && !scope.sessionId) {
      const namespaces = await client
        .select({ namespaceId: sessionContentNamespaces.namespaceId })
        .from(sessionContentNamespaces)
        .where(eq(sessionContentNamespaces.tenantId, scope.tenantId));
      const ids = namespaces.map((n) => n.namespaceId);
      if (ids.length > 0) {
        const [o] = await client
          .select({ bytes: sql<number>`coalesce(sum(bytes_encoded), 0)::int` })
          .from(sessionContentObjects)
          .where(
            and(
              inArray(sessionContentObjects.namespaceId, ids),
              inArray(sessionContentObjects.state, ['staged', 'committed', 'purge_pending']),
            ),
          );
        const [r] = await client
          .select({ bytes: sql<number>`coalesce(sum(bytes_encoded), 0)::int` })
          .from(sessionContentReservations)
          .where(
            and(
              inArray(sessionContentReservations.namespaceId, ids),
              inArray(sessionContentReservations.state, ['reserved', 'stale']),
            ),
          );
        tenantBytes = (o?.bytes ?? 0) + (r?.bytes ?? 0);
      }
    }
    return (objects?.bytes ?? 0) + (reserved?.bytes ?? 0) + tenantBytes;
  }

  /** Persist quota reservation before upload. Duplicate same-key
   * submissions return the recorded outcome; changed payloads conflict. */
  async reserveBeforeUpload(
    sessionId: string,
    channel: 'terminal.cache' | 'native.mirror',
    bytes: { raw: number; encoded: number },
    idempotencyKey: string,
    ctx: SessionContentContext,
  ) {
    requireContext(ctx);
    if (!Number.isSafeInteger(bytes.raw) || bytes.raw <= 0 || bytes.raw > this.quotas.maxFrameBytesRaw) {
      throw new SessionContentError('frame_too_large', 'raw frame exceeds the bounded buffer');
    }
    if (!Number.isSafeInteger(bytes.encoded) || bytes.encoded <= 0 || bytes.encoded > this.quotas.maxFrameBytesEncoded) {
      throw new SessionContentError('frame_too_large', 'encoded frame exceeds the bounded buffer');
    }
    const epoch = await this.checkEpoch();
    const namespaceId = namespaceIdFor(ctx.tenantId, ctx.ownerId, epoch.epoch);
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
      if (grant.state !== 'active') {
        throw new SessionContentError('grant_revoked', 'grant is not active');
      }
      const [duplicate] = await tx
        .select()
        .from(sessionContentAttempts)
        .where(
          and(
            eq(sessionContentAttempts.namespaceId, namespaceId),
            eq(sessionContentAttempts.idempotencyKey, idempotencyKey),
          ),
        )
        .limit(1);
      const payloadDigest = computePolicyDigest({ sessionId, channel, raw: bytes.raw, encoded: bytes.encoded });
      if (duplicate) {
        if (duplicate.payloadDigest !== payloadDigest) {
          await tx
            .update(sessionContentAttempts)
            .set({ outcome: 'conflicted' })
            .where(eq(sessionContentAttempts.attemptId, duplicate.attemptId));
          throw new SessionContentError('attempt_conflict', 'idempotency key reused with changed bytes');
        }
        return { reservationId: duplicate.attemptId, duplicate: true as const, outcome: duplicate.outcome };
      }
      const sessionCharged = await this.chargedBytes(tx, { sessionId });
      if (sessionCharged + bytes.encoded > this.quotas.maxBytesPerSession) {
        throw new SessionContentError('quota_exceeded', 'session quota is full; capture pauses');
      }
      const tenantCharged = await this.chargedBytes(tx, { tenantId: ctx.tenantId });
      if (tenantCharged + bytes.encoded > this.quotas.maxBytesPerTenant) {
        throw new SessionContentError('quota_exceeded', 'tenant quota is full; capture pauses');
      }
      const [sessionObjects] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(sessionContentObjects)
        .where(eq(sessionContentObjects.sessionId, sessionId));
      if ((sessionObjects?.count ?? 0) >= this.quotas.maxObjectsPerSession) {
        throw new SessionContentError('quota_exceeded', 'session object count is full');
      }
      const reservationId = this.newId();
      await tx.insert(sessionContentReservations).values({
        reservationId,
        namespaceId,
        sessionId,
        channel,
        bytesRaw: bytes.raw,
        bytesEncoded: bytes.encoded,
        state: 'reserved',
        attemptDigest: payloadDigest,
      });
      await tx.insert(sessionContentAttempts).values({
        attemptId: reservationId,
        namespaceId,
        sessionId,
        idempotencyKey,
        payloadDigest,
        outcome: 'attempted',
      });
      await tx
        .insert(sessionContentNamespaces)
        .values({ namespaceId, tenantId: ctx.tenantId, ownerId: ctx.ownerId, epoch: epoch.epoch, status: 'active' })
        .onConflictDoNothing();
      return { reservationId, duplicate: false as const, outcome: 'attempted' as const };
    });
  }

  /** Conditionally publish after upload: bytes land in the private bucket
   * with a capture-bound immutable deadline, then the reservation is
   * consumed. Stale completions become purge work. */
  async publishAfterUpload(
    reservationId: string,
    body: Uint8Array,
    ctx: SessionContentContext,
  ) {
    requireContext(ctx);
    const { client, config } = this.storage();
    const reservation = await db.transaction(async (tx) => {
      const [existing] = await tx
        .select()
        .from(sessionContentReservations)
        .where(eq(sessionContentReservations.reservationId, reservationId))
        .limit(1);
      if (!existing) throw new SessionContentError('not_found', 'unknown reservation');
      if (existing.state !== 'reserved') {
        throw new SessionContentError('unknown_outcome', 'reservation is not reserved');
      }
      const [grant] = await tx
        .select()
        .from(sessionContentGrants)
        .where(eq(sessionContentGrants.sessionId, existing.sessionId))
        .limit(1);
      if (!grant || grant.tenantId !== ctx.tenantId || grant.ownerId !== ctx.ownerId) {
        throw new SessionContentError('cross_owner_refused', 'reservation belongs elsewhere');
      }
      await this.checkMembership(tx, ctx.tenantId, ctx.principalId);
      if (grant.state !== 'active') {
        throw new SessionContentError('grant_revoked', 'grant is not active; late upload refused');
      }
      return { reservation: existing, grant };
    });
    const objectId = this.newId();
    const key = objectKeyFor(
      reservation.reservation.namespaceId,
      reservation.grant.bindingId,
      reservation.reservation.sessionId,
      reservation.reservation.channel,
      objectId,
    );
    await client.send(
      new PutObjectCommand({ Bucket: config.bucket, Key: key, Body: body }),
    );
    const snapshot = reservation.grant.retentionSnapshot as RetentionByChannel;
    const channel = reservation.reservation.channel as 'terminal.cache' | 'native.mirror';
    const capturedAt = this.nowMs();
    const retention = snapshot[channel] ?? { mode: 'none' as const };
    const expiresAt =
      retention.mode === 'none' ? null : capturedAt + retention.durationSeconds * 1000;
    await db.transaction(async (tx) => {
      await tx.insert(sessionContentObjects).values({
        objectId,
        namespaceId: reservation.reservation.namespaceId,
        bindingId: reservation.grant.bindingId,
        sessionId: reservation.reservation.sessionId,
        channel: reservation.reservation.channel,
        bucket: config.bucket,
        objectKey: key,
        bytesRaw: reservation.reservation.bytesRaw,
        bytesEncoded: reservation.reservation.bytesEncoded,
        capturedAt,
        expiresAt,
        state: 'committed',
        version: 1,
      });
      await tx
        .update(sessionContentReservations)
        .set({ state: 'consumed', updatedAt: new Date(this.nowMs()) })
        .where(eq(sessionContentReservations.reservationId, reservationId));
      await tx
        .update(sessionContentAttempts)
        .set({ outcome: 'published' })
        .where(eq(sessionContentAttempts.attemptId, reservationId));
      await tx
        .update(sessionContentGrants)
        .set({ retainedCopies: true, updatedAt: new Date(this.nowMs()) })
        .where(eq(sessionContentGrants.sessionId, reservation.reservation.sessionId));
    });
    return { objectId, key, expiresAt };
  }

  /** An unknown PutObject outcome keeps purge pending and quota charged,
   * even if a preliminary HEAD reports no object. */
  async markAttemptUnknown(reservationId: string, ctx: SessionContentContext) {
    requireContext(ctx);
    return db.transaction(async (tx) => {
      const [existing] = await tx
        .select()
        .from(sessionContentReservations)
        .where(eq(sessionContentReservations.reservationId, reservationId))
        .limit(1);
      if (!existing) throw new SessionContentError('not_found', 'unknown reservation');
      await tx
        .update(sessionContentReservations)
        .set({ state: 'stale', updatedAt: new Date(this.nowMs()) })
        .where(eq(sessionContentReservations.reservationId, reservationId));
      await tx
        .update(sessionContentAttempts)
        .set({ outcome: 'outcome_unknown' })
        .where(eq(sessionContentAttempts.attemptId, reservationId));
      return { reservationId, outcome: 'outcome_unknown' as const };
    });
  }

  /** Owner-only read: active grants read live committed copies; closed
   * sessions require a distinct history authorization. Reads never extend
   * a configured deadline; expired finite copies deny with zero bytes. */
  async readCommitted(
    sessionId: string,
    channel: 'terminal.cache' | 'native.mirror',
    ctx: SessionContentContext,
    historyAuthorizationId?: string,
  ): Promise<Uint8Array> {
    requireContext(ctx);
    const { client } = this.storage();
    const target = await db.transaction(async (tx) => {
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
      if (grant.state === 'active') {
        // Live read; no history authorization needed.
      } else if (grant.state === 'closed') {
        if (!historyAuthorizationId) {
          throw new SessionContentError(
            'history_authorization_required',
            'closed copies need a distinct history authorization',
          );
        }
        const [authorization] = await tx
          .select()
          .from(sessionContentHistoryAuthorizations)
          .where(
            eq(sessionContentHistoryAuthorizations.authorizationId, historyAuthorizationId),
          )
          .limit(1);
        if (!authorization || authorization.state !== 'active' || authorization.sessionId !== sessionId) {
          throw new SessionContentError('history_authorization_revoked', 'history grant is not active');
        }
      } else {
        throw new SessionContentError('grant_revoked', 'grant is not readable');
      }
      const objects = await tx
        .select()
        .from(sessionContentObjects)
        .where(
          and(
            eq(sessionContentObjects.sessionId, sessionId),
            eq(sessionContentObjects.channel, channel),
            eq(sessionContentObjects.state, 'committed'),
          ),
        );
      if (objects.length === 0) throw new SessionContentError('not_found', 'no committed copy');
      const now = this.nowMs();
      const live = objects.filter((o) => o.expiresAt === null || o.expiresAt === undefined || now < o.expiresAt);
      if (live.length === 0) throw new SessionContentError('object_expired', 'copies past deadline');
      live.sort((a, b) => b.capturedAt - a.capturedAt);
      return live[0]!;
    });
    const response = await client.send(
      new GetObjectCommand({ Bucket: target.bucket, Key: target.objectKey }),
    );
    return response.Body?.transformToByteArray() ?? new Uint8Array(0);
  }

  /** Scoped paginated inventory over committed metadata. Cross-prefix
   * access is rejected; payload bytes never appear here. */
  async listObjects(
    namespaceId: string,
    cursor: string | null,
    limit: number,
    ctx: SessionContentContext,
  ): Promise<PaginatedObjectInventory> {
    requireContext(ctx);
    if (!namespaceId.startsWith(`scc:${ctx.tenantId}:${ctx.ownerId}:`)) {
      throw new SessionContentError('cross_prefix_refused', 'namespace is outside the caller scope');
    }
    const page = Math.min(Math.max(limit, 1), 100);
    const rows = await db
      .select()
      .from(sessionContentObjects)
      .where(
        and(
          eq(sessionContentObjects.namespaceId, namespaceId),
          eq(sessionContentObjects.state, 'committed'),
          cursor ? gt(sessionContentObjects.objectId, cursor) : sql`TRUE`,
        ),
      )
      .orderBy(sessionContentObjects.objectId)
      .limit(page + 1);
    const slice = rows.slice(0, page);
    return {
      objects: slice.map((o) => ({
        objectId: o.objectId,
        sessionId: o.sessionId,
        channel: o.channel,
        bytesRaw: o.bytesRaw,
        bytesEncoded: o.bytesEncoded,
        expiresAt: o.expiresAt,
        state: o.state,
      })),
      nextCursor: rows.length > page ? slice[ slice.length - 1 ]!.objectId : null,
    };
  }

  /** Exact stored-byte accounting: closed copies, staging and pending
   * deletion stay charged. Quotas pause new capture; nothing is evicted. */
  async accountUsage(scope: { tenantId?: string; sessionId?: string }): Promise<SessionContentUsage> {
    let tenantNamespaces: string[] | null = null;
    if (scope.tenantId && !scope.sessionId) {
      const rows = await db
        .select({ namespaceId: sessionContentNamespaces.namespaceId })
        .from(sessionContentNamespaces)
        .where(eq(sessionContentNamespaces.tenantId, scope.tenantId));
      tenantNamespaces = rows.map((r) => r.namespaceId);
    }
    const inTenantScope =
      tenantNamespaces === null
        ? sql`TRUE`
        : tenantNamespaces.length === 0
          ? sql`FALSE`
          : inArray(sessionContentObjects.namespaceId, tenantNamespaces);
    const committed = await db
      .select({ bytes: sql<number>`coalesce(sum(bytes_encoded), 0)::int`, count: sql<number>`count(*)::int` })
      .from(sessionContentObjects)
      .where(
        and(
          eq(sessionContentObjects.state, 'committed'),
          inTenantScope,
          scope.sessionId ? eq(sessionContentObjects.sessionId, scope.sessionId) : sql`TRUE`,
        ),
      );
    const staged = await db
      .select({ bytes: sql<number>`coalesce(sum(bytes_encoded), 0)::int` })
      .from(sessionContentObjects)
      .where(
        and(
          inArray(sessionContentObjects.state, ['staged']),
          inTenantScope,
          scope.sessionId ? eq(sessionContentObjects.sessionId, scope.sessionId) : sql`TRUE`,
        ),
      );
    const reservedInScope =
      tenantNamespaces === null
        ? sql`TRUE`
        : tenantNamespaces.length === 0
          ? sql`FALSE`
          : inArray(sessionContentReservations.namespaceId, tenantNamespaces);
    const reserved = await db
      .select({ bytes: sql<number>`coalesce(sum(bytes_encoded), 0)::int` })
      .from(sessionContentReservations)
      .where(
        and(
          inArray(sessionContentReservations.state, ['reserved', 'stale']),
          reservedInScope,
          scope.sessionId ? eq(sessionContentReservations.sessionId, scope.sessionId) : sql`TRUE`,
        ),
      );
    const pending = await db
      .select({ bytes: sql<number>`coalesce(sum(bytes_encoded), 0)::int` })
      .from(sessionContentObjects)
      .where(
        and(
          eq(sessionContentObjects.state, 'purge_pending'),
          inTenantScope,
          scope.sessionId ? eq(sessionContentObjects.sessionId, scope.sessionId) : sql`TRUE`,
        ),
      );
    const closed = await db
      .select({ bytes: sql<number>`coalesce(sum(bytes_encoded), 0)::int` })
      .from(sessionContentObjects)
      .innerJoin(
        sessionContentGrants,
        eq(sessionContentObjects.sessionId, sessionContentGrants.sessionId),
      )
      .where(
        and(
          eq(sessionContentObjects.state, 'committed'),
          eq(sessionContentGrants.state, 'closed'),
          scope.sessionId ? eq(sessionContentObjects.sessionId, scope.sessionId) : sql`TRUE`,
        ),
      );
    return {
      committedBytes: committed[0]?.bytes ?? 0,
      stagedBytes: staged[0]?.bytes ?? 0,
      reservedBytes: reserved[0]?.bytes ?? 0,
      pendingDeletionBytes: pending[0]?.bytes ?? 0,
      closedBytes: closed[0]?.bytes ?? 0,
      objectCount: committed[0]?.count ?? 0,
    };
  }

  /** Writer-settled physical purge: revoke first, settle or definitively
   * cancel every tracked writer, delete objects, then verify the final
   * inventory and record evidence. */
  async runPurge(purgeJobId: string) {
    const { client, config } = this.storage();
    const job = await db.transaction(async (tx) => {
      const [existing] = await tx
        .select()
        .from(sessionContentPurgeJobs)
        .where(eq(sessionContentPurgeJobs.purgeJobId, purgeJobId))
        .limit(1);
      if (!existing) throw new SessionContentError('not_found', 'unknown purge job');
      if (existing.state === 'complete') return existing;
      await tx
        .update(sessionContentPurgeJobs)
        .set({ state: 'in_progress', updatedAt: new Date(this.nowMs()) })
        .where(eq(sessionContentPurgeJobs.purgeJobId, purgeJobId));
      return { ...existing, state: 'in_progress' as const };
    });
    const objects = await db
      .select()
      .from(sessionContentObjects)
      .where(
        and(
          eq(sessionContentObjects.namespaceId, job.namespaceId),
          inArray(sessionContentObjects.state, ['committed', 'staged', 'purge_pending']),
        ),
      );
    const inScope = job.bindingId
      ? objects.filter((o) => o.bindingId === job.bindingId)
      : objects;
    let deletedBytes = 0;
    const deletedKeys: string[] = [];
    for (const object of inScope) {
      await client.send(
        new DeleteObjectCommand({ Bucket: object.bucket, Key: object.objectKey }),
      );
      deletedBytes += object.bytesEncoded;
      deletedKeys.push(object.objectKey);
    }
    const evidence = await db.transaction(async (tx) => {
      for (const object of inScope) {
        await tx
          .update(sessionContentObjects)
          .set({ state: 'purged', updatedAt: new Date(this.nowMs()) })
          .where(eq(sessionContentObjects.objectId, object.objectId));
      }
      await tx
        .update(sessionContentAttempts)
        .set({ outcome: 'cancelled' })
        .where(
          and(
            eq(sessionContentAttempts.namespaceId, job.namespaceId),
            eq(sessionContentAttempts.outcome, 'attempted'),
          ),
        );
      const [remaining] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(sessionContentObjects)
        .where(
          and(
            eq(sessionContentObjects.namespaceId, job.namespaceId),
            inArray(sessionContentObjects.state, ['committed', 'staged', 'purge_pending']),
            job.bindingId ? eq(sessionContentObjects.bindingId, job.bindingId) : sql`TRUE`,
          ),
        );
      const record = {
        deletedObjects: inScope.length,
        deletedBytes,
        deletedKeys,
        remainingObjects: remaining?.count ?? 0,
        verifiedAt: this.nowMs(),
      };
      await tx
        .update(sessionContentPurgeJobs)
        .set({
          state: 'complete',
          evidence: record,
          completedAt: new Date(this.nowMs()),
          updatedAt: new Date(this.nowMs()),
        })
        .where(eq(sessionContentPurgeJobs.purgeJobId, purgeJobId));
      if ((remaining?.count ?? 0) === 0 && job.scope === 'namespace') {
        await tx
          .update(sessionContentNamespaces)
          .set({ status: 'purged', updatedAt: new Date(this.nowMs()) })
          .where(eq(sessionContentNamespaces.namespaceId, job.namespaceId));
      }
      return record;
    });
    void config;
    return { purgeJobId, ...evidence };
  }

  /** D1 detach/end hook: atomic live close with retained-closed
   * transition. Committed copies stay under immutable origin scope;
   * uncommitted uploads settle or are discarded. Never enqueues
   * committed-copy purge merely on end/detach. */
  async fenceSessionOnDetachEnd(sessionId: string, tenantId: string) {
    const settled = await db.transaction(async (tx) => {
      const [grant] = await tx
        .select()
        .from(sessionContentGrants)
        .where(eq(sessionContentGrants.sessionId, sessionId))
        .limit(1);
      if (!grant || grant.tenantId !== tenantId || grant.state !== 'active') return null;
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
      const staged = await tx
        .select()
        .from(sessionContentObjects)
        .where(
          and(
            eq(sessionContentObjects.sessionId, sessionId),
            eq(sessionContentObjects.state, 'staged'),
          ),
        );
      for (const object of staged) {
        await tx
          .update(sessionContentObjects)
          .set({ state: 'purge_pending', updatedAt: new Date(this.nowMs()) })
          .where(eq(sessionContentObjects.objectId, object.objectId));
      }
      await tx
        .update(sessionContentReservations)
        .set({ state: 'cancelled', updatedAt: new Date(this.nowMs()) })
        .where(
          and(
            eq(sessionContentReservations.sessionId, sessionId),
            eq(sessionContentReservations.state, 'reserved'),
          ),
        );
      return { staged: staged.map((o) => ({ bucket: o.bucket, key: o.objectKey })) };
    });
    if (settled && settled.staged.length > 0) {
      try {
        const { client } = this.storage();
        for (const { bucket, key } of settled.staged) {
          await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
        }
      } catch (err) {
        if (!(err instanceof SessionContentError && err.code === 'storage_unavailable')) throw err;
      }
    }
    return { sessionId, fenced: settled !== null };
  }

  /** Durable human admission record. Admission alone never grants
   * content reads, capture or control; the Lot 3a finalizer writes here. */
  async recordAdmission(input: {
    authSessionId: string;
    tokenHash: string;
    credentialId: string;
    origin: string;
    userVerified: boolean;
  }) {
    if (!input.authSessionId.trim() || !input.tokenHash.trim() || !input.credentialId.trim()) {
      throw new SessionContentError('invalid_request', 'admission identity is required');
    }
    if (input.userVerified !== true) {
      throw new SessionContentError('invalid_request', 'admission requires user verification');
    }
    const admissionId = this.newId();
    await db.insert(sessionContentAdmissions).values({
      admissionId,
      authSessionId: input.authSessionId,
      tokenHash: input.tokenHash,
      credentialId: input.credentialId,
      origin: input.origin,
      userVerified: true,
    });
    return { admissionId };
  }

  async checkAdmission(authSessionId: string, credentialId: string): Promise<boolean> {
    const [row] = await db
      .select({ admissionId: sessionContentAdmissions.admissionId })
      .from(sessionContentAdmissions)
      .where(
        and(
          eq(sessionContentAdmissions.authSessionId, authSessionId),
          eq(sessionContentAdmissions.credentialId, credentialId),
        ),
      )
      .limit(1);
    return Boolean(row);
  }

  /** Local-only deny learned while disconnected: source export stops
   * locally; server copies fence on reconnect. May stay unknown
   * indefinitely under no expiry (O2=B). */
  async recordLocalDeny(sessionId: string, ctx: SessionContentContext) {
    requireContext(ctx);
    await db
      .update(sessionContentGrants)
      .set({ localDenyPending: true, updatedAt: new Date(this.nowMs()) })
      .where(eq(sessionContentGrants.sessionId, sessionId));
    return { sessionId, localDenyPending: true as const };
  }

  async reconcileLocalDeny(sessionId: string, ctx: SessionContentContext) {
    requireContext(ctx);
    return db.transaction(async (tx) => {
      const [grant] = await tx
        .select()
        .from(sessionContentGrants)
        .where(eq(sessionContentGrants.sessionId, sessionId))
        .limit(1);
      if (!grant) throw new SessionContentError('grant_not_found', 'unknown grant');
      if (grant.tenantId !== ctx.tenantId || grant.ownerId !== ctx.ownerId) {
        throw new SessionContentError('cross_owner_refused', 'grant belongs to another owner');
      }
      if (!grant.localDenyPending) return { sessionId, reconciled: false as const };
      await tx
        .update(sessionContentGrants)
        .set({ state: 'revoked', localDenyPending: false, updatedAt: new Date(this.nowMs()) })
        .where(eq(sessionContentGrants.sessionId, sessionId));
      return { sessionId, reconciled: true as const };
    });
  }

  /** Membership-free denial-only retained handles: the still-active origin
   * owner lists opaque handles/status without membership or source contact.
   * No handle grants reading or control. */
  async listRetainedHandles(ownerId: string, tenantId: string) {
    const namespaces = await db
      .select()
      .from(sessionContentNamespaces)
      .where(
        and(
          eq(sessionContentNamespaces.ownerId, ownerId),
          eq(sessionContentNamespaces.tenantId, tenantId),
        ),
      );
    const handles: Array<{
      retainedScopeId: string;
      bindingId: string;
      status: string;
      bytes: number;
    }> = [];
    for (const namespace of namespaces) {
      const objects = await db
        .select()
        .from(sessionContentObjects)
        .where(
          and(
            eq(sessionContentObjects.namespaceId, namespace.namespaceId),
            inArray(sessionContentObjects.state, ['committed', 'purge_pending']),
          ),
        );
      const byBinding = new Map<string, number>();
      for (const object of objects) {
        byBinding.set(object.bindingId, (byBinding.get(object.bindingId) ?? 0) + object.bytesEncoded);
      }
      for (const [bindingId, bytes] of byBinding) {
        handles.push({
          retainedScopeId: `retained:${namespace.namespaceId}:${bindingId}`,
          bindingId,
          status: namespace.status,
          bytes,
        });
      }
    }
    return handles;
  }

  /** Denial-only purge request over an opaque retained scope: writer-settled
   * physical deletion with no read/grant/control elevation. */
  async requestRetainedPurge(retainedScopeId: string, ownerId: string) {
    const match = /^retained:(.+):([^:]+)$/.exec(retainedScopeId);
    if (!match) throw new SessionContentError('invalid_request', 'malformed retained scope');
    const [, namespaceId, bindingId] = match;
    const [namespace] = await db
      .select()
      .from(sessionContentNamespaces)
      .where(eq(sessionContentNamespaces.namespaceId, namespaceId as string))
      .limit(1);
    if (!namespace || namespace.ownerId !== ownerId) {
      throw new SessionContentError('cross_owner_refused', 'retained scope belongs elsewhere');
    }
    const purgeJobId = this.newId();
    await db.transaction(async (tx) => {
      await tx
        .update(sessionContentObjects)
        .set({ state: 'purge_pending', updatedAt: new Date(this.nowMs()) })
        .where(
          and(
            eq(sessionContentObjects.namespaceId, namespaceId as string),
            eq(sessionContentObjects.bindingId, bindingId as string),
            eq(sessionContentObjects.state, 'committed'),
          ),
        );
      await tx.insert(sessionContentPurgeJobs).values({
        purgeJobId,
        namespaceId: namespaceId as string,
        bindingId: bindingId as string,
        scope: 'binding',
        state: 'pending',
      });
    });
    return this.runPurge(purgeJobId);
  }

  /** Storage-recovery fencing (CM2-F3 boundary): disable ingress for the
   * old epoch, fence writers and expire source leases before restore. Old
   * object namespaces stay purge-only; reactivation needs fresh
   * human/source consent. The epoch record itself is operations-managed. */
  async fenceForRestore(namespaceId: string) {
    return db.transaction(async (tx) => {
      await tx
        .update(sessionContentNamespaces)
        .set({ status: 'purge_pending', updatedAt: new Date(this.nowMs()) })
        .where(eq(sessionContentNamespaces.namespaceId, namespaceId));
      const scoped = await tx
        .selectDistinct({ sessionId: sessionContentObjects.sessionId })
        .from(sessionContentObjects)
        .where(eq(sessionContentObjects.namespaceId, namespaceId));
      for (const { sessionId } of scoped) {
        await tx
          .update(sessionContentGrants)
          .set({ state: 'revoked', updatedAt: new Date(this.nowMs()) })
          .where(eq(sessionContentGrants.sessionId, sessionId));
      }
      await tx.insert(sessionContentPurgeJobs).values({
        purgeJobId: this.newId(),
        namespaceId,
        scope: 'namespace',
        state: 'pending',
      });
      await tx
        .update(sessionContentAttempts)
        .set({ outcome: 'cancelled' })
        .where(
          and(
            eq(sessionContentAttempts.namespaceId, namespaceId),
            eq(sessionContentAttempts.outcome, 'attempted'),
          ),
        );
      return { namespaceId, status: 'purge_pending' as const };
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
