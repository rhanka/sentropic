/**
 * L-5b — publication with intents-first commit (spec-v8 §9).
 *
 * Every commit records a `commit-release` intent before any external object
 * operation, writes blobs under digest-addressed keys, verifies final bytes
 * by read-back (digest first, then size) before the release is marked ready,
 * and CAS-promotes the current pointer. A failed step leaves the intent
 * pending and nothing visible; a lost CAS race is an explicit conflict (the
 * loser's blobs stay addressable orphans for L-5c GC, never a visible
 * release). Repeating a request with the same idempotency key returns the
 * one stored release. State and blob stores are ports; the memory doubles
 * serve unit tests and the Postgres/S3 adapters serve integration.
 */
import { createHash } from 'node:crypto';
import { canonicalManifest, manifestDigest } from '../codecs.js';
import type { JsonValue } from '../contracts.js';
import type { IntentStore } from './object-intents.js';
import type { IdempotencyStore } from './idempotency.js';
import { parseSourceRef, type SourceRef, type SourceStore } from './sources.js';
import { publicationLimits, validatePublicationFiles, type PublicationLimits } from './publication-limits.js';
import type { ArtifactAcl } from './access.js';
import type { ArtifactState } from './lifecycle.js';
import { createPostgresDeletionClaimStore, type RefcountStore } from './gc.js';
import type { CommandIdentity } from './command-identity.js';
import type {
  AuthorizeCommit,
  CommitLockFn,
  FinalizationCoordinator,
  FinalizeRequest,
  FinalizeResult,
  FinalizeTxClient,
} from './commit/types.js';
export { DEFAULT_PUBLICATION_LIMITS, type PublicationLimits } from './publication-limits.js';

export interface ReleaseRecord {
  releaseId: string;
  artifactId: string;
  manifestDigest: string;
  manifest: string;
  state: 'ready';
  createdAt: string;
}

export interface PublicationStateStore {
  putRelease(release: ReleaseRecord): Promise<void>;
  getRelease(releaseId: string): Promise<ReleaseRecord | undefined>;
  getCurrentReleaseId(artifactId: string): Promise<string | undefined>;
  compareAndSwapCurrent(artifactId: string, expected: string | null, next: string): Promise<boolean>;
}

export interface PublicationBlobStore {
  putBlob(key: string, bytes: Uint8Array): Promise<void>;
  getBlob(key: string): Promise<Uint8Array | undefined>;
  /** List keys under a prefix (orphan enumeration for crash recovery/GC). */
  listKeys(prefix: string): Promise<string[]>;
  /** Delete a key (strict: unknown keys fail so callers notice). */
  deleteBlob(key: string): Promise<void>;
}

/** Derive the `sha256:<hex>` digest from a digest-addressed blob key. */
export function blobDigestOfKey(key: string): string {
  const hex = key.split('/').pop() ?? '';
  if (!/^[0-9a-f]{64}$/.test(hex)) throw new Error(`invalid blob key: ${key}`);
  return `sha256:${hex}`;
}

/** In-memory state-store double for unit tests (synchronous CAS). */
export function createMemoryStateStore(): PublicationStateStore {
  const releases = new Map<string, ReleaseRecord>();
  const current = new Map<string, string>();
  return {
    putRelease(release: ReleaseRecord): Promise<void> {
      releases.set(release.releaseId, release);
      return Promise.resolve();
    },
    getRelease(releaseId: string): Promise<ReleaseRecord | undefined> {
      return Promise.resolve(releases.get(releaseId));
    },
    getCurrentReleaseId(artifactId: string): Promise<string | undefined> {
      return Promise.resolve(current.get(artifactId));
    },
    compareAndSwapCurrent(artifactId: string, expected: string | null, next: string): Promise<boolean> {
      const actual = current.get(artifactId) ?? null;
      if (actual !== expected) return Promise.resolve(false);
      current.set(artifactId, next);
      return Promise.resolve(true);
    },
  };
}

/** In-memory blob-store double for unit tests. */
export function createMemoryBlobStore(): PublicationBlobStore {
  const blobs = new Map<string, Uint8Array>();
  const store: PublicationBlobStore = {
    putBlob(key: string, bytes: Uint8Array): Promise<void> {
      blobs.set(key, bytes);
      return Promise.resolve();
    },
    getBlob(key: string): Promise<Uint8Array | undefined> {
      return Promise.resolve(blobs.get(key));
    },
    listKeys(prefix: string): Promise<string[]> {
      return Promise.resolve([...blobs.keys()].filter((key) => key.startsWith(prefix)).sort());
    },
    deleteBlob(key: string): Promise<void> {
      if (!blobs.has(key)) throw new Error(`unknown blob: ${key}`);
      blobs.delete(key);
      return Promise.resolve();
    },
  };
  return store;
}

