import { createHash } from 'node:crypto';

/** Independently grantable D2 capabilities; all initially off. */
export type ContentChannel =
  | 'terminal.live'
  | 'terminal.cache'
  | 'native.mirror'
  | 'keyboard.control';

/** Retained-copy channels carrying an owner-selected retention policy. */
export type RetainedChannel = 'terminal.cache' | 'native.mirror';

export const RETAINED_CHANNELS: readonly RetainedChannel[] = ['terminal.cache', 'native.mirror'];
export const CONTENT_CHANNELS: readonly ContentChannel[] = [
  'terminal.live',
  'terminal.cache',
  'native.mirror',
  'keyboard.control',
];

export interface NoExpiryRetention {
  readonly mode: 'none';
}

export interface DurationRetention {
  readonly mode: 'duration';
  readonly durationSeconds: number;
}

/** Explicit tagged retention choice; default stored copies use `{ mode: 'none' }`. */
export type RetentionPolicy = NoExpiryRetention | DurationRetention;
export type RetentionByChannel = Record<RetainedChannel, RetentionPolicy>;

export type ContentConsentErrorCode =
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
  | 'project_excluded'
  | 'session_excluded'
  | 'suppressed_scope'
  | 'ineligible_session'
  | 'cross_tenant_refused'
  | 'cross_project_refused'
  | 'cross_source_refused'
  | 'cross_owner_refused'
  | 'source_reauthorization_required'
  | 'history_authorization_required'
  | 'unprovable_range'
  | 'not_resumable'
  | 'live_expired'
  | 'lease_skew_exceeded'
  | 'grant_revoked'
  | 'grant_closed'
  | 'admin_read_refused'
  | 'membership_required'
  | 'project_revision_changed'
  | 'revision_conflict';

