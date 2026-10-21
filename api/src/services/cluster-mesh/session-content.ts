import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { and, eq, gt, inArray, notExists, or, sql } from 'drizzle-orm';
import {
  computePolicyDigest,
  ContentConsentError,
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
  sessionContentProjects,
  sessionContentPurgeJobs,
  sessionContentReservations,
  sessionContentTombstones,
  sessionWorkspaceBindings,
} from '../../db/control-schema';
import { tenantMemberships, tenants, workspaces, workspaceMemberships } from '../../db/schema';

/** Default product authority issuer for D2 and the D1 content hook. */
export const DEFAULT_SESSION_CONTENT_ISSUER = 'sentropic-product';

/** Resolve an explicit content issuer before environment and product defaults. */
export const resolveSessionContentIssuer = (explicit?: string): string => {
  const fromArg = explicit?.trim();
  if (fromArg) return fromArg;
  const fromEnv = process.env.SESSION_CONTENT_AUTHORITY_ISSUER?.trim();
  if (fromEnv) return fromEnv;
  return DEFAULT_SESSION_CONTENT_ISSUER;
};

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
  | 'project_revision_changed'
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
  | 'epoch_mismatch'
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
  issuer: string,
): ContentAuthorityEpochPort => {
  if (!issuer || !issuer.trim()) {
    throw new SessionContentError('invalid_request', 'authority issuer is explicit configuration');
  }
  return {
    async readCurrent(requestIssuer: string): Promise<ContentAuthorityEpoch> {
      if (requestIssuer !== issuer) {
        throw new SessionContentError('epoch_unavailable', 'content authority issuer mismatch');
      }
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
        revision: Number(record['revision']),
        enabled: record['enabled'] === true,
        validUntil: Number(record['validUntil']),
      };
      if (!epoch.epoch) {
        throw new SessionContentError('epoch_unavailable', 'content authority epoch is missing');
      }
      if (!Number.isSafeInteger(epoch.revision) || epoch.revision < 0) {
        throw new SessionContentError('epoch_unavailable', 'content authority revision is invalid');
      }
      if (!Number.isFinite(epoch.validUntil)) {
        throw new SessionContentError('epoch_unavailable', 'content authority validity is invalid');
      }
      if (!epoch.enabled) {
        throw new SessionContentError('epoch_disabled', 'content authority is disabled');
      }
      if (nowMs() > epoch.validUntil) {
        throw new SessionContentError('epoch_stale', 'content authority epoch expired');
      }
      return epoch;
    },
  };
};

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
  if (ctx.principalId !== ctx.ownerId) {
    throw new SessionContentError('cross_owner_refused', 'authenticated principal must be the owner');
  }
};

export interface SessionContentPublishHooks {
  readonly afterUpload?: (key: string) => Promise<void>;
  /** Test-only PUT failure injection (N5). Never set in production. */
  readonly beforePut?: (key: string) => Promise<void>;
}

export interface SessionContentOptions {
  readonly nowMs?: () => number;
  readonly newId?: () => string;
  readonly quotas?: Partial<SessionContentQuotas>;
  readonly storage?: Partial<SessionContentStorageConfig>;
  readonly storageClient?: S3Client;
  readonly epochs?: ContentAuthorityEpochPort;
  /** Explicit authority issuer configuration (R10): no hidden default. */
  readonly issuer: string;
  /** Test-only barrier between PUT and commit (design §11). Never set in
   * production composition. */
  readonly publishHooks?: SessionContentPublishHooks;
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

export type AcceptSessionProjectInput = PreparedSessionProject;

export interface DeriveSessionGrantInput {
  readonly projectId: string;
  readonly sessionId: string;
  readonly bindingId: string;
  readonly bindingVersion: number;
  readonly d1Version: number;
  readonly d1Incarnation: number;
  readonly d1StartSeq: number;
  readonly workspaceId: string;
  /** Caller claim, ignored for eligibility: the server derives creation
   * time from the D1 binding row (n4). Kept for envelope compatibility
   * until the Lot 3a routes bind the authenticated source timestamp. */
  readonly sessionCreatedAt: number;
  readonly sourceGeneration: string;
  readonly sourceTrustVersion: string;
  readonly nativeStartSeq: number;
}

/** N3 child refresh acknowledgment: the source verifies the accepted
 * parent policy/digest and local denials, fences its old exporter and
 * acknowledges the exact N+1 scope with a new authenticated boundary. */
export interface AcknowledgeGrantRefreshInput {
  readonly projectRevision: number;
  readonly bindingVersion: number;
  readonly nativeBoundarySeq: number;
  /** P3: the source generation the caller attests — must equal the grant's,
   * never overwrites it. A replaced source needs a new derivation. */
  readonly sourceGeneration: string;
  /** P3: the D1 version the caller attests — must equal the grant's frozen
   * D1 version. A changed D1 version needs a new derivation. */
  readonly d1Version: number;
  /** m1: the accepted policy digest the caller acknowledges — must equal
   * the parent's current digest, binding the exact N+1 scope. */
  readonly policyDigest: string;
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

type DbClient = Pick<typeof db, 'select' | 'insert' | 'update' | 'delete' | 'execute'>;

export class SessionContentService {
  private readonly nowMs: () => number;
  private readonly newId: () => string;
  private readonly quotas: SessionContentQuotas;
  private readonly explicitStorage?: Partial<SessionContentStorageConfig>;
  private readonly epochs: ContentAuthorityEpochPort;
  private readonly issuer: string;
  private readonly publishHooks?: SessionContentPublishHooks;
  private s3: S3Client | null = null;
  private storageConfig: SessionContentStorageConfig | null = null;

  constructor(options: SessionContentOptions) {
    if (!options.issuer || !options.issuer.trim()) {
      throw new SessionContentError('invalid_request', 'authority issuer is explicit configuration');
    }
    this.nowMs = options.nowMs ?? (() => Date.now());
    this.newId = options.newId ?? (() => crypto.randomUUID());
    this.quotas = { ...DEFAULT_SESSION_CONTENT_QUOTAS, ...options.quotas };
    this.explicitStorage = options.storage;
    this.s3 = options.storageClient ?? null;
    this.epochs = options.epochs ?? createFileContentAuthorityEpochPort(
      readEnv('SESSION_CONTENT_AUTHORITY_RECORD_PATH') ?? '',
      () => Date.now(),
      options.issuer,
    );
    this.issuer = options.issuer;
    this.publishHooks = options.publishHooks;
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
      this.s3 ??= createSessionContentS3Client(config);
    }
    return { client: this.s3, config: this.storageConfig };
  }

  private async checkEpoch(): Promise<ContentAuthorityEpoch> {
    return this.epochs.readCurrent(this.issuer);
  }

  /** M1: every reserve, publish and read segment requires current epoch =
   * pinned epoch with an active namespace. Unavailable or stale authority
   * denies; old-epoch rows are purge-only and never aliased to new grants. */
  private async requireEpochScope(
    client: DbClient,
    pinnedEpoch: string,
    namespaceId: string,
  ): Promise<ContentAuthorityEpoch> {
    const current = await this.checkEpoch();
    if (pinnedEpoch !== current.epoch) {
      throw new SessionContentError('epoch_mismatch', 'pinned epoch does not match the current authority epoch');
    }
    const [namespace] = await client
      .select({ status: sessionContentNamespaces.status })
      .from(sessionContentNamespaces)
      .where(eq(sessionContentNamespaces.namespaceId, namespaceId))
      .limit(1);
    if (!namespace || namespace.status !== 'active') {
      throw new SessionContentError('epoch_mismatch', 'object namespace is not active');
    }
    return current;
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
      .for('share')
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
      .for('share')
      .limit(1);
    if (membership?.status !== 'approved') {
      throw new SessionContentError('membership_required', 'principal is not an approved member');
    }
  }