export interface PublicationFileInput {
  path: string;
  mimeType: string;
  bytes: Uint8Array;
}

export interface PublishInput {
  ownerId: string;
  storageScopeId: string;
  artifactId: string;
  profile: Record<string, JsonValue | undefined>;
  files: PublicationFileInput[];
  source?: SourceRef;
  idempotencyKey?: string;
  /** @deprecated Ignored; the server hashes release metadata and file digests. */
  paramsHash?: string;
}

export interface PublishResult {
  releaseId: string;
  manifest: string;
}

function shaHex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

interface StagedBlob {
  entry: { path: string; digest: string; size: number; mimeType: string };
  key: string;
  bytes: Uint8Array;
}

interface PreparedPublication {
  entries: StagedBlob[];
  digest: string;
  manifest: string;
}

/** Validate-free preparation shared by the split and finalized paths. */
function preparePublication(input: PublishInput): PreparedPublication {
  const entries = input.files.map((file) => {
    const hex = shaHex(file.bytes);
    return {
      entry: { path: file.path, digest: `sha256:${hex}`, size: file.bytes.length, mimeType: file.mimeType },
      key: `artifacts/${input.storageScopeId}/blobs/sha256/${hex}`,
      bytes: file.bytes,
    };
  });
  const body = {
    schemaVersion: 'artifacts/v1',
    artifactId: input.artifactId,
    storageScopeId: input.storageScopeId,
    ownerId: input.ownerId,
    profile: input.profile,
    files: entries.map((e) => e.entry),
  };
  const digest = manifestDigest(body);
  const manifest = canonicalManifest({ ...body, digest });
  return { entries, digest, manifest };
}

/** Read-back verification shared by the split and finalized paths. */
async function verifyStagedBlobs(blobs: PublicationBlobStore, entries: StagedBlob[]): Promise<void> {
  for (const { key, bytes } of entries) {
    const stored = await blobs.getBlob(key);
    if (stored === undefined || shaHex(stored) !== shaHex(bytes)) {
      throw new Error(`publication digest mismatch for ${key}: read-back failed`);
    }
    if (stored.length !== bytes.length) {
      throw new Error(`publication size mismatch for ${key}: read-back failed`);
    }
  }
}

export interface PublicationService {
  readonly limits?: Readonly<PublicationLimits>;
  /** The host source store participates in the idempotent commit when a source is supplied. */
  publish(input: PublishInput, sources?: SourceStore): Promise<PublishResult>;
  getCurrent(artifactId: string): Promise<{ releaseId: string; manifest: string } | undefined>;
  getRelease(releaseId: string): Promise<{ releaseId: string; manifest: string } | undefined>;
}

/** Create a publication service over injected stores (no driver imports). */
export function createPublicationService(deps: {
  state: PublicationStateStore;
  blobs: PublicationBlobStore;
  intents: IntentStore;
  idempotency?: IdempotencyStore;
  limits?: Partial<PublicationLimits>;
}): PublicationService {
  const limits = publicationLimits(deps.limits);
  async function commitOnce(input: PublishInput, prepared: PreparedPublication, sources?: SourceStore): Promise<PublishResult> {
    const releaseId = crypto.randomUUID();
    const { entries, digest, manifest } = prepared;
    const intent = await deps.intents.record('commit-release', {
      artifactId: input.artifactId,
      releaseId,
      manifestDigest: digest,
      blobKeys: entries.map((e) => e.key),
    });
    for (const { key, bytes } of entries) {
      await deps.blobs.putBlob(key, bytes);
    }
    await verifyStagedBlobs(deps.blobs, entries);
    await deps.state.putRelease({
      releaseId,
      artifactId: input.artifactId,
      manifestDigest: digest,
      manifest,
      state: 'ready',
      createdAt: new Date().toISOString(),
    });
    const expected = (await deps.state.getCurrentReleaseId(input.artifactId)) ?? null;
    const won = await deps.state.compareAndSwapCurrent(input.artifactId, expected, releaseId);
    if (!won) {
      await deps.intents.markFailed(intent.intentId, 'commit race lost: explicit conflict');
      throw new Error(`publication conflict for ${input.artifactId}: concurrent commit won`);
    }
    if (input.source !== undefined) await sources!.putSource(input.artifactId, input.source);
    await deps.intents.complete(intent.intentId);
    return { releaseId, manifest };
  }

  return {
    limits,
    async publish(input: PublishInput, sources?: SourceStore): Promise<PublishResult> {
      validatePublicationFiles(input.files, limits);
      const source = input.source === undefined ? undefined : parseSourceRef(input.source);
      if (source !== undefined && sources === undefined) throw new Error('invalid publication: missing source store');
      input = { ...input, source, files: input.files.map((file) => ({ ...file, bytes: new Uint8Array(file.bytes) })) };
      const prepared = preparePublication(input);
      const requestHash = createHash('sha256').update(JSON.stringify([prepared.digest, source ?? null])).digest('hex');
      if (input.idempotencyKey !== undefined && deps.idempotency !== undefined) {
        const { result } = await deps.idempotency.execute(
          JSON.stringify(['publish', input.ownerId, input.idempotencyKey]),
          requestHash,
          () => commitOnce(input, prepared, sources),
        );
        return result;
      }
      return commitOnce(input, prepared, sources);
    },
    async getCurrent(artifactId: string): Promise<{ releaseId: string; manifest: string } | undefined> {
      const releaseId = await deps.state.getCurrentReleaseId(artifactId);
      if (releaseId === undefined) return undefined;
      const release = await deps.state.getRelease(releaseId);
      if (release === undefined) return undefined;
      return { releaseId: release.releaseId, manifest: release.manifest };
    },
    async getRelease(releaseId: string): Promise<{ releaseId: string; manifest: string } | undefined> {
      const release = await deps.state.getRelease(releaseId);
      if (release === undefined) return undefined;
      return { releaseId: release.releaseId, manifest: release.manifest };
    },
  };
}

