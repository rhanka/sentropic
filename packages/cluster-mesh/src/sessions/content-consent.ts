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
  readonly offlineReadAccepted: true;
}

export type ProjectConsentState = 'active' | 'revoked' | 'excluded';

/** One owner-confirmed project grant covering future sessions and named histories. */
export interface ProjectContentConsent extends CanonicalProjectPolicy {
  readonly state: ProjectConsentState;
  readonly exclusionRevision: number;
  readonly retentionDigest: string;
  readonly acceptedPolicy: CanonicalProjectPolicy;
  readonly activatedAt: number;
  readonly updatedAt: number;
}

export type SessionGrantState = 'active' | 'closed' | 'revoked' | 'excluded' | 'expired';

/** A future child derived from the accepted project proof without a new prompt. */
export interface SessionContentGrant {
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
export interface ContentConsentStore {
  readProject(projectId: string): Promise<ProjectContentConsent | null>;
  writeProject(expectedRevision: number | null, next: ProjectContentConsent): Promise<boolean>;
  readGrant(sessionId: string): Promise<SessionContentGrant | null>;
  writeGrant(expectedVersion: number | null, next: SessionContentGrant): Promise<boolean>;
  listGrants(projectId: string): Promise<SessionContentGrant[]>;
  projectCount(): number;
}

export const createMemoryContentConsentStore = (): ContentConsentStore => {
  const projects = new Map<string, ProjectContentConsent>();
  const grants = new Map<string, SessionContentGrant>();
  return {
    async readProject(projectId: string) { return projects.get(projectId) ?? null; },
    async writeProject(expectedRevision: number | null, next: ProjectContentConsent) {
      const existing = projects.get(next.projectId) ?? null;
      if (expectedRevision === null) {
        if (existing) return false;
      } else if (!existing || existing.projectRevision !== expectedRevision) return false;
      projects.set(next.projectId, next);
      return true;
    },
    async readGrant(sessionId: string) { return grants.get(sessionId) ?? null; },
    async writeGrant(expectedVersion: number | null, next: SessionContentGrant) {
      const existing = grants.get(next.sessionId) ?? null;
      if (expectedVersion === null) {
        if (existing) return false;
      } else if (!existing || existing.version !== expectedVersion) return false;
      grants.set(next.sessionId, next);
      return true;
    },
    async listGrants(projectId: string) {
      return [...grants.values()].filter((grant) => grant.projectId === projectId);
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
  readonly offlineReadAccepted: boolean;
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
    if (input.offlineReadAccepted !== true) {
      throw new ContentConsentError('invalid_request', 'offlineReadAccepted must be explicitly accepted');
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
      offlineReadAccepted: true,
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
        retentionDigest: prepared.digest,
        acceptedPolicy: prepared.policy,
        activatedAt: timestamp,
        updatedAt: timestamp,
      };
      if (!await store.writeProject(null, next)) {
        throw new ContentConsentError('revision_conflict', 'project already exists');
      }
      return next;
    }
    const existing = await store.readProject(prepared.policy.projectId);
    if (!existing) throw new ContentConsentError('project_not_found', 'no project to amend');
    if (existing.state !== 'active') throw new ContentConsentError('project_not_active', 'project is not active');
    if (existing.projectRevision !== prepared.expectedRevision) {
      throw new ContentConsentError('revision_conflict', 'project revision changed; re-prepare the amendment');
    }
    const next: ProjectContentConsent = {
      ...prepared.policy,
      projectRevision: existing.projectRevision + 1,
      state: 'active',
      exclusionRevision: existing.exclusionRevision,
      retentionDigest: prepared.digest,
      acceptedPolicy: prepared.policy,
      activatedAt: existing.activatedAt,
      updatedAt: timestamp,
    };
    if (!await store.writeProject(existing.projectRevision, next)) {
      throw new ContentConsentError('revision_conflict', 'concurrent amendment; re-prepare the amendment');
    }
    return next;
  };

  const readProject = (projectId: string): Promise<ProjectContentConsent | null> =>
    store.readProject(projectId);

  return { prepareProject, acceptProject, readProject };
};