  private async ownedGrant(client: DbClient, sessionId: string, ctx: SessionContentContext) {
    const [grant] = await client.select().from(sessionContentGrants)
      .where(eq(sessionContentGrants.sessionId, sessionId)).limit(1);
    if (!grant) throw new SessionContentError('grant_not_found', 'unknown grant');
    if (grant.tenantId !== ctx.tenantId || grant.ownerId !== ctx.ownerId) {
      throw new SessionContentError('cross_owner_refused', 'grant belongs to another owner');
    }
    return grant;
  }

  private async requireRetainedRead(client: DbClient, grant: typeof sessionContentGrants.$inferSelect) {
    const [project] = await client.select().from(sessionContentProjects)
      .where(eq(sessionContentProjects.projectId, grant.projectId)).limit(1);
    if (grant.readDenied || !['active', 'closed', 'excluded'].includes(grant.state)
      || !project || project.readDenied || project.state === 'revoked') {
      throw new SessionContentError('grant_revoked', 'retained reading is denied');
    }
  }

  /** R6: bounded reads additionally require origin-workspace membership.
   * Provisioning creates the membership row (see workspace-provisioning),
   * so the row — not bare ownership — is the authority. */
  private async checkWorkspaceMembership(
    client: DbClient,
    workspaceId: string,
    principalId: string,
  ): Promise<void> {
    const [membership] = await client
      .select({ workspaceId: workspaceMemberships.workspaceId })
      .from(workspaceMemberships)
      .where(
        and(
          eq(workspaceMemberships.workspaceId, workspaceId),
          eq(workspaceMemberships.userId, principalId),
        ),
      )
      .for('share')
      .limit(1);
    if (!membership) {
      throw new SessionContentError('membership_required', 'principal is not an origin-workspace member');
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
   * and altered digests with zero authorization. Domain validation faults
   * surface as SessionContentError so routes see one error contract. */
  prepareProject(policy: Record<string, unknown>): PreparedSessionProject {
    try {
      validateRetentionByChannel(
        (policy as Record<string, unknown>)['retentionByChannel'],
      );
    } catch (err) {
      if (err instanceof ContentConsentError) {
        throw new SessionContentError(
          err.code as SessionContentErrorCode,
          err.message,
        );
      }
      throw err;
    }
    const digest = computePolicyDigest(policy);
    const revisionRaw = (policy as Record<string, unknown>)['projectRevision'];
    const expectedRevision =
      typeof revisionRaw === 'number' && Number.isSafeInteger(revisionRaw) && revisionRaw >= 0
        ? revisionRaw
        : null;
    return { policy, digest, expectedRevision };
  }

  /** Atomically persist the accepted project and
   * its namespace. Public-row locks precede first allocation so delete
   * cannot race new D2 state. */
  async acceptProject(input: AcceptSessionProjectInput, ctx: SessionContentContext) {
    requireContext(ctx);
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
      const expectedRevision: number | undefined =
        input.expectedRevision === null ? undefined : input.expectedRevision;
      if (expectedRevision === undefined && existing) {
        throw new SessionContentError('revision_conflict', 'project already exists');
      }
      // N2: accept-at-N preserves persistent exclusions and the original
      // activation; a fresh accept declaring revision 0 inserts it.
      let acceptLocked: typeof existing | undefined;
      if (expectedRevision !== undefined) {
        const [locked] = await tx
          .select()
          .from(sessionContentProjects)
          .where(eq(sessionContentProjects.projectId, String(policy['projectId'])))
          .for('update')
          .limit(1);
        if (locked) {
          if (locked.tenantId !== ctx.tenantId || locked.ownerId !== ctx.ownerId
            || locked.workspaceId !== policy.workspaceId
            || locked.workspaceIncarnation !== Number(policy['workspaceIncarnation'] ?? 1)) {
            throw new SessionContentError('cross_owner_refused', 'existing project has a different immutable scope');
          }
          if (locked.state !== 'active' || locked.readDenied) {
            throw new SessionContentError('project_not_active', 'project is not active');
          }
          if (locked.projectRevision !== expectedRevision) {
            throw new SessionContentError('revision_conflict', 'project revision mismatch');
          }
          acceptLocked = locked;
        } else if (expectedRevision !== 0) {
          throw new SessionContentError('revision_conflict', 'project revision mismatch');
        }
      }
      const now = new Date(this.nowMs());
      const revision = acceptLocked ? (expectedRevision as number) + 1 : 0;
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
        // Historical column retained; N5 requires no additional risk receipt.
        offlineReadAccepted: false,
        exclusionRevision: acceptLocked ? acceptLocked.exclusionRevision : 0,
        excludedSessionIds: acceptLocked
          ? [...(acceptLocked.excludedSessionIds as string[])]
          : [],
        requiresFreshAmendment: false,
        activatedAt: acceptLocked?.activatedAt ?? now,
        updatedAt: now,
      };
      if (existing) {
        if (expectedRevision === undefined || !acceptLocked) {
          throw new SessionContentError('revision_conflict', 'project already exists');
        }
        const updated = await tx
          .update(sessionContentProjects)
          .set({ ...row, createdAt: existing.createdAt })
          .where(
            and(
              eq(sessionContentProjects.projectId, row.projectId),
              eq(sessionContentProjects.projectRevision, expectedRevision),
              eq(sessionContentProjects.tenantId, ctx.tenantId),
              eq(sessionContentProjects.ownerId, ctx.ownerId),
              eq(sessionContentProjects.workspaceId, row.workspaceId),
              eq(sessionContentProjects.workspaceIncarnation, row.workspaceIncarnation),
            ),
          )
          .returning({ projectId: sessionContentProjects.projectId });
        if (updated.length !== 1) {
          throw new SessionContentError('revision_conflict', 'concurrent accept; re-prepare the scope');
        }
      } else {
        const inserted = await tx
          .insert(sessionContentProjects)
          .values(row)
          .onConflictDoNothing()
          .returning({ projectId: sessionContentProjects.projectId });
        if (inserted.length === 0) {
          throw new SessionContentError('revision_conflict', 'project already exists');
        }
      }
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
    if (computePolicyDigest(policy) !== prepared.digest) {
      throw new SessionContentError('policy_digest_mismatch', 'prepared policy was altered');
    }
    const readers = (policy as Record<string, unknown>)['readers'];
    if (!Array.isArray(readers) || readers.length !== 1 || readers[0] !== ctx.ownerId) {
      throw new SessionContentError('cross_owner_refused', 'project readers are owner-only');
    }
    if ((policy as Record<string, unknown>)['tenantId'] !== ctx.tenantId
      || (policy as Record<string, unknown>)['ownerId'] !== ctx.ownerId) {
      throw new SessionContentError('cross_owner_refused', 'policy scope must match the caller');
    }
    await this.checkEpoch();
    return db.transaction(async (tx) => {
      await this.checkMembership(tx, ctx.tenantId, ctx.principalId);
      await this.checkTombstones(tx, [
        { kind: 'tenant', id: ctx.tenantId },
        { kind: 'user', id: ctx.ownerId },
      ]);
      const [locked] = await tx
        .select()
        .from(sessionContentProjects)
        .where(eq(sessionContentProjects.projectId, projectId))
        .for('update')
        .limit(1);
      if (!locked) throw new SessionContentError('project_not_found', 'unknown project');
      if (locked.tenantId !== ctx.tenantId || locked.ownerId !== ctx.ownerId) {
        throw new SessionContentError('cross_owner_refused', 'project belongs to another owner');
      }
      if (locked.state !== 'active') {
        throw new SessionContentError('project_not_active', 'project is not active');
      }
      // n3: the amendment policy must target this project row and workspace.
      if (policy['projectId'] !== projectId) {
        throw new SessionContentError('invalid_request', 'amendment targets another project');
      }
      if (policy['workspaceId'] !== locked.workspaceId) {
        throw new SessionContentError('invalid_request', 'amendment targets another workspace');
      }
      await this.checkTombstones(tx, [{ kind: 'workspace', id: locked.workspaceId }]);
      // N2: honor the caller's expected revision and preserve persistent
      // exclusions, their revision and the original activation.
      if (prepared.expectedRevision === null || prepared.expectedRevision !== locked.projectRevision) {
        throw new SessionContentError('revision_conflict', 'project revision mismatch; re-prepare the amendment');
      }
      const nextRevision = locked.projectRevision + 1;
      const updated = await tx
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
          requiresFreshAmendment: false,
          updatedAt: new Date(this.nowMs()),
        })
        .where(
          and(
            eq(sessionContentProjects.projectId, projectId),
            eq(sessionContentProjects.projectRevision, locked.projectRevision),
          ),
        )
        .returning({ projectId: sessionContentProjects.projectId });
      if (updated.length !== 1) {
        throw new SessionContentError('revision_conflict', 'concurrent amendment; re-prepare the amendment');
      }
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
        .set({ state: 'revoked', readDenied: true, updatedAt: new Date(this.nowMs()) })
        .where(eq(sessionContentProjects.projectId, projectId));
      await tx
        .update(sessionContentGrants)
        .set({ state: 'revoked', readDenied: true, updatedAt: new Date(this.nowMs()) })
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
      const grant = await this.ownedGrant(tx, sessionId, ctx);
      if (grant.projectId !== projectId || grant.workspaceId !== existing.workspaceId) {
        throw new SessionContentError('cross_owner_refused', 'session belongs to another project scope');
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
        .set({ state: sql`CASE WHEN ${sessionContentGrants.state} IN ('revoked', 'expired')
          OR ${sessionContentGrants.readDenied} THEN ${sessionContentGrants.state} ELSE 'excluded' END`,
        updatedAt: new Date(this.nowMs()) })
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
      if (input.workspaceId !== project.workspaceId || binding.workspaceId !== project.workspaceId) {
        throw new SessionContentError('invalid_request', 'session workspace does not match project');
      }
      if (binding.status !== 'attached') {
        throw new SessionContentError('ineligible_session', 'binding is not attached');
      }
      if (binding.principalId !== ctx.ownerId) {
        throw new SessionContentError('cross_owner_refused', 'binding principal is not the project owner');
      }
      if (!Number.isSafeInteger(input.d1Incarnation) || input.d1Incarnation < 0
        || !Number.isSafeInteger(input.d1StartSeq) || input.d1StartSeq < 0) {
        throw new SessionContentError('invalid_request', 'D1 incarnation/start must be safe integers');
      }
      const accepted = project.acceptedPolicy as Record<string, unknown> & {
        futureSessions?: boolean;
        selectedSessionIds?: string[];
      };
      const selected = ((accepted['selectedSessionIds'] as string[] | undefined) ?? []).map(String);
      // n4: future eligibility derives from the server-side D1 binding
      // time, never from the caller's sessionCreatedAt claim (the Lot 3a
      // routes take source/d1 sequences from authenticated authorities).
      const serverSessionCreatedAt = binding.createdAt.getTime();
      const futureEligible =
        accepted['futureSessions'] === true &&
        serverSessionCreatedAt >= new Date(project.activatedAt ?? 0).getTime();
      if (!selected.includes(input.sessionId) && !futureEligible) {
        throw new SessionContentError('ineligible_session', 'session is outside the project scope');
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
        authorityEpoch: epoch.epoch,
        // D1 rows carry no incarnation/start columns (binding version is the
        // ABA fence); freeze the native boundary per the Lot 1 domain rule.
        nativeBoundarySeq: Math.max(input.d1StartSeq, input.nativeStartSeq),
        channels: project.channels,
        retentionSnapshot: project.retentionByChannel,
        state: 'active',
        version: 1,
        lastFreshnessAckAt: serverSessionCreatedAt,
        localDenyPending: false,
        retainedCopies: false,
        createdAt: now,
        updatedAt: now,
      };
      await tx.insert(sessionContentGrants).values(row);
      return { grantId: row.grantId, sessionId: row.sessionId, version: 1 };
    });
  }