/**
 * L4 (immo #861) — guarded publication through the L3 atomic finalization
 * unit (spec r2 A3–A6).
 *
 * Blob bytes are staged and read-back-verified in preparation (no key lock
 * or leased connection spans S3 I/O). The unit then runs caller lifecycle /
 * ACL / pointer locks, provisional release + pointer + refcount writes, the
 * host guard after all waits (lifecycle-active + owner ACL + participant
 * approval), a single success insert with intent completion, and one COMMIT.
 * Denial or conflict rolls everything back: no release, pointer, receipt or
 * (transactional) refcount residue. Same caller key replays the winner.
 */

export type PublishDenialReason = 'denied' | 'revoked' | 'invalid_object';

export interface PublishAuthorizationInput {
  readonly lifecycleState: ArtifactState;
  readonly acl: ArtifactAcl | undefined;
  readonly actorId: string;
}

/**
 * Pure lifecycle/ACL predicate evaluated after the unit waits with fresh
 * reads. Owner-only publication: lifecycle mutations are owner-only across
 * the service, and grant-based publish rights stay a host/L5 decision.
 */
export function decidePublishAuthorization(
  input: PublishAuthorizationInput,
): { allowed: true } | { allowed: false; reason: PublishDenialReason } {
  if (input.lifecycleState === 'withdrawn') return { allowed: false, reason: 'revoked' };
  if (input.lifecycleState === 'deleted' || input.lifecycleState === 'purged') {
    return { allowed: false, reason: 'invalid_object' };
  }
  if (input.lifecycleState !== 'active') return { allowed: false, reason: 'revoked' };
  if (input.acl === undefined || input.acl.ownerId !== input.actorId) {
    return { allowed: false, reason: 'denied' };
  }
  return { allowed: true };
}

/** Transaction-scoped provisional writers for the finalized unit. */
export interface PublicationUnitWriter {
  readAuthorization(artifactId: string): Promise<{ state: ArtifactState; acl: ArtifactAcl | undefined }>;
  putSource(artifactId: string, source: SourceRef): Promise<void>;
  putRelease(release: ReleaseRecord): Promise<void>;
  registerBlob(storageScopeId: string, digest: string, size: number): Promise<void>;
  promoteCurrentLatestWins(artifactId: string, releaseId: string): Promise<void>;
  addReleaseRef(digest: string, holder: string): Promise<void>;
  completeIntent(intentId: string): Promise<void>;
}