export class ContentConsentError extends Error {
  constructor(
    readonly code: ContentConsentErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'ContentConsentError';
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Validate the owner-selected per-channel retention map. Every retained
 * channel needs an explicit tagged choice: `{ mode: 'none' }` by default or
 * `{ mode: 'duration', durationSeconds }` with a positive safe-integer
 * duration. Omitted channels and untagged finite values fail as unsigned;
 * zero/negative/fractional/overflowing durations and unknown tags fail as
 * invalid. No environment/tenant/admin default is ever substituted here.
 */
export const validateRetentionByChannel = (value: unknown): RetentionByChannel => {
  if (!isRecord(value)) {
    throw new ContentConsentError('invalid_retention', 'retentionByChannel must be an object');
  }
  for (const key of Object.keys(value)) {
    if (key !== 'terminal.cache' && key !== 'native.mirror') {
      throw new ContentConsentError('invalid_request', `unknown retention channel ${key}`);
    }
  }
  const result = {} as Record<RetainedChannel, RetentionPolicy>;
  for (const channel of RETAINED_CHANNELS) {
    const entry = value[channel];
    if (entry === undefined) {
      throw new ContentConsentError('unsigned_retention', `${channel} retention is required`);
    }
    if (!isRecord(entry) || typeof entry['mode'] !== 'string') {
      if (isRecord(entry) && typeof entry['durationSeconds'] === 'number') {
        throw new ContentConsentError('unsigned_retention', `${channel} retention mode is required`);
      }
      throw new ContentConsentError('invalid_retention', `${channel} retention is malformed`);
    }
    if (entry['mode'] === 'none') {
      result[channel] = { mode: 'none' };
    } else if (entry['mode'] === 'duration') {
      const seconds = entry['durationSeconds'];
      if (typeof seconds !== 'number' || !Number.isSafeInteger(seconds) || seconds <= 0) {
        throw new ContentConsentError('invalid_retention', `${channel} durationSeconds must be a positive safe integer`);
      }
      result[channel] = { mode: 'duration', durationSeconds: seconds };
    } else {
      throw new ContentConsentError('invalid_retention', `${channel} retention mode is unknown`);
    }
  }
  return result;
};

/** Canonical JSON with sorted keys so both authorities hash the same bytes. */
export const canonicalizePolicy = (policy: unknown): string => {
  if (Array.isArray(policy)) return `[${policy.map(canonicalizePolicy).join(',')}]`;
  if (isRecord(policy)) {
    const keys = Object.keys(policy).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalizePolicy(policy[key])}`).join(',')}}`;
  }
  return JSON.stringify(policy) ?? 'null';
};

/** SHA-256 hex digest of the canonical policy; the source recomputes it. */
export const computePolicyDigest = (policy: unknown): string =>
  createHash('sha256').update(canonicalizePolicy(policy), 'utf8').digest('hex');

export const verifyPolicyDigest = (policy: unknown, digest: string): boolean =>
  computePolicyDigest(policy) === digest;

/** Exact historical lineage/checkpoint/range named in an accepted project revision. */
export interface NamedHistoryDescriptor {
  readonly provider: string;
  readonly conversationId: string;
  readonly lineage: string;
  readonly sourceIdentity: string;
  readonly checkpoint: string;
  readonly rangeDigest: string;
  readonly startSeq?: number;
  readonly endSeq?: number;
}

/** The signed owner/project scope subset covered by the policy digest. */
export interface CanonicalProjectPolicy {
  readonly projectId: string;
  readonly projectRevision: number;
  readonly tenantId: string;
  readonly workspaceId: string;
  readonly workspaceIncarnation: number;
  readonly ownerId: string;
  readonly readers: readonly string[];
  readonly sourceIdentities: readonly string[];
  readonly sourceTrustVersions: readonly string[];
  readonly channels: Record<ContentChannel, boolean>;
  readonly futureSessions: boolean;
  readonly selectedSessionIds: readonly string[];
  readonly namedHistories: readonly NamedHistoryDescriptor[];
  readonly retentionByChannel: RetentionByChannel;
  readonly authorityEpoch: string;
}

export type ProjectConsentState = 'active' | 'revoked' | 'excluded';

/** A resumed/forked provider conversation a new child wants to mirror. */
export interface ResumedConversation {
  readonly conversationId: string;
  readonly lineage: string;
  /** True only when record ordering against the child boundary is provable. */
  readonly ordered: boolean;
}

/** One owner-confirmed project grant covering future sessions and named histories. */
export interface ProjectContentConsent extends CanonicalProjectPolicy {
  readonly state: ProjectConsentState;
  readonly readDenied?: boolean;
  readonly exclusionRevision: number;
  /** Sessions fenced by denial suppression; clearing one needs a fresh amendment. */
  readonly excludedSessionIds: readonly string[];
  /** Set by clearExclusion; derivation stays refused until the next amendment. */
  readonly requiresFreshAmendment: boolean;
  readonly retentionDigest: string;
  readonly acceptedPolicy: CanonicalProjectPolicy;
  readonly activatedAt: number;
  readonly updatedAt: number;
}

export type SessionGrantState = 'active' | 'closed' | 'revoked' | 'excluded' | 'expired';

/** A future child derived from the accepted project proof without a new prompt. */
export interface SessionContentGrant {
  readonly readDenied?: boolean;
  readonly grantId: string;
  readonly projectId: string;
  readonly projectRevision: number;
  readonly sessionId: string;
  readonly bindingId: string;
  readonly bindingVersion: number;
  readonly d1Version: number;
  readonly d1Incarnation: number;
  readonly d1StartSeq: number;
  readonly tenantId: string;
  readonly workspaceId: string;
  readonly ownerId: string;
  readonly sourceGeneration: string;
  readonly sourceTrustVersion: string;
  readonly nativeBoundarySeq: number;
  readonly channels: Record<ContentChannel, boolean>;
  readonly retentionSnapshot: RetentionByChannel;
  readonly state: SessionGrantState;
  readonly version: number;
  readonly lastFreshnessAckAt: number;
  readonly localDenyPending: boolean;
  readonly retainedCopies: boolean;
  readonly createdAt: number;
  readonly updatedAt: number;
}

/** Narrow CAS store; the service never reads without rechecking revisions. */
export type HistoryAuthorizationState = 'active' | 'revoked';

/**
 * Distinct closed-session reading authority. Ceilings record the covered
 * objects' existing immutable deadlines (`null` = no expiry); this grant can
 * never shorten, extend or create a duration.
 */
export interface HistoryReadAuthorization {
  readonly authorizationId: string;
  readonly projectId: string;
  readonly sessionId: string;
  readonly bindingId: string;
  readonly projectRevision: number;
  readonly ceilings: Record<RetainedChannel, number | null>;
  readonly state: HistoryAuthorizationState;
  readonly version: number;
  readonly createdAt: number;
}

/** CAS writes preserve capture and read denial independently under the write
 * lock. Durable adapters enforce these floors in the database as well. */
export interface ContentConsentStore {
  readProject(projectId: string): Promise<ProjectContentConsent | null>;
  writeProject(expectedRevision: number | null, next: ProjectContentConsent): Promise<boolean>;
  readGrant(sessionId: string): Promise<SessionContentGrant | null>;
  writeGrant(expectedVersion: number | null, next: SessionContentGrant): Promise<boolean>;
  listGrants(projectId: string): Promise<SessionContentGrant[]>;
  readHistoryAuthorization(authorizationId: string): Promise<HistoryReadAuthorization | null>;
  writeHistoryAuthorization(expectedVersion: number | null, next: HistoryReadAuthorization): Promise<boolean>;
  projectCount(): number;
}

export const createMemoryContentConsentStore = (): ContentConsentStore => {
  const projects = new Map<string, ProjectContentConsent>();
  const grants = new Map<string, SessionContentGrant>();
  const historyAuthorizations = new Map<string, HistoryReadAuthorization>();
  return {
    async readProject(projectId: string) { return projects.get(projectId) ?? null; },
    async writeProject(expectedRevision: number | null, next: ProjectContentConsent) {
      const existing = projects.get(next.projectId) ?? null;
      if (expectedRevision === null) {
        if (existing) return false;
      } else if (!existing || existing.projectRevision !== expectedRevision) return false;
      projects.set(next.projectId, { ...next,
        state: existing && existing.state !== 'active' && next.state !== 'revoked' ? existing.state : next.state,
        excludedSessionIds: existing && !(next.requiresFreshAmendment && next.exclusionRevision > existing.exclusionRevision)
          ? [...new Set([...existing.excludedSessionIds, ...next.excludedSessionIds])] : next.excludedSessionIds,
        exclusionRevision: Math.max(existing?.exclusionRevision ?? 0, next.exclusionRevision),
        requiresFreshAmendment: next.requiresFreshAmendment || (existing?.requiresFreshAmendment === true
          && (next.projectRevision <= existing.projectRevision || next.exclusionRevision !== existing.exclusionRevision)),
        readDenied: existing?.readDenied === true || existing?.state === 'revoked'
          || next.readDenied === true || next.state === 'revoked',
      });
      return true;
    },
    async readGrant(sessionId: string) { return grants.get(sessionId) ?? null; },
    async writeGrant(expectedVersion: number | null, next: SessionContentGrant) {
      const existing = grants.get(next.sessionId) ?? null;
      const project = projects.get(next.projectId);
      const admitsCapture = !existing || next.grantId !== existing.grantId || next.projectRevision !== existing.projectRevision;
      if (admitsCapture && next.state === 'active' && (!project || project.state !== 'active' || project.requiresFreshAmendment
        || project.excludedSessionIds.includes(next.sessionId) || project.projectRevision !== next.projectRevision)) return false;
      if (expectedVersion === null) {
        if (existing) return false;
      } else if (!existing || existing.version !== expectedVersion) return false;
      // Only a new binding/child, with the required confirmed amendment after
      // revocation/exclusion, can establish new capture authority.
      const replacement = existing && next.grantId !== existing.grantId && next.bindingId !== existing.bindingId
        && (existing.state === 'closed' || next.projectRevision > existing.projectRevision);
      const state = existing && !replacement && next.state !== 'revoked'
        && (existing.state === 'revoked' || (existing.state !== 'active' && next.state === 'active'))
        ? existing.state : next.state;
      grants.set(next.sessionId, { ...next,
        state,
        localDenyPending: next.localDenyPending || (existing?.localDenyPending === true && state !== 'revoked'),
        readDenied: existing?.readDenied === true || existing?.state === 'revoked'
          || next.readDenied === true || next.state === 'revoked',
      });
      return true;
    },
    async listGrants(projectId: string) {
      return [...grants.values()].filter((grant) => grant.projectId === projectId);
    },
    async readHistoryAuthorization(authorizationId: string) {
      return historyAuthorizations.get(authorizationId) ?? null;
    },
    async writeHistoryAuthorization(expectedVersion: number | null, next: HistoryReadAuthorization) {
      const existing = historyAuthorizations.get(next.authorizationId) ?? null;
      if (expectedVersion === null) {
        if (existing) return false;
      } else if (!existing || existing.version !== expectedVersion) return false;
      historyAuthorizations.set(next.authorizationId, { ...next,
        state: existing?.state === 'revoked' ? 'revoked' : next.state,
      });
      return true;
    },
    projectCount() { return projects.size; },
  };
};

export interface ConsentChallenge {
  readonly challengeId: string;
  readonly expiresAt: number;
}

/** One-use short-lived WebAuthn challenge port consumed at project activation. */
export interface ChallengePort {
  issue(ttlMs: number, nowMs: number): ConsentChallenge;
  consume(challengeId: string, nowMs: number): 'ok' | 'unknown' | 'expired' | 'replayed';
}

export interface ProjectPrepareInput {
  readonly projectId: string;
  readonly tenantId: string;
  readonly workspaceId: string;
  readonly workspaceIncarnation: number;
  readonly ownerId: string;
  readonly readers?: readonly string[];
  readonly sourceIdentities: readonly string[];
  readonly sourceTrustVersions: readonly string[];
  readonly channels: Record<ContentChannel, boolean>;
  readonly futureSessions: boolean;
  readonly selectedSessionIds: readonly string[];
  readonly namedHistories: readonly NamedHistoryDescriptor[];
  readonly retentionByChannel: unknown;
  readonly authorityEpoch: string;
  readonly expectedProjectRevision?: number;
}

export interface PreparedProject {
  readonly policy: CanonicalProjectPolicy;
  readonly digest: string;
  readonly challengeId: string;
  readonly challengeExpiresAt: number;
  readonly expectedRevision: number | null;
}

export interface DeriveChildInput {
  readonly projectId: string;
  readonly sessionId: string;
  readonly bindingId: string;
  readonly bindingVersion: number;
  readonly d1Version: number;
  readonly d1Incarnation: number;
  readonly d1StartSeq: number;
  readonly tenantId: string;
  readonly workspaceId: string;
  readonly ownerId: string;
  readonly sessionCreatedAt: number;
  readonly sourceGeneration: string;
  readonly sourceTrustVersion: string;
  readonly nativeStartSeq: number;
  /** Set when the new child locally resumes/forks an older provider conversation. */
  readonly resumedConversation?: ResumedConversation;
}

/** Source acknowledgment refreshing one live child to the amended revision. */
export interface RefreshChildInput {
  readonly projectId: string;
  readonly sessionId: string;
  readonly bindingId: string;
  readonly bindingVersion: number;
  /** P3/m1: the attested D1 version and accepted policy digest — both must
   * match the frozen grant/project values, never overwrite them. */
  readonly d1Version: number;
  readonly policyDigest: string;
  readonly tenantId: string;
  readonly workspaceId: string;
  readonly ownerId: string;
  readonly sessionCreatedAt: number;
  readonly sourceGeneration: string;
  readonly sourceTrustVersion: string;
  readonly nativeBoundarySeq: number;
  readonly expectedProjectRevision: number;
}

/** One native record reference submitted for pre-export boundary filtering. */
export interface NativeRecordRef {
  readonly seq: number;
  readonly lineage: string;
  readonly conversationId: string;
  readonly ordered: boolean;
}

export type WithheldReason = 'pre_boundary' | 'unprovable_range' | 'grant_inactive';

export interface WithheldNativeRecord extends NativeRecordRef {
  readonly reason: WithheldReason;
}

export interface ExportableNativePartition {
  readonly exportable: NativeRecordRef[];
  readonly withheld: WithheldNativeRecord[];
}

const requireId = (value: unknown, field: string): string => {
  if (typeof value !== 'string' || !value.trim()) {
    throw new ContentConsentError('invalid_request', `${field} is required`);
  }
  return value;
};

const requireIdList = (value: unknown, field: string): readonly string[] => {
  if (!Array.isArray(value) || value.length === 0 || value.some((id) => typeof id !== 'string' || !id.trim())) {
    throw new ContentConsentError('invalid_request', `${field} must be a non-empty id list`);
  }
  return value;
};

const validateHistoryDescriptor = (value: unknown): NamedHistoryDescriptor => {
  if (!isRecord(value)) throw new ContentConsentError('invalid_request', 'named history must be an object');
  const descriptor = {
    provider: requireId(value['provider'], 'history.provider'),
    conversationId: requireId(value['conversationId'], 'history.conversationId'),
    lineage: requireId(value['lineage'], 'history.lineage'),
    sourceIdentity: requireId(value['sourceIdentity'], 'history.sourceIdentity'),
    checkpoint: requireId(value['checkpoint'], 'history.checkpoint'),
    rangeDigest: requireId(value['rangeDigest'], 'history.rangeDigest'),
  };
  const startSeq = value['startSeq'];
  const endSeq = value['endSeq'];
  if (startSeq !== undefined || endSeq !== undefined) {
    if (typeof startSeq !== 'number' || typeof endSeq !== 'number'
      || !Number.isSafeInteger(startSeq) || !Number.isSafeInteger(endSeq)
      || startSeq < 0 || endSeq < startSeq) {
      throw new ContentConsentError('invalid_request', 'named history range must be a valid seq interval');
    }
    return { ...descriptor, startSeq, endSeq };
  }
  return descriptor;
};

export const createMemoryChallengePort = (
  newId: () => string = () => crypto.randomUUID(),
): ChallengePort => {
  const issued = new Map<string, number>();
  const consumed = new Set<string>();
  return {
    issue(ttlMs: number, nowMs: number) {
      const challenge = { challengeId: newId(), expiresAt: nowMs + ttlMs };
      issued.set(challenge.challengeId, challenge.expiresAt);
      return challenge;
    },
    consume(challengeId: string, nowMs: number) {
      if (consumed.has(challengeId)) return 'replayed';
      const expiresAt = issued.get(challengeId);
      if (expiresAt === undefined) return 'unknown';
      if (nowMs > expiresAt) return 'expired';
      consumed.add(challengeId);
      return 'ok';
    },
  };
};

export interface ContentConsentServiceOptions {
  readonly nowMs?: () => number;
  readonly newId?: () => string;
  readonly challengeTtlMs?: number;
  readonly challenges?: ChallengePort;
}

const DEFAULT_CHALLENGE_TTL_MS = 5 * 60_000;

/**
 * Immutable capture deadline for one retained object: `{ mode: 'none' }`
 * never ages out (`null`); a duration is bound once at capture and no later
 * read, upload, reconnect or config change extends it.
 */
export const captureExpiresAt = (retention: RetentionPolicy, capturedAt: number): number | null =>
  retention.mode === 'none' ? null : capturedAt + retention.durationSeconds * 1000;

/**
 * Live/control liveness against a fake-clock-friendly `nowMs`. A grant whose
 * last source freshness acknowledgement is older than `maxStaleMs` is
 * `live_expired`; a `nowMs` running behind the last acknowledgement beyond
 * `maxSkewMs` is `lease_skew_exceeded`. Stored-copy reads are unaffected.
 */
export const checkGrantLiveness = (
  grant: SessionContentGrant,
  nowMs: number,
  maxStaleMs: number,
  maxSkewMs = maxStaleMs,
): void => {
  if (nowMs < grant.lastFreshnessAckAt - maxSkewMs) {
    throw new ContentConsentError('lease_skew_exceeded', 'grant clock runs behind its freshness acknowledgement');
  }
  if (nowMs - grant.lastFreshnessAckAt > maxStaleMs) {
    throw new ContentConsentError('live_expired', 'grant source freshness expired');
  }
};

/** A grant only ever authorizes its own binding; nothing crosses bindings. */
export const isGrantValidForBinding = (
  grant: SessionContentGrant,
  bindingId: string,
): boolean => grant.bindingId === bindingId;

/**
 * Pre-export native boundary filter (CM2-R4-4). Only complete records at or
 * after the child's authenticated consent boundary copy, plus exact
 * lineage/range coverage already named in the accepted project revision.
 * Everything older, unordered or unprovable is withheld with zero bytes.
 */
export const partitionExportableNativeRecords = (
  grant: SessionContentGrant,
  project: ProjectContentConsent,
  records: readonly NativeRecordRef[],
): ExportableNativePartition => {
  const exportable: NativeRecordRef[] = [];
  const withheld: WithheldNativeRecord[] = [];
  for (const record of records) {
    if (grant.state !== 'active' || grant.localDenyPending || project.state !== 'active'
      || project.projectId !== grant.projectId || project.ownerId !== grant.ownerId || project.tenantId !== grant.tenantId
      || project.projectRevision !== grant.projectRevision || project.requiresFreshAmendment
      || project.excludedSessionIds.includes(grant.sessionId)
      || !grant.channels['native.mirror'] || !project.channels['native.mirror']) {
      withheld.push({ ...record, reason: 'grant_inactive' });
      continue;
    }
    if (!record.ordered) {
      withheld.push({ ...record, reason: 'unprovable_range' });
      continue;
    }
    if (record.seq >= grant.nativeBoundarySeq) {
      exportable.push(record);
      continue;
    }
    const named = project.namedHistories.find(
      (history) => history.conversationId === record.conversationId && history.lineage === record.lineage,
    );
    const covered = named !== undefined
      && named.startSeq !== undefined
      && named.endSeq !== undefined
      && record.seq >= named.startSeq
      && record.seq <= named.endSeq;
    if (covered) exportable.push(record);
    else withheld.push({ ...record, reason: 'pre_boundary' });
  }
  return { exportable, withheld };
};

export const createContentConsentService = (
  store: ContentConsentStore,
  options: ContentConsentServiceOptions = {},
) => {
  const nowMs = options.nowMs ?? (() => Date.now());
  const newId = options.newId ?? (() => crypto.randomUUID());
  const challenges = options.challenges ?? createMemoryChallengePort(newId);
  const challengeTtlMs = options.challengeTtlMs ?? DEFAULT_CHALLENGE_TTL_MS;

  const prepareProject = (input: ProjectPrepareInput): PreparedProject => {
    const projectId = requireId(input.projectId, 'projectId');
    const tenantId = requireId(input.tenantId, 'tenantId');
    const workspaceId = requireId(input.workspaceId, 'workspaceId');
    const ownerId = requireId(input.ownerId, 'ownerId');
    const readers = input.readers ?? [ownerId];
    if (readers.length !== 1 || readers[0] !== ownerId) {
      throw new ContentConsentError('cross_owner_refused', 'project readers are owner-only');
    }
    if (typeof input.workspaceIncarnation !== 'number' || !Number.isSafeInteger(input.workspaceIncarnation)) {
      throw new ContentConsentError('invalid_request', 'workspaceIncarnation must be a safe integer');
    }
    const channels = { ...input.channels } as Record<ContentChannel, boolean>;
    for (const channel of CONTENT_CHANNELS) {
      if (typeof channels[channel] !== 'boolean') {
        throw new ContentConsentError('invalid_request', `channel ${channel} must be a boolean`);
      }
    }
    if (typeof input.futureSessions !== 'boolean') {
      throw new ContentConsentError('invalid_request', 'futureSessions must be a boolean');
    }
    if (!Array.isArray(input.selectedSessionIds)
      || input.selectedSessionIds.some((id) => typeof id !== 'string' || !id.trim())) {
      throw new ContentConsentError('invalid_request', 'selectedSessionIds must be an id list');
    }
    if (!Array.isArray(input.namedHistories)) {
      throw new ContentConsentError('invalid_request', 'namedHistories must be a list');
    }
    const policy: CanonicalProjectPolicy = {
      projectId,
      projectRevision: input.expectedProjectRevision ?? 0,
      tenantId,
      workspaceId,
      workspaceIncarnation: input.workspaceIncarnation,
      ownerId,
      readers: [...readers],
      sourceIdentities: [...requireIdList(input.sourceIdentities, 'sourceIdentities')],
      sourceTrustVersions: [...requireIdList(input.sourceTrustVersions, 'sourceTrustVersions')],
      channels,
      futureSessions: input.futureSessions,
      selectedSessionIds: [...input.selectedSessionIds],
      namedHistories: input.namedHistories.map(validateHistoryDescriptor),
      retentionByChannel: validateRetentionByChannel(input.retentionByChannel),
      authorityEpoch: requireId(input.authorityEpoch, 'authorityEpoch'),
    };
    const challenge = challenges.issue(challengeTtlMs, nowMs());
    return {
      policy,
      digest: computePolicyDigest(policy),
      challengeId: challenge.challengeId,
      challengeExpiresAt: challenge.expiresAt,
      expectedRevision: input.expectedProjectRevision ?? null,
    };
  };

  const acceptProject = async (
    prepared: PreparedProject,
    proof: { readonly challengeId: string },
  ): Promise<ProjectContentConsent> => {
    if (computePolicyDigest(prepared.policy) !== prepared.digest) {
      throw new ContentConsentError('policy_digest_mismatch', 'prepared policy was altered after preparation');
    }
    if (proof.challengeId !== prepared.challengeId) {
      throw new ContentConsentError('challenge_unknown', 'proof does not match this preparation');
    }
    const consumed = challenges.consume(prepared.challengeId, nowMs());
    if (consumed === 'replayed') throw new ContentConsentError('challenge_replayed', 'challenge already used');
    if (consumed === 'expired') throw new ContentConsentError('challenge_expired', 'challenge expired');
    if (consumed === 'unknown') throw new ContentConsentError('challenge_unknown', 'unknown challenge');
    const timestamp = nowMs();
    if (prepared.expectedRevision === null) {
      const next: ProjectContentConsent = {
        ...prepared.policy,
        projectRevision: 1,
        state: 'active',
        exclusionRevision: 0,
        excludedSessionIds: [],
        requiresFreshAmendment: false,
        retentionDigest: prepared.digest,
        acceptedPolicy: prepared.policy,
        activatedAt: timestamp,
        updatedAt: timestamp,
      };
      if (!await store.writeProject(null, next)) {
        throw new ContentConsentError('revision_conflict', 'project already exists');
      }
      return (await store.readProject(next.projectId))!;
    }
    const existing = await store.readProject(prepared.policy.projectId);
    if (!existing) throw new ContentConsentError('project_not_found', 'no project to amend');
    if (existing.tenantId !== prepared.policy.tenantId || existing.ownerId !== prepared.policy.ownerId
      || existing.workspaceId !== prepared.policy.workspaceId
      || existing.workspaceIncarnation !== prepared.policy.workspaceIncarnation) {
      throw new ContentConsentError('cross_owner_refused', 'existing project has a different immutable scope');
    }
    if (existing.state !== 'active') throw new ContentConsentError('project_not_active', 'project is not active');
    if (existing.projectRevision !== prepared.expectedRevision) {
      throw new ContentConsentError('revision_conflict', 'project revision changed; re-prepare the amendment');
    }
    const next: ProjectContentConsent = {
      ...prepared.policy,
      projectRevision: existing.projectRevision + 1,
      state: 'active',
      exclusionRevision: existing.exclusionRevision,
      excludedSessionIds: [...existing.excludedSessionIds],
      requiresFreshAmendment: false,
      retentionDigest: prepared.digest,
      acceptedPolicy: prepared.policy,
      activatedAt: existing.activatedAt,
      updatedAt: timestamp,
    };
    if (!await store.writeProject(existing.projectRevision, next)) {
      throw new ContentConsentError('revision_conflict', 'concurrent amendment; re-prepare the amendment');
    }
    return (await store.readProject(next.projectId))!;
  };

  const readProject = (projectId: string): Promise<ProjectContentConsent | null> =>
    store.readProject(projectId);

  const readActiveProject = async (projectId: string): Promise<ProjectContentConsent> => {
    const project = await store.readProject(projectId);
    if (!project) throw new ContentConsentError('project_not_active', 'no active project grant');
    if (project.state === 'revoked') throw new ContentConsentError('project_revoked', 'project grant revoked');
    if (project.state === 'excluded') throw new ContentConsentError('project_excluded', 'project grant excluded');
    return project;
  };

  /**
   * Derive one eligible future/selected child from the durable accepted
   * project proof with no new human prompt, binding its new D1
   * version/incarnation/start sequence and freezing its native boundary.
   * Reattachment under a new binding never reuses the old child grant.
   */
  const deriveChild = async (input: DeriveChildInput): Promise<SessionContentGrant> => {
    const projectId = requireId(input.projectId, 'projectId');
    const sessionId = requireId(input.sessionId, 'sessionId');
    const bindingId = requireId(input.bindingId, 'bindingId');
    const project = await readActiveProject(projectId);
    if (input.tenantId !== project.tenantId) {
      throw new ContentConsentError('cross_tenant_refused', 'session tenant does not match project');
    }
    if (input.ownerId !== project.ownerId) {
      throw new ContentConsentError('cross_owner_refused', 'session owner does not match project');
    }
    if (input.workspaceId !== project.workspaceId) {
      throw new ContentConsentError('invalid_request', 'session workspace does not match project');
    }
    if (!project.sourceTrustVersions.includes(input.sourceTrustVersion)) {
      throw new ContentConsentError('source_reauthorization_required', 'source trust version is not enrolled');
    }
    if (project.excludedSessionIds.includes(sessionId)) {
      throw new ContentConsentError('session_excluded', 'session is excluded from this project');
    }
    if (project.requiresFreshAmendment) {
      throw new ContentConsentError('suppressed_scope', 'cleared exclusion needs a fresh scope amendment');
    }
    const existing = await store.readGrant(sessionId);
    if (existing && existing.projectId !== projectId) {
      throw new ContentConsentError('cross_project_refused', 'session already derives from another project');
    }
    if (existing && existing.bindingId === bindingId) {
      if (existing.sourceTrustVersion !== input.sourceTrustVersion
        || existing.sourceGeneration !== input.sourceGeneration) {
        throw new ContentConsentError('source_reauthorization_required', 'source replaced; reauthorize first');
      }
      if (existing.state === 'revoked') throw new ContentConsentError('grant_revoked', 'child grant revoked');
      if (existing.state === 'excluded') throw new ContentConsentError('session_excluded', 'child grant excluded');
      if (existing.state === 'closed') throw new ContentConsentError('grant_closed', 'child grant is closed');
      if (existing.state === 'expired') throw new ContentConsentError('live_expired', 'child grant expired');
      if (existing.localDenyPending) throw new ContentConsentError('grant_revoked', 'local denial pending');
      // N3: a confirmed amendment fences old live capture authority at the
      // parent revision; returning the stale grant is invalid — the caller
      // must acknowledge the refresh explicitly.
      if (existing.projectRevision !== project.projectRevision) {
        throw new ContentConsentError('project_revision_changed', 'capture paused; acknowledge the refresh first');
      }
      return existing;
    }
    if (existing && existing.state !== 'active' && existing.state !== 'closed') {
      const amendedSinceFencing = project.projectRevision > existing.projectRevision;
      if (!(amendedSinceFencing && existing.bindingId !== bindingId)) {
        throw new ContentConsentError('grant_revoked', 'previous child grant is not derivable');
      }
    }
    const selected = project.selectedSessionIds.includes(sessionId);
    const resumed = input.resumedConversation;
    const eligibleFuture = project.futureSessions && input.sessionCreatedAt >= project.activatedAt;
    let nativeBoundarySeq = Math.max(input.d1StartSeq, input.nativeStartSeq);
    if (!selected && !eligibleFuture) {
      if (!resumed) throw new ContentConsentError('ineligible_session', 'session is outside the project scope');
      if (!resumed.ordered) throw new ContentConsentError('unprovable_range', 'resumed range ordering is unprovable');
      const named = project.namedHistories.find(
        (history) => history.conversationId === resumed.conversationId && history.lineage === resumed.lineage,
      );
      if (!named || named.startSeq === undefined) {
        throw new ContentConsentError('not_resumable', 'resumed history lacks exact named coverage');
      }
      nativeBoundarySeq = named.startSeq;
    } else if (resumed && !resumed.ordered) {
      throw new ContentConsentError('unprovable_range', 'resumed range ordering is unprovable');
    }
    const timestamp = nowMs();
    const next: SessionContentGrant = {
      grantId: newId(),
      projectId,
      projectRevision: project.projectRevision,
      sessionId,
      bindingId,
      bindingVersion: input.bindingVersion,
      d1Version: input.d1Version,
      d1Incarnation: input.d1Incarnation,
      d1StartSeq: input.d1StartSeq,
      tenantId: project.tenantId,
      workspaceId: project.workspaceId,
      ownerId: project.ownerId,
      sourceGeneration: input.sourceGeneration,
      sourceTrustVersion: input.sourceTrustVersion,
      nativeBoundarySeq,
      channels: { ...project.channels },
      retentionSnapshot: {
        'terminal.cache': { ...project.retentionByChannel['terminal.cache'] },
        'native.mirror': { ...project.retentionByChannel['native.mirror'] },
      },
      state: 'active',
      version: (existing?.version ?? 0) + 1,
      readDenied: existing?.readDenied === true || existing?.state === 'revoked',
      lastFreshnessAckAt: timestamp,
      localDenyPending: false,
      retainedCopies: existing?.retainedCopies ?? false,
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp,
    };
    if (!await store.writeGrant(existing ? existing.version : null, next)) {
      throw new ContentConsentError('revision_conflict', 'concurrent child derivation; retry derivation');
    }
    return (await store.readGrant(sessionId))!;
  };

  /**
   * N3 post-amendment child refresh: re-evaluate one eligible live child
   * against the amended project and CAS-advance its capture revision,
   * snapshot and boundary. No new human prompt per eligible child after
   * the confirmed project amendment. Duplicate acknowledgments are
   * idempotent; stale ones cannot overwrite a newer revision.
   */
  const refreshChild = async (input: RefreshChildInput): Promise<SessionContentGrant> => {
    const projectId = requireId(input.projectId, 'projectId');
    const sessionId = requireId(input.sessionId, 'sessionId');
    const bindingId = requireId(input.bindingId, 'bindingId');
    const project = await readActiveProject(projectId);
    if (input.tenantId !== project.tenantId) {
      throw new ContentConsentError('cross_tenant_refused', 'session tenant does not match project');
    }
    if (input.ownerId !== project.ownerId) {
      throw new ContentConsentError('cross_owner_refused', 'session owner does not match project');
    }
    if (input.workspaceId !== project.workspaceId) {
      throw new ContentConsentError('invalid_request', 'session workspace does not match project');
    }
    const existing = await store.readGrant(sessionId);
    if (!existing || existing.projectId !== projectId) {
      throw new ContentConsentError('invalid_request', 'no live child grant to refresh');
    }
    if (existing.bindingId !== bindingId) {
      throw new ContentConsentError('invalid_request', 'binding changed; derive anew instead of refreshing');
    }
    if (input.bindingVersion !== existing.bindingVersion) {
      throw new ContentConsentError('ineligible_session', 'binding version changed; a new derivation is required');
    }
    if (existing.state === 'revoked') throw new ContentConsentError('grant_revoked', 'child grant revoked');
    if (existing.state === 'excluded') throw new ContentConsentError('session_excluded', 'child grant excluded');
    if (existing.state === 'closed') throw new ContentConsentError('grant_closed', 'child grant is closed');
    if (existing.state === 'expired') throw new ContentConsentError('live_expired', 'child grant expired');
    if (existing.state !== 'active') throw new ContentConsentError('grant_revoked', 'child grant is not active');
    // m1: an unreconciled local deny pauses capture — reconcile first.
    if (existing.localDenyPending) {
      throw new ContentConsentError('invalid_request', 'unreconciled local deny; reconcile first');
    }
    if (input.expectedProjectRevision !== project.projectRevision) {
      throw new ContentConsentError('revision_conflict', 'acknowledged revision is not current; re-acknowledge');
    }
    if (existing.projectRevision === project.projectRevision) return existing;
    if (project.excludedSessionIds.includes(sessionId)) {
      throw new ContentConsentError('session_excluded', 'session is excluded from this project');
    }
    if (project.requiresFreshAmendment) {
      throw new ContentConsentError('suppressed_scope', 'cleared exclusion needs a fresh scope amendment');
    }
    if (!project.sourceTrustVersions.includes(input.sourceTrustVersion)) {
      throw new ContentConsentError('source_reauthorization_required', 'source trust version is not enrolled');
    }
    // P3/m1: the attested generation, D1 version and accepted digest must
    // equal the frozen values — a replaced source, a changed D1 version or
    // a stale scope needs a new derivation, never a refresh overwrite.
    if (input.sourceGeneration !== existing.sourceGeneration) {
      throw new ContentConsentError('source_reauthorization_required', 'source generation changed; re-derive');
    }
    if (input.d1Version !== existing.d1Version) {
      throw new ContentConsentError('ineligible_session', 'D1 version changed; a new derivation is required');
    }
    if (input.policyDigest !== project.retentionDigest) {
      throw new ContentConsentError('revision_conflict', 'acknowledged scope is not the accepted one');
    }
    // m1: resuming takes only post-boundary bytes.
    if (input.nativeBoundarySeq < existing.nativeBoundarySeq) {
      throw new ContentConsentError('invalid_request', 'acknowledged boundary moved backwards');
    }
    const selected = project.selectedSessionIds.includes(sessionId);
    const eligibleFuture = project.futureSessions && input.sessionCreatedAt >= project.activatedAt;
    if (!selected && !eligibleFuture) {
      throw new ContentConsentError('ineligible_session', 'session is outside the amended project scope');
    }
    if (!Number.isSafeInteger(input.bindingVersion) || input.bindingVersion < 0) {
      throw new ContentConsentError('invalid_request', 'acknowledged binding version must be a safe integer');
    }
    if (!Number.isSafeInteger(input.nativeBoundarySeq) || input.nativeBoundarySeq < 0) {
      throw new ContentConsentError('invalid_request', 'acknowledged boundary must be a safe integer');
    }
    const timestamp = nowMs();
    const next: SessionContentGrant = {
      ...existing,
      projectRevision: project.projectRevision,
      nativeBoundarySeq: input.nativeBoundarySeq,
      channels: { ...project.channels },
      retentionSnapshot: {
        'terminal.cache': { ...project.retentionByChannel['terminal.cache'] },
        'native.mirror': { ...project.retentionByChannel['native.mirror'] },
      },
      version: existing.version + 1,
      lastFreshnessAckAt: timestamp,
      updatedAt: timestamp,
    };
    if (!await store.writeGrant(existing.version, next)) {
      throw new ContentConsentError('revision_conflict', 'concurrent refresh; re-acknowledge');
    }
    return (await store.readGrant(sessionId))!;
  };

  const readGrant = (sessionId: string): Promise<SessionContentGrant | null> =>
    store.readGrant(sessionId);

  const revokeProject = async (projectId: string): Promise<ProjectContentConsent> => {
    const project = await store.readProject(requireId(projectId, 'projectId'));
    if (!project) throw new ContentConsentError('project_not_found', 'no project to revoke');
    const next: ProjectContentConsent = { ...project, state: 'revoked', readDenied: true, updatedAt: nowMs() };
    if (!await store.writeProject(project.projectRevision, next)) {
      throw new ContentConsentError('revision_conflict', 'concurrent project change; retry revocation');
    }
    for (const grant of await store.listGrants(projectId)) {
      if (grant.state === 'active') {
        await store.writeGrant(grant.version, { ...grant, state: 'revoked', updatedAt: nowMs() });
      }
    }
    return (await store.readProject(projectId))!;
  };

  const excludeSession = async (projectId: string, sessionId: string): Promise<ProjectContentConsent> => {
    const project = await readActiveProject(requireId(projectId, 'projectId'));
    const target = requireId(sessionId, 'sessionId');
    const grant = await store.readGrant(target);
    if (grant && (grant.projectId !== projectId || grant.tenantId !== project.tenantId
      || grant.ownerId !== project.ownerId || grant.workspaceId !== project.workspaceId)) {
      throw new ContentConsentError('cross_owner_refused', 'session belongs to another project scope');
    }
    const excludedSessionIds = project.excludedSessionIds.includes(target)
      ? [...project.excludedSessionIds]
      : [...project.excludedSessionIds, target];
    const next: ProjectContentConsent = {
      ...project,
      excludedSessionIds,
      exclusionRevision: project.exclusionRevision + 1,
      updatedAt: nowMs(),
    };
    if (!await store.writeProject(project.projectRevision, next)) {
      throw new ContentConsentError('revision_conflict', 'concurrent project change; retry exclusion');
    }
    if (grant && grant.state === 'active') {
      await store.writeGrant(grant.version, { ...grant, state: 'excluded', updatedAt: nowMs() });
    }
    return (await store.readProject(projectId))!;
  };

  /**
   * Clearing an exclusion cannot silently re-enable the session: derivation
   * stays suppressed until a fresh explicit scope amendment is accepted.
   */
  const clearExclusion = async (projectId: string, sessionId: string): Promise<ProjectContentConsent> => {
    const project = await readActiveProject(requireId(projectId, 'projectId'));
    const target = requireId(sessionId, 'sessionId');
    const next: ProjectContentConsent = {
      ...project,
      excludedSessionIds: project.excludedSessionIds.filter((id) => id !== target),
      exclusionRevision: project.exclusionRevision + 1,
      requiresFreshAmendment: true,
      updatedAt: nowMs(),
    };
    if (!await store.writeProject(project.projectRevision, next)) {
      throw new ContentConsentError('revision_conflict', 'concurrent project change; retry clearing');
    }
    return (await store.readProject(projectId))!;
  };

  const revokeGrant = async (sessionId: string): Promise<SessionContentGrant> => {
    const grant = await store.readGrant(requireId(sessionId, 'sessionId'));
    if (!grant) throw new ContentConsentError('invalid_request', 'no child grant to revoke');
    const next: SessionContentGrant = { ...grant, state: 'revoked', readDenied: true, updatedAt: nowMs() };
    if (!await store.writeGrant(grant.version, next)) {
      throw new ContentConsentError('revision_conflict', 'concurrent grant change; retry revocation');
    }
    return (await store.readGrant(sessionId))!;
  };

  /** End/detach transition: live/controller fenced, committed copies retained. */
  const closeGrant = async (sessionId: string): Promise<SessionContentGrant> => {
    const grant = await store.readGrant(requireId(sessionId, 'sessionId'));
    if (!grant) throw new ContentConsentError('invalid_request', 'no child grant to close');
    if (grant.state !== 'active') throw new ContentConsentError('grant_closed', 'child grant is not active');
    const next: SessionContentGrant = { ...grant, state: 'closed', retainedCopies: true, updatedAt: nowMs() };
    if (!await store.writeGrant(grant.version, next)) {
      throw new ContentConsentError('revision_conflict', 'concurrent grant change; retry closing');
    }
    return (await store.readGrant(sessionId))!;
  };

  /** Record a locally observed denial; applied as revocation on reconnect. */
  const recordLocalDeny = async (sessionId: string): Promise<SessionContentGrant> => {
    const grant = await store.readGrant(requireId(sessionId, 'sessionId'));
    if (!grant) throw new ContentConsentError('invalid_request', 'no child grant for local denial');
    const next: SessionContentGrant = { ...grant, localDenyPending: true, updatedAt: nowMs() };
    if (!await store.writeGrant(grant.version, next)) {
      throw new ContentConsentError('revision_conflict', 'concurrent grant change; retry local denial');
    }
    return (await store.readGrant(sessionId))!;
  };

  /** Reconnect reconciliation: settle the pending local denial without purging copies. */
  const reconcileLocalDeny = async (sessionId: string): Promise<SessionContentGrant> => {
    const grant = await store.readGrant(requireId(sessionId, 'sessionId'));
    if (!grant) throw new ContentConsentError('invalid_request', 'no child grant to reconcile');
    if (!grant.localDenyPending) return grant;
    const next: SessionContentGrant = { ...grant, state: 'revoked', readDenied: true, localDenyPending: false, updatedAt: nowMs() };
    if (!await store.writeGrant(grant.version, next)) {
      throw new ContentConsentError('revision_conflict', 'concurrent grant change; retry reconciliation');
    }
    return (await store.readGrant(sessionId))!;
  };

  const acknowledgeFreshness = async (sessionId: string): Promise<SessionContentGrant> => {
    const grant = await store.readGrant(requireId(sessionId, 'sessionId'));
    if (!grant) throw new ContentConsentError('invalid_request', 'no child grant for freshness');
    const next: SessionContentGrant = { ...grant, lastFreshnessAckAt: nowMs(), updatedAt: nowMs() };
    if (!await store.writeGrant(grant.version, next)) {
      throw new ContentConsentError('revision_conflict', 'concurrent grant change; retry acknowledgement');
    }
    return (await store.readGrant(sessionId))!;
  };

  /**
   * Distinct closed-history authorization over already retained copies.
   * Ceilings must mirror the covered objects' immutable deadlines: a finite
   * ceiling requires a `duration` channel in the accepted project policy, so
   * this authorization can never create a duration.
   */
  const authorizeHistoryRead = async (
    sessionId: string,
    coveredDeadlines: Record<RetainedChannel, number | null>,
  ): Promise<HistoryReadAuthorization> => {
    const target = requireId(sessionId, 'sessionId');
    const grant = await store.readGrant(target);
    if (!grant || !grant.retainedCopies) {
      throw new ContentConsentError('invalid_request', 'no retained closed copies for this session');
    }
    if (grant.readDenied || !['active', 'closed', 'excluded'].includes(grant.state)) {
      throw new ContentConsentError('grant_revoked', 'retained reading is denied');
    }
    const project = await readActiveProject(grant.projectId);
    if (project.readDenied) throw new ContentConsentError('project_revoked', 'retained reading is denied');
    for (const channel of RETAINED_CHANNELS) {
      const deadline = coveredDeadlines[channel];
      if (deadline !== null && !(typeof deadline === 'number' && Number.isSafeInteger(deadline) && deadline > 0)) {
        throw new ContentConsentError('invalid_request', `covered deadline for ${channel} is malformed`);
      }
      if (deadline !== null && project.retentionByChannel[channel].mode !== 'duration') {
        throw new ContentConsentError('invalid_retention', `history authorization cannot create a ${channel} duration`);
      }
    }
    const next: HistoryReadAuthorization = {
      authorizationId: newId(),
      projectId: grant.projectId,
      sessionId: target,
      bindingId: grant.bindingId,
      projectRevision: project.projectRevision,
      ceilings: { ...coveredDeadlines },
      state: 'active',
      version: 1,
      createdAt: nowMs(),
    };
    if (!await store.writeHistoryAuthorization(null, next)) {
      throw new ContentConsentError('revision_conflict', 'concurrent authorization; retry');
    }
    return next;
  };

  const revokeHistoryAuthorization = async (authorizationId: string): Promise<HistoryReadAuthorization> => {
    const authorization = await store.readHistoryAuthorization(requireId(authorizationId, 'authorizationId'));
    if (!authorization) throw new ContentConsentError('invalid_request', 'no history authorization to revoke');
    const next: HistoryReadAuthorization = { ...authorization, state: 'revoked' };
    if (!await store.writeHistoryAuthorization(authorization.version, next)) {
      throw new ContentConsentError('revision_conflict', 'concurrent authorization change; retry revocation');
    }
    return next;
  };

  /** Closed copies are readable only through a distinct active history authority. */
  const canReadClosed = async (sessionId: string, authorizationId: string): Promise<boolean> => {
    const grant = await store.readGrant(sessionId);
    if (!grant || !grant.retainedCopies || grant.readDenied
      || !['active', 'closed', 'excluded'].includes(grant.state)) return false;
    const project = await store.readProject(grant.projectId);
    if (!project || project.state !== 'active' || project.readDenied) return false;
    const authorization = await store.readHistoryAuthorization(authorizationId);
    return authorization !== null
      && authorization.state === 'active'
      && authorization.sessionId === sessionId
      && authorization.bindingId === grant.bindingId
      && authorization.projectId === grant.projectId;
  };

  return {
    prepareProject,
    acceptProject,
    readProject,
    deriveChild,
    refreshChild,
    readGrant,
    revokeProject,
    excludeSession,
    clearExclusion,
    revokeGrant,
    closeGrant,
    recordLocalDeny,
    reconcileLocalDeny,
    acknowledgeFreshness,
    authorizeHistoryRead,
    revokeHistoryAuthorization,
    canReadClosed,
  };
};