  /** N3 post-amendment child refresh: re-derive one eligible live child
   * under the accepted amendment. Fenced children cannot revive;
   * duplicate ACKs are idempotent, stale ACKs cannot overwrite. */
  async acknowledgeGrantRefresh(
    sessionId: string,
    input: AcknowledgeGrantRefreshInput,
    ctx: SessionContentContext,
  ) {
    requireContext(ctx);
    if (!Number.isSafeInteger(input.projectRevision) || input.projectRevision < 0) {
      throw new SessionContentError('invalid_request', 'acknowledged revision must be a safe integer');
    }
    if (!Number.isSafeInteger(input.bindingVersion) || input.bindingVersion < 0) {
      throw new SessionContentError('invalid_request', 'acknowledged binding version must be a safe integer');
    }
    if (!Number.isSafeInteger(input.nativeBoundarySeq) || input.nativeBoundarySeq < 0) {
      throw new SessionContentError('invalid_request', 'acknowledged boundary must be a safe integer');
    }
    if (typeof input.sourceGeneration !== 'string' || input.sourceGeneration.length === 0) {
      throw new SessionContentError('invalid_request', 'acknowledged source generation must be set');
    }
    if (!Number.isSafeInteger(input.d1Version) || input.d1Version < 0) {
      throw new SessionContentError('invalid_request', 'acknowledged D1 version must be a safe integer');
    }
    if (typeof input.policyDigest !== 'string' || input.policyDigest.length === 0) {
      throw new SessionContentError('invalid_request', 'acknowledged policy digest must be set');
    }
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
      if (grant.state !== 'active') {
        if (grant.state === 'revoked') throw new SessionContentError('grant_revoked', 'grant is revoked');
        if (grant.state === 'excluded') throw new SessionContentError('session_excluded', 'grant is excluded');
        if (grant.state === 'closed') throw new SessionContentError('grant_closed', 'grant is closed');
        throw new SessionContentError('grant_revoked', 'grant is not active');
      }
      // m1: an unreconciled local deny pauses capture — reconcile first.
      if (grant.localDenyPending) {
        throw new SessionContentError('invalid_request', 'unreconciled local deny; reconcile first');
      }
      const [project] = await tx
        .select()
        .from(sessionContentProjects)
        .where(eq(sessionContentProjects.projectId, grant.projectId))
        .limit(1);
      if (!project || project.state !== 'active') {
        throw new SessionContentError('project_not_active', 'project is not active');
      }
      if (input.projectRevision !== project.projectRevision) {
        throw new SessionContentError('revision_conflict', 'acknowledged revision is not the current parent revision');
      }
      if (grant.projectRevision === project.projectRevision) {
        return { sessionId, projectRevision: grant.projectRevision, version: grant.version, refreshed: false as const }; // idempotent
      }
      if ((project.excludedSessionIds as string[]).map(String).includes(sessionId)) {
        throw new SessionContentError('session_excluded', 'session is excluded');
      }
      if (project.requiresFreshAmendment) {
        throw new SessionContentError('suppressed_scope', 'a fresh amendment is required');
      }
      await this.checkTombstones(tx, [
        { kind: 'tenant', id: ctx.tenantId },
        { kind: 'user', id: ctx.ownerId },
        { kind: 'workspace', id: grant.workspaceId },
      ]);
      const [binding] = await tx
        .select()
        .from(sessionWorkspaceBindings)
        .where(eq(sessionWorkspaceBindings.sessionId, sessionId))
        .limit(1);
      if (!binding || binding.tenantId !== ctx.tenantId) {
        throw new SessionContentError('ineligible_session', 'no eligible D1 binding');
      }
      if (binding.bindingId !== grant.bindingId || binding.workspaceId !== project.workspaceId) {
        throw new SessionContentError('ineligible_session', 'binding changed; a new derivation is required');
      }
      if (binding.version !== input.bindingVersion || binding.version !== grant.bindingVersion) {
        throw new SessionContentError('ineligible_session', 'binding version mismatch (ABA)');
      }
      if (binding.status !== 'attached') {
        throw new SessionContentError('ineligible_session', 'binding is not attached');
      }
      if (binding.principalId !== ctx.ownerId) {
        throw new SessionContentError('cross_owner_refused', 'binding principal is not the project owner');
      }
      const policy = project.acceptedPolicy as Record<string, unknown> & {
        sourceTrustVersions: string[];
        selectedSessionIds: string[];
        futureSessions?: boolean;
      };
      const trustVersions = ((policy['sourceTrustVersions'] as string[] | undefined) ?? []).map(String);
      if (!trustVersions.includes(grant.sourceTrustVersion)) {
        throw new SessionContentError('source_reauthorization_required', 'source trust version is not covered');
      }
      // P3: the attested generation and D1 version must equal the grant's
      // frozen values — a replaced source or a changed D1 version needs a
      // separately authorized derivation, never a refresh overwrite.
      if (input.sourceGeneration !== grant.sourceGeneration) {
        throw new SessionContentError('source_reauthorization_required', 'source generation changed; re-derive');
      }
      if (input.d1Version !== grant.d1Version) {
        throw new SessionContentError('ineligible_session', 'D1 version changed; a new derivation is required');
      }
      // m1: the ACK binds the exact accepted scope by digest.
      if (input.policyDigest !== project.retentionDigest) {
        throw new SessionContentError('revision_conflict', 'acknowledged scope is not the accepted one');
      }
      const selected = ((policy['selectedSessionIds'] as string[] | undefined) ?? []).map(String);
      const futureEligible =
        (policy['futureSessions'] as boolean | undefined) === true &&
        binding.createdAt.getTime() >= new Date(project.activatedAt ?? 0).getTime();
      if (!selected.includes(sessionId) && !futureEligible) {
        throw new SessionContentError('ineligible_session', 'session is outside the amended project scope');
      }
      await this.requireEpochScope(
        tx,
        grant.authorityEpoch,
        namespaceIdFor(ctx.tenantId, ctx.ownerId, grant.authorityEpoch),
      );
      // m1: resuming takes only post-boundary bytes — the boundary moves
      // forward, and the freshness ack advances to the refresh time.
      if (input.nativeBoundarySeq < grant.nativeBoundarySeq) {
        throw new SessionContentError('invalid_request', 'acknowledged boundary moved backwards');
      }
      const [locked] = await tx
        .select()
        .from(sessionContentGrants)
        .where(eq(sessionContentGrants.sessionId, sessionId))
        .for('update')
        .limit(1);
      if (!locked || locked.localDenyPending || locked.version !== grant.version || locked.state !== 'active'
        || locked.projectRevision !== grant.projectRevision) {
        throw new SessionContentError('revision_conflict', 'concurrent grant change; re-acknowledge the refresh');
      }
      const refreshed = await tx
        .update(sessionContentGrants)
        .set({
          projectRevision: project.projectRevision,
          version: grant.version + 1,
          channels: project.channels,
          retentionSnapshot: project.retentionByChannel,
          nativeBoundarySeq: input.nativeBoundarySeq,
          lastFreshnessAckAt: this.nowMs(),
          updatedAt: new Date(this.nowMs()),
        })
        .where(
          and(
            eq(sessionContentGrants.sessionId, sessionId),
            eq(sessionContentGrants.version, grant.version),
          ),
        )
        .returning({ version: sessionContentGrants.version });
      if (refreshed.length !== 1) {
        throw new SessionContentError('revision_conflict', 'concurrent refresh; re-acknowledge');
      }
      return { sessionId, projectRevision: project.projectRevision, version: grant.version + 1, refreshed: true as const };
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
        .set({ state: 'revoked', readDenied: true, updatedAt: new Date(this.nowMs()) })
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
        .for('update')
        .limit(1);
      if (!grant) throw new SessionContentError('grant_not_found', 'unknown grant');
      if (grant.tenantId !== ctx.tenantId || grant.ownerId !== ctx.ownerId) {
        throw new SessionContentError('cross_owner_refused', 'grant belongs to another owner');
      }
      if (grant.readDenied || grant.state === 'revoked' || grant.state === 'expired') {
        throw new SessionContentError('grant_revoked', 'grant is revoked');
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
      await this.requireRetainedRead(tx, grant);
      await this.checkWorkspaceMembership(tx, grant.workspaceId, ctx.principalId);
      await this.requireEpochScope(tx, grant.authorityEpoch, namespaceIdFor(ctx.tenantId, ctx.ownerId, grant.authorityEpoch));
      if (!['active', 'closed', 'excluded'].includes(grant.state)) {
        throw new SessionContentError('grant_revoked', 'retained reading is denied');
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
      return { authorizationId, state: 'revoked' as const };
    });
  }