/** PostgreSQL unit writer over the coordinator's leased client. */
export function createPostgresPublicationUnitWriter(client: FinalizeTxClient): PublicationUnitWriter {
  return {
    async readAuthorization(artifactId: string) {
      const { rows } = await client.query<{ lifecycle_state: ArtifactState; owner_id: string }>(
        'SELECT lifecycle_state, owner_id FROM artifacts.artifacts WHERE id = $1', [artifactId],
      );
      const row = rows[0];
      return { state: row?.lifecycle_state ?? 'purged' as ArtifactState,
        acl: row === undefined ? undefined : { ownerId: row.owner_id, grants: [], isPublic: false,
          withdrawn: row.lifecycle_state === 'withdrawn' } };
    },
    async putSource(artifactId: string, source: SourceRef): Promise<void> {
      await client.query(
        `INSERT INTO artifacts.artifact_sources (artifact_id, kind, commit_tx, steps)
         VALUES ($1, $2, $3, $4::jsonb) ON CONFLICT (artifact_id) DO UPDATE
         SET kind = EXCLUDED.kind, commit_tx = EXCLUDED.commit_tx, steps = EXCLUDED.steps`,
        [artifactId, source.kind, source.kind === 'base-commit' ? source.commit : null,
          source.kind === 'recipe' ? JSON.stringify(source.steps) : null],
      );
    },
    async putRelease(release: ReleaseRecord): Promise<void> {
      await client.query(
        `INSERT INTO artifacts.releases (id, artifact_id, manifest_digest, manifest, state, created_at)
         VALUES ($1, $2, $3, $4, 'ready', $5)`,
        [release.releaseId, release.artifactId, release.manifestDigest, release.manifest, release.createdAt],
      );
    },
    async registerBlob(storageScopeId: string, digest: string, size: number): Promise<void> {
      await client.query(
        `INSERT INTO artifacts.blobs (storage_scope_id, digest, size)
         VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
        [storageScopeId, digest, size],
      );
    },
    async promoteCurrentLatestWins(artifactId: string, releaseId: string): Promise<void> {
      // CR-3 latest-wins: last committer wins the pointer, no loser conflict.
      await client.query(
        `INSERT INTO artifacts.artifact_current (artifact_id, release_id)
         VALUES ($1, $2) ON CONFLICT (artifact_id) DO UPDATE SET release_id = EXCLUDED.release_id`,
        [artifactId, releaseId],
      );
    },
    async addReleaseRef(digest: string, holder: string): Promise<void> {
      await createPostgresDeletionClaimStore(client).withDigestLock(digest, async (claims) => {
        if (await claims.isClaimed(digest)) throw new Error(`blob scheduled for deletion: ${digest}`);
        await client.query(
          `INSERT INTO artifacts.blob_ref_holders (digest, holder)
           VALUES ($1, $2) ON CONFLICT DO NOTHING`,
          [digest, holder],
        );
      });
    },
    async completeIntent(intentId: string): Promise<void> {
      await client.query(
        `UPDATE artifacts.object_intents SET state = 'done', updated_at = now() WHERE id = $1`,
        [intentId],
      );
    },
  };
}

export interface GuardedPublishInput extends PublishInput {
  /** Frozen trusted identity supplied by the host's L1 command normalizer. */
  readonly identity: CommandIdentity;
  readonly actorId: string;
  readonly policyRevision: string;
  readonly callerKey?: string;
  readonly attemptId?: string;
  readonly invocationId?: string;
}

export interface GuardedPublicationDeps {
  readonly coordinator: FinalizationCoordinator;
  readonly blobs: PublicationBlobStore;
  readonly intents: IntentStore;
  readonly createUnitWriter: (client: FinalizeTxClient) => PublicationUnitWriter;
  /** Host row locks in PARTICIPANT_LOCK_ORDER classes (PG FOR UPDATE; empty for memory). */
  readonly locks?: Partial<Record<'artifact-lifecycle' | 'acl' | 'current-pointer', CommitLockFn[]>>;
  /** Shared retention store: preparation pins and denial compensation. */
  readonly refs: RefcountStore;
  readonly noteAbandoned?: (attemptId: string) => void | Promise<void>;
  readonly cleanupWindowMs?: number;
  readonly limits?: Partial<PublicationLimits>;
}

export interface GuardedPublicationService {
  publishFinalized(input: GuardedPublishInput): Promise<FinalizeResult>;
}

const DEFAULT_CLEANUP_WINDOW_MS = 15 * 60 * 1000;

/** Create a publication service whose commits finalize through L3 ports. */
export function createGuardedPublicationService(deps: GuardedPublicationDeps): GuardedPublicationService {
  const limits = publicationLimits(deps.limits);
  const guard = (client: () => FinalizeTxClient): AuthorizeCommit => async (context, transaction) => {
    const { state, acl } = await deps.createUnitWriter(client()).readAuthorization(context.artifactId);
    const verdict = decidePublishAuthorization({ lifecycleState: state, acl, actorId: context.actorId });
    if (!verdict.allowed) {
      return {
        allowed: false,
        reason: verdict.reason,
        publicCode: 'access_denied',
        status: 403,
        retriable: false,
      };
    }
    const approval = await transaction.participant.checkApproval({
      actorId: context.actorId,
      operation: context.operation,
    });
    if (!approval.approved) {
      return {
        allowed: false,
        reason: approval.reason ?? 'denied',
        publicCode: 'access_denied',
        status: 403,
        retriable: false,
      };
    }
    const revision = await transaction.participant.readRevision();
    if (revision !== context.policyRevision) {
      return {
        allowed: false,
        reason: 'revoked',
        publicCode: 'access_denied',
        status: 403,
        retriable: false,
      };
    }
    return { allowed: true, fence: transaction.participant.mintFence(revision, context.invocationId) };
  };

  return {
    async publishFinalized(input: GuardedPublishInput): Promise<FinalizeResult> {
      validatePublicationFiles(input.files, limits);
      const prepared = preparePublication(input);
      const { internalKey, commandHash, codecVersion } = input.identity;
      const callerKey = input.callerKey ?? internalKey;
      const releaseId = crypto.randomUUID();
      const nowMs = Date.now();
      const intent = await deps.intents.record('commit-release', {
        artifactId: input.artifactId,
        releaseId,
        manifestDigest: prepared.digest,
        blobKeys: prepared.entries.map((e) => e.key),
        attemptId: input.attemptId ?? callerKey,
        operation: 'publish',
        cleanupDeadlineMs: nowMs + (deps.cleanupWindowMs ?? DEFAULT_CLEANUP_WINDOW_MS),
      });
      const pinned: string[] = [];
      const pinReason = `preparation:${releaseId}`;
      let preservePins = false;
      try {
      for (const digest of [...new Set(prepared.entries.map((entry) => entry.entry.digest))].sort()) {
        await deps.refs.pin(digest, pinReason);
        pinned.push(digest);
      }
      for (const { key, bytes } of prepared.entries) {
        await deps.blobs.putBlob(key, bytes);
      }
      await verifyStagedBlobs(deps.blobs, prepared.entries);
      const addedRefs: string[] = [];
      const source = input.source === undefined ? undefined : parseSourceRef(input.source);
      let finalizationClient: FinalizeTxClient | undefined;
      const request: FinalizeRequest = {
        scopeId: input.storageScopeId,
        internalKey,
        commandHash,
        codecVersion,
        invocationId: input.invocationId ?? crypto.randomUUID(),
        actorId: input.actorId,
        operation: 'publish',
        artifactId: input.artifactId,
        bindingName: null,
        policyRevision: input.policyRevision,
        locks: { ...deps.locks, 'artifact-lifecycle': [
          async (client) => { finalizationClient = client; },
          ...(deps.locks?.['artifact-lifecycle'] ?? []),
        ] },
        provisional: async (client) => {
          const unit = deps.createUnitWriter(client);
          await unit.putRelease({
            releaseId,
            artifactId: input.artifactId,
            manifestDigest: prepared.digest,
            manifest: prepared.manifest,
            state: 'ready',
            createdAt: new Date(nowMs).toISOString(),
          });
          for (const staged of prepared.entries) {
            await unit.registerBlob(input.storageScopeId, staged.entry.digest, staged.entry.size);
            await unit.addReleaseRef(staged.entry.digest, releaseId);
            addedRefs.push(staged.entry.digest);
          }
          await unit.promoteCurrentLatestWins(input.artifactId, releaseId);
          if (source !== undefined) await unit.putSource(input.artifactId, source);
        },
        guard: guard(() => {
          if (finalizationClient === undefined) throw new Error('publication guard needs the finalization client');
          return finalizationClient;
        }),
        finishIntents: async (client) => {
          await deps.createUnitWriter(client).completeIntent(intent.intentId);
        },
        noteAbandonedAttempt:
          deps.noteAbandoned === undefined
            ? undefined
            : async (attemptId: string) => {
                await deps.noteAbandoned?.(attemptId);
              },
        attemptId: input.attemptId ?? callerKey,
        receiptData: { releaseId, manifest: prepared.manifest },
      };
      preservePins = true;
      const outcome = await deps.coordinator.finalize(request);
      preservePins = !outcome.ok && outcome.failure.commitState === 'unknown';
      if (!outcome.ok && outcome.failure.commitState === 'not_committed') {
        // Best-effort compensation for ref stores outside the unit transaction.
        for (const digest of addedRefs) {
          try {
            await deps.refs.releaseRef(digest, releaseId);
          } catch {
            /* already rolled back or never added */
          }
        }
      }
      return outcome;
      } finally {
        if (!preservePins) {
          for (const digest of pinned) await deps.refs.unpin(digest, pinReason);
        }
      }
    },
  };
}