  /** P1 charge rule shared by quota gating and usage reads: reserved rows
   * are always charged; stale rows only while no object row carries their
   * bytes (unknown outcome without PUT). The correlated anti-join makes the
   * staged/purge_pending object charge the single one. */
  private reservationChargeCondition() {
    return or(
      eq(sessionContentReservations.state, 'reserved'),
      and(
        eq(sessionContentReservations.state, 'stale'),
        notExists(
          db
            .select({ one: sql`1` })
            .from(sessionContentObjects)
            .where(
              eq(
                sessionContentObjects.reservationId,
                sessionContentReservations.reservationId,
              ),
            ),
        ),
      ),
    );
  }

  private async chargedBytes(
    client: DbClient,
    scope: { namespaceId?: string; sessionId?: string; tenantId?: string },
  ): Promise<number> {
    let objectNamespaces: string[] | null = null;
    if (scope.tenantId && !scope.namespaceId && !scope.sessionId) {
      const namespaces = await client
        .select({ namespaceId: sessionContentNamespaces.namespaceId })
        .from(sessionContentNamespaces)
        .where(eq(sessionContentNamespaces.tenantId, scope.tenantId));
      objectNamespaces = namespaces.map((n) => n.namespaceId);
      if (objectNamespaces.length === 0) return 0;
    }
    const objectConditions = [inArray(sessionContentObjects.state, ['staged', 'committed', 'purge_pending'])];
    if (scope.namespaceId) objectConditions.push(eq(sessionContentObjects.namespaceId, scope.namespaceId));
    if (scope.sessionId) objectConditions.push(eq(sessionContentObjects.sessionId, scope.sessionId));
    if (objectNamespaces !== null) objectConditions.push(inArray(sessionContentObjects.namespaceId, objectNamespaces));
    const [objects] = await client
      .select({ bytes: sql<number>`coalesce(sum(bytes_encoded), 0)::int` })
      .from(sessionContentObjects)
      .where(and(...objectConditions));
    // P1: a stale reservation is charged only while no object row carries
    // its bytes (markAttemptUnknown without PUT stays charged — the outcome
    // is unknown and no object exists). Once the staged row exists, the
    // object charge is the single one: no double count, and no phantom hold
    // after verified deletion.
    const reservedConditions = [this.reservationChargeCondition()];
    if (scope.namespaceId) {
      reservedConditions.push(eq(sessionContentReservations.namespaceId, scope.namespaceId));
    }
    if (scope.sessionId) {
      reservedConditions.push(eq(sessionContentReservations.sessionId, scope.sessionId));
    }
    if (objectNamespaces !== null) {
      reservedConditions.push(inArray(sessionContentReservations.namespaceId, objectNamespaces));
    }
    const [reserved] = await client
      .select({ bytes: sql<number>`coalesce(sum(bytes_encoded), 0)::int` })
      .from(sessionContentReservations)
      .where(and(...reservedConditions));
    return (objects?.bytes ?? 0) + (reserved?.bytes ?? 0);
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
      await this.checkWorkspaceMembership(tx, grant.workspaceId, ctx.principalId);
      if (grant.state !== 'active') {
        throw new SessionContentError(grant.state === 'excluded' ? 'session_excluded' : 'grant_revoked', 'grant is not active');
      }
      // m1: an unreconciled local deny pauses capture — reconcile first.
      if (grant.localDenyPending) {
        throw new SessionContentError('invalid_request', 'unreconciled local deny; reconcile first');
      }
      // N3: reserve and commit share one frozen authorization tuple T.
      // After an amendment, capture pauses at the last acknowledged
      // revision until refresh: revision mismatch denies with zero
      // allocation even if reconciliation has not run.
      const [reserveParent] = await tx
        .select()
        .from(sessionContentProjects)
        .where(eq(sessionContentProjects.projectId, grant.projectId))
        .limit(1);
      if (!reserveParent || reserveParent.state !== 'active') {
        throw new SessionContentError('project_not_active', 'project is not active');
      }
      if (reserveParent.projectRevision !== grant.projectRevision) {
        throw new SessionContentError(
          'project_revision_changed',
          'capture paused while the updated consent is applied',
        );
      }
      if ((reserveParent.excludedSessionIds as string[]).map(String).includes(sessionId)) {
        throw new SessionContentError('session_excluded', 'session is excluded');
      }
      if (reserveParent.requiresFreshAmendment) {
        throw new SessionContentError('suppressed_scope', 'a fresh amendment is required');
      }
      if ((grant.channels as Record<string, boolean>)[channel] !== true) {
        throw new SessionContentError('ineligible_session', 'channel is not enabled for capture');
      }
      await this.requireEpochScope(tx, grant.authorityEpoch, namespaceId);
      // N4: serialize on the tenant key so concurrent sessions of one
      // tenant cannot oversubscribe the tenant quota (covers sessions too).
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtext('scc-reserve'), hashtext(${ctx.tenantId}))`,
      );
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
        authorityEpoch: epoch.epoch,
        sessionId,
        projectRevision: grant.projectRevision,
        grantVersion: grant.version,
        retentionSnapshot: grant.retentionSnapshot,
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

  /** Conditionally publish after upload (M2): a durable `staged` row with
   * its key is written before the PUT, so a crash between PUT and commit
   * leaves the bytes inside the DB inventory. The commit transaction locks
   * reservation and grant rows and rechecks reservation=`reserved`,
   * grant=`active`, pinned epoch and live revisions. A failed final check
   * queues deletion of the staged bytes and publishes nothing. */
  async publishAfterUpload(
    reservationId: string,
    body: Uint8Array,
    ctx: SessionContentContext,
  ) {
    requireContext(ctx);
    const { client, config } = this.storage();
    const admitted = await db.transaction(async (tx) => {
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
      await this.checkWorkspaceMembership(tx, grant.workspaceId, ctx.principalId);
      if (grant.state !== 'active') {
        throw new SessionContentError('grant_revoked', 'grant is not active; late upload refused');
      }
      await this.requireEpochScope(tx, grant.authorityEpoch, existing.namespaceId);
      // N3: recheck the frozen tuple T at writer admission, before any
      // staged row or PUT. If the fence won first, stale the reservation
      // with zero admitted bytes instead of staging a second row.
      const [admitParent] = await tx
        .select()
        .from(sessionContentProjects)
        .where(eq(sessionContentProjects.projectId, grant.projectId))
        .limit(1);
      const fenceWon = !admitParent
        || admitParent.state !== 'active'
        || admitParent.projectRevision !== existing.projectRevision
        || admitParent.projectRevision !== grant.projectRevision
        || existing.grantVersion !== grant.version;
      // A throw below would roll this read-only transaction back, so the
      // stale-marking persists in its own transaction after admission.
      if (fenceWon) {
        return { fenced: true as const, inactive: !admitParent || admitParent.state !== 'active' };
      }
      return { fenced: false as const, reservation: existing, grant };
    });
    if (admitted.fenced) {
      // P1/m4: zero-PUT refusal is a known outcome — release the
      // reservation instead of charging a phantom stale hold forever.
      await db.transaction(async (tx) => {
        await tx
          .update(sessionContentReservations)
          .set({ state: 'cancelled', updatedAt: new Date(this.nowMs()) })
          .where(and(
            eq(sessionContentReservations.reservationId, reservationId),
            eq(sessionContentReservations.state, 'reserved'),
          ));
        await tx
          .update(sessionContentAttempts)
          .set({ outcome: 'cancelled' })
          .where(and(
            eq(sessionContentAttempts.attemptId, reservationId),
            eq(sessionContentAttempts.outcome, 'attempted'),
          ));
      });
      if (admitted.inactive) {
        throw new SessionContentError('project_not_active', 'project changed during upload');
      }
      throw new SessionContentError(
        'project_revision_changed',
        'capture paused while the updated consent is applied',
      );
    }
    const reservation = { reservation: admitted.reservation, grant: admitted.grant };
    const objectId = this.newId();
    const key = objectKeyFor(
      reservation.reservation.namespaceId,
      reservation.grant.bindingId,
      reservation.reservation.sessionId,
      reservation.reservation.channel,
      objectId,
    );
    // N5: fix expiry at first durable admission, using the frozen N3
    // retention snapshot. Upload latency cannot extend the deadline.
    const snapshot = reservation.reservation.retentionSnapshot as RetentionByChannel;
    const channel = reservation.reservation.channel as 'terminal.cache' | 'native.mirror';
    const capturedAt = this.nowMs();
    const retention = snapshot[channel] ?? { mode: 'none' as const };
    const expiresAt =
      retention.mode === 'none' ? null : capturedAt + retention.durationSeconds * 1000;
    await db.transaction(async (tx) => {
      await this.checkMembership(tx, ctx.tenantId, ctx.principalId);
      await this.checkWorkspaceMembership(tx, reservation.grant.workspaceId, ctx.principalId);
      const [parent] = await tx.select().from(sessionContentProjects)
        .where(eq(sessionContentProjects.projectId, reservation.grant.projectId)).for('update').limit(1);
      const [grant] = await tx.select().from(sessionContentGrants)
        .where(eq(sessionContentGrants.sessionId, reservation.grant.sessionId)).for('update').limit(1);
      const [hold] = await tx.select().from(sessionContentReservations)
        .where(eq(sessionContentReservations.reservationId, reservationId)).for('update').limit(1);
      if (!grant || grant.state !== 'active') throw new SessionContentError('grant_revoked', 'writer was fenced');
      if (!parent || parent.state !== 'active' || parent.projectRevision !== hold?.projectRevision
        || grant.version !== hold?.grantVersion || grant.projectRevision !== parent.projectRevision) {
        throw new SessionContentError('project_revision_changed', 'writer authorization changed');
      }
      const [duplicate] = await tx.select({ objectId: sessionContentObjects.objectId }).from(sessionContentObjects)
        .where(eq(sessionContentObjects.reservationId, reservationId)).limit(1);
      if (hold.state !== 'reserved' || duplicate) throw new SessionContentError('unknown_outcome', 'writer already admitted');
      await this.requireEpochScope(tx, grant.authorityEpoch, hold.namespaceId);
      await tx.insert(sessionContentObjects).values({
      objectId,
      namespaceId: reservation.reservation.namespaceId,
      authorityEpoch: reservation.grant.authorityEpoch,
      bindingId: reservation.grant.bindingId,
      sessionId: reservation.reservation.sessionId,
      reservationId: reservation.reservation.reservationId,
      channel: reservation.reservation.channel,
      bucket: config.bucket,
      objectKey: key,
      bytesRaw: reservation.reservation.bytesRaw,
      bytesEncoded: reservation.reservation.bytesEncoded,
      capturedAt,
      expiresAt,
      state: 'staged',
      writerState: 'admitted',
      version: 1,
      });
    });
    // N5: a PUT/hook failure keeps purge pending and quota charged: the
    // staged row becomes purge_pending with an object-scoped job, the
    // reservation goes stale and the attempt unknown. Retrying the same
    // reservation refuses (stale) instead of staging a second row.
    let putStarted = false;
    let putSettled = false;
    try {
      if (this.publishHooks?.beforePut) {
        await this.publishHooks.beforePut(key);
      }
      putStarted = true;
      await client.send(
        new PutObjectCommand({ Bucket: config.bucket, Key: key, Body: body }),
      );
      putSettled = true;
      await db.update(sessionContentObjects).set({ writerState: 'settled' })
        .where(eq(sessionContentObjects.objectId, objectId));
      if (this.publishHooks?.afterUpload) {
        await this.publishHooks.afterUpload(key);
      }
    } catch (err) {
      await db.update(sessionContentObjects).set({ writerState: putStarted && !putSettled ? 'unknown' : 'settled' })
        .where(eq(sessionContentObjects.objectId, objectId));
      await this.queueStagedDeletion(
        objectId,
        reservation.reservation.namespaceId,
        reservation.grant.bindingId,
        reservationId,
      );
      throw new SessionContentError(
        'unknown_outcome',
        `upload outcome unknown, purge pending: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    try {
      await db.transaction(async (tx) => {
        // Membership withdrawal serializes with this final commit. No row
        // lock is held over the network PUT; withdrawal during it wins.
        await this.checkMembership(tx, ctx.tenantId, ctx.principalId);
        await this.checkWorkspaceMembership(tx, reservation.grant.workspaceId, ctx.principalId);
        const [project] = await tx.select().from(sessionContentProjects)
          .where(eq(sessionContentProjects.projectId, reservation.grant.projectId)).for('update').limit(1);
        const [freshGrant] = await tx
          .select()
          .from(sessionContentGrants)
          .where(eq(sessionContentGrants.sessionId, reservation.reservation.sessionId))
          .for('update')
          .limit(1);
        if (!freshGrant || freshGrant.state !== 'active') {
          throw new SessionContentError('grant_revoked', 'grant is not active; late publish refused');
        }
        const [lockedReservation] = await tx
          .select()
          .from(sessionContentReservations)
          .where(eq(sessionContentReservations.reservationId, reservationId))
          .for('update')
          .limit(1);
        if (!lockedReservation || lockedReservation.state !== 'reserved') {
          throw new SessionContentError('unknown_outcome', 'reservation changed during upload');
        }
        await this.requireEpochScope(tx, freshGrant.authorityEpoch, reservation.reservation.namespaceId);
        // N3: publication commits before the amendment fence, or the fence
        // wins and publication refuses. The locked project row shares one
        // order with the amendment CAS; authority is never reconstructed
        // from the latest grant but rechecked against the frozen tuple T.
        if (!project || project.state !== 'active') {
          throw new SessionContentError('project_not_active', 'project changed during upload');
        }
        if (project.projectRevision !== reservation.reservation.projectRevision
          || project.projectRevision !== freshGrant.projectRevision
          || reservation.reservation.grantVersion !== freshGrant.version) {
          throw new SessionContentError(
            'project_revision_changed',
            'capture paused while the updated consent is applied',
          );
        }
        const [binding] = await tx
          .select()
          .from(sessionWorkspaceBindings)
          .where(eq(sessionWorkspaceBindings.sessionId, reservation.reservation.sessionId))
          .limit(1);
        if (!binding || binding.bindingId !== freshGrant.bindingId || binding.version !== freshGrant.bindingVersion) {
          throw new SessionContentError('ineligible_session', 'binding changed during upload (ABA)');
        }
        // n1: assert exactly one staged row commits; a concurrent move
        // refuses instead of consuming quota for nothing committed.
        const committed = await tx
          .update(sessionContentObjects)
          .set({ state: 'committed', capturedAt, expiresAt, updatedAt: new Date(this.nowMs()) })
          .where(
            and(
              eq(sessionContentObjects.objectId, objectId),
              eq(sessionContentObjects.state, 'staged'),
            ),
          )
          .returning({ objectId: sessionContentObjects.objectId });
        if (committed.length !== 1) {
          throw new SessionContentError('unknown_outcome', 'staged row moved during upload');
        }
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
    } catch (err) {
      await this.queueStagedDeletion(
        objectId,
        reservation.reservation.namespaceId,
        reservation.grant.bindingId,
        reservationId,
      );
      throw err;
    }
    return { objectId, key, expiresAt };
  }

  /** A failed final publish check queues deletion of the staged bytes and
   * publishes nothing; quota stays charged until deletion is verified. */
  private async queueStagedDeletion(
    objectId: string,
    namespaceId: string,
    bindingId: string,
    reservationId: string,
  ): Promise<void> {
    await db.transaction(async (tx) => {
      await tx
        .update(sessionContentObjects)
        .set({ state: 'purge_pending', updatedAt: new Date(this.nowMs()) })
        .where(
          and(
            eq(sessionContentObjects.objectId, objectId),
            eq(sessionContentObjects.state, 'staged'),
          ),
        );
      await tx
        .update(sessionContentReservations)
        .set({ state: 'stale', updatedAt: new Date(this.nowMs()) })
        .where(eq(sessionContentReservations.reservationId, reservationId));
      await tx
        .update(sessionContentAttempts)
        .set({ outcome: 'outcome_unknown' })
        .where(eq(sessionContentAttempts.attemptId, reservationId));
      await tx.insert(sessionContentPurgeJobs).values({
        purgeJobId: this.newId(),
        namespaceId,
        bindingId,
        objectId,
        scope: 'object',
        state: 'pending',
      });
    });
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
      const grant = await this.ownedGrant(tx, existing.sessionId, ctx);
      if (existing.namespaceId !== namespaceIdFor(grant.tenantId, grant.ownerId, grant.authorityEpoch)) {
        throw new SessionContentError('cross_owner_refused', 'reservation namespace belongs elsewhere');
      }
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
      await this.requireRetainedRead(tx, grant);
      await this.checkWorkspaceMembership(tx, grant.workspaceId, ctx.principalId);
      await this.requireEpochScope(
        tx,
        grant.authorityEpoch,
        namespaceIdFor(ctx.tenantId, ctx.ownerId, grant.authorityEpoch),
      );
      if (grant.state === 'active') {
        // Live read; no history authorization needed.
      } else if (grant.state === 'closed' || grant.state === 'excluded') {
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
      // n2: reads are fenced to the grant's authority epoch so a
      // re-derived session after restore cannot read the old epoch's copies.
      const objects = await tx
        .select()
        .from(sessionContentObjects)
        .where(
          and(
            eq(sessionContentObjects.sessionId, sessionId),
            eq(sessionContentObjects.channel, channel),
            eq(sessionContentObjects.state, 'committed'),
            eq(sessionContentObjects.authorityEpoch, grant.authorityEpoch),
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
          this.reservationChargeCondition(),
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
          inTenantScope,
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
  async consumePurgeJobs(limit = 25): Promise<void> {
    const jobs = await db.select({ purgeJobId: sessionContentPurgeJobs.purgeJobId })
      .from(sessionContentPurgeJobs)
      .where(inArray(sessionContentPurgeJobs.state, ['pending', 'in_progress']))
      .orderBy(sessionContentPurgeJobs.updatedAt, sessionContentPurgeJobs.purgeJobId)
      .limit(Math.max(1, Math.min(limit, 25)));
    for (const job of jobs) {
      try { await this.runPurge(job.purgeJobId); }
      catch (error) {
        await db.update(sessionContentPurgeJobs).set({ state: 'pending', updatedAt: new Date(this.nowMs()),
          evidence: { retryable: true, error: error instanceof SessionContentError ? error.code : 'storage_unavailable' },
        }).where(and(eq(sessionContentPurgeJobs.purgeJobId, job.purgeJobId),
          inArray(sessionContentPurgeJobs.state, ['pending', 'in_progress'])));
      }
    }
  }

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
    // P2: a completed job returns its recorded evidence without executing
    // again — a re-run settles nothing, not even an empty scope.
    if (job.state === 'complete') {
      return {
        purgeJobId,
        ...(job.evidence as {
          deletedObjects: number;
          deletedBytes: number;
          deletedKeys: string[];
          remainingObjects: number;
          verifiedAt: number;
        }),
      };
    }
    // N1: `object` jobs delete one staged/`purge_pending` row only and
    // never committed copies; other scopes keep real purge-event semantics.
    const isObjectJob = job.scope === 'object' && (job.objectId?.length ?? 0) > 0;
    const objects = await db
      .select()
      .from(sessionContentObjects)
      .where(
        isObjectJob
          ? and(
            eq(sessionContentObjects.namespaceId, job.namespaceId),
            eq(sessionContentObjects.objectId, job.objectId as string),
            inArray(sessionContentObjects.state, ['staged', 'purge_pending']),
          )
          : and(
            eq(sessionContentObjects.namespaceId, job.namespaceId),
            inArray(sessionContentObjects.state, ['committed', 'staged', 'purge_pending']),
          ),
      );
    const inScope = isObjectJob || !job.bindingId
      ? objects
      : objects.filter((o) => o.bindingId === job.bindingId);
    // Durable settlement survives process loss. Neither SQL cancellation
    // nor an absent key can settle an admitted/unknown remote PUT.
    const deletable = inScope.filter((object) => object.writerState === 'settled');
    let deletedBytes = 0;
    const deletedKeys: string[] = [];
    for (const object of deletable) {
      await client.send(
        new DeleteObjectCommand({ Bucket: object.bucket, Key: object.objectKey }),
      );
      try {
        await client.send(new HeadObjectCommand({ Bucket: object.bucket, Key: object.objectKey }));
        throw new SessionContentError('purge_pending', 'object still exists after deletion');
      } catch (error) {
        if ((error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode !== 404) throw error;
      }
      deletedBytes += object.bytesEncoded;
      deletedKeys.push(object.objectKey);
    }
    const evidence = await db.transaction(async (tx) => {
      for (const object of deletable) {
        await tx
          .update(sessionContentObjects)
          .set({ state: 'purged', updatedAt: new Date(this.nowMs()) })
          .where(eq(sessionContentObjects.objectId, object.objectId));
      }
      // P2: an object job settles only the writers bound to its own
      // objects (attemptId = reservation id); an empty scope cancels
      // nothing. Other scopes keep the namespace-wide settlement.
      const linkedReservationIds = [
        ...new Set(
          deletable
            .map((o) => o.reservationId)
            .filter((id: string | null): id is string => (id?.length ?? 0) > 0),
        ),
      ];
      if (!isObjectJob) {
        await tx
          .update(sessionContentAttempts)
          .set({ outcome: 'cancelled' })
          .where(
            and(
              eq(sessionContentAttempts.namespaceId, job.namespaceId),
              eq(sessionContentAttempts.outcome, 'attempted'),
            ),
          );
      } else if (linkedReservationIds.length > 0) {
        await tx
          .update(sessionContentAttempts)
          .set({ outcome: 'cancelled' })
          .where(
            and(
              eq(sessionContentAttempts.namespaceId, job.namespaceId),
              eq(sessionContentAttempts.outcome, 'attempted'),
              inArray(sessionContentAttempts.attemptId, linkedReservationIds),
            ),
          );
      }
      // P1: when the object job verifies absence, release the paired
      // reservations from stale — and only from stale, never reserved or
      // consumed writers.
      if (isObjectJob && linkedReservationIds.length > 0) {
        await tx
          .update(sessionContentReservations)
          .set({ state: 'cancelled', updatedAt: new Date(this.nowMs()) })
          .where(
            and(
              inArray(sessionContentReservations.reservationId, linkedReservationIds),
              eq(sessionContentReservations.state, 'stale'),
            ),
          );
      }
      const [remaining] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(sessionContentObjects)
        .where(
          and(
            eq(sessionContentObjects.namespaceId, job.namespaceId),
            inArray(sessionContentObjects.state, ['committed', 'staged', 'purge_pending']),
            isObjectJob
              ? eq(sessionContentObjects.objectId, job.objectId as string)
              : job.bindingId ? eq(sessionContentObjects.bindingId, job.bindingId) : sql`TRUE`,
          ),
        );
      const record = {
        deletedObjects: deletable.length,
        deletedBytes,
        deletedKeys,
        remainingObjects: remaining?.count ?? 0,
        verifiedAt: this.nowMs(),
      };
      await tx
        .update(sessionContentPurgeJobs)
        .set({
          state: (remaining?.count ?? 0) === 0 ? 'complete' : 'pending',
          evidence: record,
          completedAt: (remaining?.count ?? 0) === 0 ? new Date(this.nowMs()) : null,
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
      await tx
        .update(sessionContentAttempts)
        .set({ outcome: 'cancelled' })
        .where(
          and(
            eq(sessionContentAttempts.sessionId, sessionId),
            eq(sessionContentAttempts.outcome, 'attempted'),
          ),
        );
      for (const object of staged) {
        await tx.insert(sessionContentPurgeJobs).values({
          purgeJobId: this.newId(),
          namespaceId: object.namespaceId,
          bindingId: grant.bindingId,
          objectId: object.objectId,
          scope: 'object',
          state: 'pending',
        });
      }
      return { sessionId };
    });
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
    await db.transaction(async (tx) => {
      await this.ownedGrant(tx, sessionId, ctx);
      await tx.update(sessionContentGrants)
        .set({ localDenyPending: true, updatedAt: new Date(this.nowMs()) })
        .where(and(eq(sessionContentGrants.sessionId, sessionId),
          eq(sessionContentGrants.tenantId, ctx.tenantId), eq(sessionContentGrants.ownerId, ctx.ownerId)));
    });
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
        .set({ state: 'revoked', readDenied: true, localDenyPending: false, updatedAt: new Date(this.nowMs()) })
        .where(eq(sessionContentGrants.sessionId, sessionId));
      return { sessionId, reconciled: true as const };
    });
  }

  /** Membership-free denial-only retained handles: the still-active origin
   * owner lists opaque handles/status without membership or source contact.
   * No handle grants reading or control. */
  async listRetainedHandles(ownerId: string, tenantId?: string) {
    const namespaces = await db
      .select()
      .from(sessionContentNamespaces)
      .where(
        and(
          eq(sessionContentNamespaces.ownerId, ownerId),
          tenantId ? eq(sessionContentNamespaces.tenantId, tenantId) : undefined,
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
      const pendingBindings = new Set<string>();
      for (const object of objects) {
        byBinding.set(object.bindingId, (byBinding.get(object.bindingId) ?? 0) + object.bytesEncoded);
        if (object.state === 'purge_pending') pendingBindings.add(object.bindingId);
      }
      for (const [bindingId, bytes] of byBinding) {
        handles.push({
          retainedScopeId: `retained:${namespace.namespaceId}:${bindingId}`,
          bindingId,
          status: pendingBindings.has(bindingId) || namespace.status !== 'active' ? 'purge_pending' : 'active',
          bytes,
        });
      }
    }
    return handles;
  }

  /** D1 proves attachment only. No source capability or read/control authority
   * is inferred while CM2-F2/CM2-N5-AUTH/CONTROL and the source contract remain unqualified. */
  async discoverWorkspace(workspaceId: string, ownerId: string) {
    await this.checkWorkspaceMembership(db, workspaceId, ownerId);
    const [workspace] = await db.select().from(workspaces)
      .where(eq(workspaces.id, workspaceId)).limit(1);
    if (!workspace || workspace.hiddenAt) throw new SessionContentError('not_found', 'workspace is unavailable');
    await this.checkMembership(db, workspace.tenantId, ownerId);
    const bindings = await db.select().from(sessionWorkspaceBindings).where(and(
      eq(sessionWorkspaceBindings.workspaceId, workspaceId),
      eq(sessionWorkspaceBindings.tenantId, workspace.tenantId),
      eq(sessionWorkspaceBindings.principalId, ownerId),
    ));
    const grants = await db.select().from(sessionContentGrants).where(and(
      eq(sessionContentGrants.workspaceId, workspaceId),
      eq(sessionContentGrants.tenantId, workspace.tenantId), eq(sessionContentGrants.ownerId, ownerId),
    ));
    const [project] = await db.select().from(sessionContentProjects).where(and(
      eq(sessionContentProjects.workspaceId, workspaceId),
      eq(sessionContentProjects.tenantId, workspace.tenantId), eq(sessionContentProjects.ownerId, ownerId),
    )).limit(1);
    const copies = await db.select({ objectId: sessionContentObjects.objectId,
      sessionId: sessionContentObjects.sessionId, channel: sessionContentObjects.channel,
      expiresAt: sessionContentObjects.expiresAt, createdAt: sessionContentObjects.createdAt,
      state: sessionContentObjects.state,
    }).from(sessionContentObjects)
      .innerJoin(sessionContentNamespaces, eq(sessionContentObjects.namespaceId, sessionContentNamespaces.namespaceId))
      .innerJoin(sessionContentGrants, and(eq(sessionContentObjects.sessionId, sessionContentGrants.sessionId),
        eq(sessionContentObjects.bindingId, sessionContentGrants.bindingId)))
      .where(and(eq(sessionContentNamespaces.ownerId, ownerId), eq(sessionContentNamespaces.tenantId, workspace.tenantId),
        eq(sessionContentGrants.workspaceId, workspaceId), eq(sessionContentGrants.ownerId, ownerId),
        inArray(sessionContentObjects.state, ['committed', 'purge_pending'])));
    const scope = { workspaceId, ownerId, projectId: project?.projectId ?? workspaceId, sourceId: '' };
    const sessionIds = new Set([...bindings.map((row) => row.sessionId), ...grants.map((row) => row.sessionId)]);
    return { ...scope, projectRevision: project?.projectRevision ?? 0, projectState: project?.state ?? 'off',
      sourceVerified: false, reason: 'unsupported_source', authenticationState: 'step_up_required' as const,
      confirmationAvailable: false, namedHistories: [], eligibleSources: [],
      items: [...sessionIds].map((sessionId) => {
        const binding = bindings.find((row) => row.sessionId === sessionId);
        const grant = grants.find((row) => row.sessionId === sessionId);
        const retained = copies.filter((copy) => copy.sessionId === sessionId);
        return { ...scope, sessionId, bindingId: grant?.bindingId ?? binding!.bindingId,
          status: binding?.status ?? 'ended', sourceAvailable: false, liveAuthorized: false,
          storedAuthorized: false, historyAuthorized: false, retained: retained.length > 0,
          excluded: grant?.state === 'excluded', revoked: grant?.state === 'revoked',
          projectRevision: project?.projectRevision ?? 0, grantProjectRevision: grant?.projectRevision ?? 0,
          copies: retained.map(({ objectId, channel, expiresAt }) => ({ objectId, channel, expiresAt })),
          lastReceivedAt: retained.length ? Math.max(...retained.map((copy) => copy.createdAt.getTime())) : undefined,
          purgeStatus: retained.some((copy) => copy.state === 'purge_pending') ? 'pending' : undefined,
          pauseReason: 'unsupported_source',
        };
      }),
    };
  }

  /** Denial-only purge request over an opaque retained scope: writer-settled
   * physical deletion with no read/grant/control elevation. */
  async denyBindingContent(bindingId: string, ownerId: string, intent: 'revoke' | 'exclude') {
    const [grant] = await db.select().from(sessionContentGrants).where(and(
      eq(sessionContentGrants.bindingId, bindingId), eq(sessionContentGrants.ownerId, ownerId),
    )).limit(1);
    if (!grant) throw new SessionContentError('not_found', 'content binding is unavailable');
    await this.checkMembership(db, grant.tenantId, ownerId);
    await this.checkWorkspaceMembership(db, grant.workspaceId, ownerId);
    return this.denyRetainedScope(
      `retained:${namespaceIdFor(grant.tenantId, ownerId, grant.authorityEpoch)}:${bindingId}`, ownerId, intent, false,
    );
  }

  async denyWorkspaceContent(workspaceId: string, ownerId: string) {
    await this.checkWorkspaceMembership(db, workspaceId, ownerId);
    const [workspace] = await db.select().from(workspaces).where(eq(workspaces.id, workspaceId)).limit(1);
    if (!workspace) throw new SessionContentError('not_found', 'workspace is unavailable');
    await this.checkMembership(db, workspace.tenantId, ownerId);
    await db.transaction(async (tx) => {
      const projects = await tx.select().from(sessionContentProjects).where(and(
        eq(sessionContentProjects.workspaceId, workspaceId), eq(sessionContentProjects.ownerId, ownerId),
        eq(sessionContentProjects.tenantId, workspace.tenantId),
      )).orderBy(sessionContentProjects.projectId).for('update');
      const ids = projects.map((project) => project.projectId);
      if (!ids.length) return;
      await tx.update(sessionContentProjects).set({ state: 'revoked', updatedAt: new Date(this.nowMs()) })
        .where(inArray(sessionContentProjects.projectId, ids));
      await tx.update(sessionContentGrants).set({ state: 'revoked', version: sql`${sessionContentGrants.version} + 1` })
        .where(inArray(sessionContentGrants.projectId, ids));
      await tx.update(sessionContentHistoryAuthorizations).set({ state: 'revoked',
        version: sql`${sessionContentHistoryAuthorizations.version} + 1` })
        .where(inArray(sessionContentHistoryAuthorizations.projectId, ids));
    });
    return { complete: true };
  }

  async requestRetainedPurge(retainedScopeId: string, ownerId: string) {
    return this.denyRetainedScope(retainedScopeId, ownerId, 'revoke', true);
  }

  private async denyRetainedScope(retainedScopeId: string, ownerId: string, intent: 'revoke' | 'exclude', purge: boolean) {
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
      // Participate in the publication/amendment lock order before fencing
      // grants. A deletion-only pass could otherwise admit a later writer.
      const grants = await tx.select().from(sessionContentGrants).where(and(
        eq(sessionContentGrants.bindingId, bindingId as string),
        eq(sessionContentGrants.tenantId, namespace.tenantId),
        eq(sessionContentGrants.ownerId, ownerId), eq(sessionContentGrants.authorityEpoch, namespace.epoch),
      ));
      const projects = [...new Set(grants.map((grant) => grant.projectId))].sort();
      for (const projectId of projects) {
        const [project] = await tx.select().from(sessionContentProjects)
          .where(eq(sessionContentProjects.projectId, projectId)).limit(1).for('update');
        if (project && intent === 'exclude') await tx.update(sessionContentProjects).set({
          excludedSessionIds: [...new Set([...(project.excludedSessionIds as string[]),
            ...grants.filter((grant) => grant.projectId === projectId).map((grant) => grant.sessionId)])],
          exclusionRevision: project.exclusionRevision + 1, updatedAt: new Date(this.nowMs()),
        }).where(eq(sessionContentProjects.projectId, projectId));
      }
      await tx.update(sessionContentGrants)
        .set({ state: intent === 'exclude'
          ? sql`CASE WHEN ${sessionContentGrants.state} IN ('revoked', 'expired')
            OR ${sessionContentGrants.readDenied} THEN ${sessionContentGrants.state} ELSE 'excluded' END` : 'revoked',
        readDenied: intent === 'revoke' ? true : sql`${sessionContentGrants.readDenied}`,
          version: sql`${sessionContentGrants.version} + 1`, updatedAt: new Date(this.nowMs()) })
        .where(and(eq(sessionContentGrants.bindingId, bindingId as string),
          eq(sessionContentGrants.tenantId, namespace.tenantId), eq(sessionContentGrants.ownerId, ownerId),
          eq(sessionContentGrants.authorityEpoch, namespace.epoch)));
      if (projects.length && (purge || intent === 'revoke')) await tx.update(sessionContentHistoryAuthorizations)
        .set({ state: 'revoked', version: sql`${sessionContentHistoryAuthorizations.version} + 1` })
        .where(and(eq(sessionContentHistoryAuthorizations.bindingId, bindingId as string),
          inArray(sessionContentHistoryAuthorizations.sessionId, grants.map((grant) => grant.sessionId)),
          inArray(sessionContentHistoryAuthorizations.projectId, projects)));
      if (!purge) return;
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
    return purge ? this.runPurge(purgeJobId) : { deletedObjects: 0, remainingObjects: 0 };
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
