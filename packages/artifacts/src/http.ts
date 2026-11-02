/** Selected HTTP control surface over the authorized atomic services. */
import { createHash } from 'node:crypto';
import type { JsonValue } from './contracts.js';
import { parseManifest } from './codecs.js';
import { assertCompiledArtifactsProfile, ArtifactProfileInputError,
  type CompiledArtifactsProfile } from './profile/index.js';
import { createArtifactCommand, type ArtifactKeyDerivationBinding } from './server/command-identity.js';
import { createGuardedEnsureService, type GuardedEnsureHost } from './server/service.js';
import { assertArtifactReplayMigration } from './server/idempotency.js';
import type { KvPort } from './server/ports.js';
import { createGuardedPublicationService, type GuardedPublicationDeps,
  type PublicationService } from './server/publication.js';
import type { ArtifactAcl, ArtifactMetadata, AclStore } from './server/access.js';
import type { LifecycleService } from './server/lifecycle.js';
import { applyEdits, type EditableFile, type EditOperation } from './server/edits.js';
import { CommitQuarantineError, type ArtifactInvocationContext,
  type ArtifactCommitCoordinator, type FinalizeResult } from './server/commit/types.js';
import { ArtifactOperationError, classifyArtifactFailure, type ArtifactOutcome, type ArtifactHostFailureMapper } from './server/failures.js';
import { projectArtifactHttpOutcome } from './server/outcome-projection.js';
export { projectArtifactHttpOutcome } from './server/outcome-projection.js';

export interface HttpRequest {
  method: string;
  path: string;
  body: unknown;
  actorId: string;
  /** Trusted host assertion, never caller authority. */
  storageScopeId?: string;
  /** Optional platform envelope; must equal the tool argument byte for byte. */
  idempotencyKey?: string;
}
export interface HttpResponse { status: number; body: unknown }
/** Stable content-route error codes; private driver messages never leave the host. */
export function errorBody(status: number): { error: string } {
  return { error: ({ 400: 'invalid_request', 401: 'anonymous', 403: 'access_denied',
    404: 'not_found', 409: 'conflict', 410: 'gone', 422: 'verification_failed',
    500: 'internal_error', 503: 'capability_unavailable' } as Record<number, string>)[status] ?? 'internal_error' };
}
export interface HttpAppDeps {
  /** Trusted mapping of host wrapper errors; causes remain private. Also bind on the coordinator. */
  mapHostError?: ArtifactHostFailureMapper;
  profile: CompiledArtifactsProfile;
  coordinator: ArtifactCommitCoordinator;
  derivation: ArtifactKeyDerivationBinding;
  /** Explicit pilot-state inventory reader; supply an empty reader only for a verified fresh store. */
  legacyRecords: Pick<KvPort, 'get'>;
  ensureHost: GuardedEnsureHost;
  publication: Omit<GuardedPublicationDeps, 'coordinator' | 'limits'> & {
    getCurrent: PublicationService['getCurrent'];
    getRelease: PublicationService['getRelease'];
    listReleases: PublicationService['listReleases'];
  };
  acls: AclStore;
  lifecycle: Pick<LifecycleService, 'stateOf' | 'canRead' | 'getReleaseState'>;
  isApprovedAccount?: (principalId: string) => boolean;
  /** One trusted URL policy shared by HTTP and MCP receipts. */
  publicationUrls?: (artifactId: string, releaseId: string) => { stableUrl: string; pinnedUrl: string };
}
export interface ArtifactApp {
  readonly selectedCapabilities: CompiledArtifactsProfile['selectedCapabilities'];
  readonly profileDigest: string;
  execute(request: HttpRequest, invocation: ArtifactInvocationContext): Promise<ArtifactOutcome<HttpResponse>>;
  handle(request: HttpRequest, invocation: ArtifactInvocationContext): Promise<HttpResponse>;
}

/** Retained for consumers describing canonical textual publication inputs. */
export const TEXT_MIME_PATTERN = '^(?:text/[a-z0-9!#$&^_.+-]+|application/(?:javascript|ecmascript|json|xml|[a-z0-9!#$&^_.+-]+\\+(?:json|xml))|image/svg\\+xml)(?![\\s\\S])';
const TEXT_MIME_RE = new RegExp(TEXT_MIME_PATTERN);

function object(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new ArtifactProfileInputError();
  return value as Record<string, unknown>;
}
/** Other mutation surfaces need their own qualification before host activation. */
export function assertArtifactsTransportProfile(value: unknown): asserts value is CompiledArtifactsProfile {
  assertCompiledArtifactsProfile(value);
  const supported = ['artifacts_ensure', 'artifacts_publish', 'artifacts_list', 'artifacts_get',
    'artifacts_list_versions', 'artifacts_get_source', 'artifacts_revert'];
  if (value.selectedCapabilities.some((name) => !supported.includes(name))) {
    throw new Error('unsupported artifacts transport capability');
  }
}

export function createHttpArtifactApp(deps: HttpAppDeps): ArtifactApp {
  assertArtifactsTransportProfile(deps.profile);
  if (typeof deps.coordinator?.finalizePrepared !== 'function' || typeof deps.coordinator.replayPrepared !== 'function') {
    throw new Error('artifacts requires an atomic commit coordinator');
  }
  if (deps.derivation?.algorithm !== deps.profile.rules.keyDerivationAlgorithm) {
    throw new Error('artifacts profile/derivation mismatch');
  }
  if (typeof deps.legacyRecords?.get !== 'function') throw new Error('artifacts requires a legacy record inventory');
  const profile = deps.profile;
  const ensure = createGuardedEnsureService({ profile, coordinator: deps.coordinator,
    derivation: deps.derivation, host: deps.ensureHost });

  async function visible(artifactId: string, invocation: ArtifactInvocationContext,
    action: 'read' | 'source' = 'read'): Promise<ArtifactAcl> {
    const acl = await deps.acls.getArtifactAcl(artifactId);
    if (!acl || acl.storageScopeId !== invocation.storageScopeId) throw new ArtifactOperationError('not_found');
    const state = await deps.lifecycle.stateOf(artifactId);
    if (!deps.lifecycle.canRead({ artifactId, state }, acl, invocation.actorId, action, deps.isApprovedAccount)) {
      throw new ArtifactOperationError('not_found');
    }
    return acl;
  }

  /** Display metadata fields present on validated args (ensure/publish). */
  function metadataOf(normalized: Record<string, JsonValue>): ArtifactMetadata | undefined {
    const meta: ArtifactMetadata = {};
    if (typeof normalized.title === 'string') meta.title = normalized.title;
    if (typeof normalized.description === 'string') meta.description = normalized.description;
    if (typeof normalized.icon === 'string') meta.icon = normalized.icon;
    return Object.keys(meta).length > 0 ? meta : undefined;
  }

  async function storeMetadata(artifactId: string, meta: ArtifactMetadata | undefined): Promise<void> {
    if (meta === undefined) return;
    const acl = await deps.acls.getArtifactAcl(artifactId);
    if (acl === undefined) return;
    await deps.acls.putArtifactAcl(artifactId, { ...acl, metadata: { ...acl.metadata, ...meta } });
  }

  function blobKey(storageScopeId: string, digest: string): string {
    // Manifest digests are `sha256:<hex>`; physical keys are `.../blobs/sha256/<hex>`.
    return `artifacts/${storageScopeId}/blobs/${digest.replace(':', '/')}`;
  }

  interface ManifestFileEntry { path: string; digest: string; size?: number; mimeType: string }

  async function readManifestFiles(manifest: string, storageScopeId: string): Promise<EditableFile[]> {
    const parsed = parseManifest(manifest);
    const entries = (parsed.files as ManifestFileEntry[] | undefined) ?? [];
    const files: EditableFile[] = [];
    for (const entry of entries) {
      const bytes = await deps.publication.blobs.getBlob(blobKey(storageScopeId, entry.digest));
      if (bytes === undefined) throw new ArtifactOperationError('release_unavailable', { release: { reason: 'not_retained' } });
      if (bytes.byteLength !== entry.size || `sha256:${createHash('sha256').update(bytes).digest('hex')}` !== entry.digest) {
        throw new ArtifactOperationError('verification_failed');
      }
      let text: string | undefined;
      if (TEXT_MIME_RE.test(entry.mimeType)) {
        try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { /* Non-UTF-8 is not editable. */ }
      }
      files.push({ path: entry.path, mimeType: entry.mimeType, bytes: new Uint8Array(bytes),
        ...(text === undefined ? {} : { text }) });
    }
    return files;
  }

  /** Apply publish edits to the current release's text files; typed edit_mismatch changes nothing. */
  async function editedFiles(artifactId: string, invocation: ArtifactInvocationContext,
    edits: readonly EditOperation[], expected: string | null | undefined) {
    const current = expected === undefined ? await deps.publication.getCurrent(artifactId)
      : expected === null ? undefined : await deps.publication.getRelease(expected);
    if (current === undefined) {
      if (expected === null || expected === undefined) throw new ArtifactOperationError('release_unavailable', { release: { reason: 'unpublished' } });
      throw new ArtifactOperationError('not_found');
    }
    if (parseManifest(current.manifest).artifactId !== artifactId) throw new ArtifactOperationError('not_found');
    if (await deps.lifecycle.getReleaseState(current.releaseId) === 'purged') {
      throw new ArtifactOperationError('release_unavailable', { release: { reason: 'purged' } });
    }
    const files = await readManifestFiles(current.manifest, invocation.storageScopeId);
    return applyEdits(files, edits).map((file) => ({
      path: file.path, mimeType: file.mimeType,
      bytes: file.text === undefined ? file.bytes : new Uint8Array(Buffer.from(file.text, 'utf8')),
    }));
  }

  async function conflictSource(outcome: ArtifactOutcome<HttpResponse>, normalized: Readonly<Record<string, JsonValue>>,
    invocation: ArtifactInvocationContext): Promise<ArtifactOutcome<HttpResponse>> {
    if (outcome.ok || outcome.failure.kind !== 'operational' || outcome.failure.variant !== 'pointer_conflict') return outcome;
    const artifactId = normalized.artifactId as string;
    await visible(artifactId, invocation, 'source');
    const conflict = outcome.failure.conflict;
    if (!conflict?.currentReleaseId || normalized.edits === undefined) return outcome;
    const release = await deps.publication.getRelease(conflict.currentReleaseId);
    if (!release || await deps.lifecycle.getReleaseState(release.releaseId) === 'purged') return outcome;
    const manifest = parseManifest(release.manifest);
    const paths = new Set((normalized.edits as unknown as EditOperation[]).map(edit => edit.path));
    const entries = manifest.files as unknown as ManifestFileEntry[];
    const files = (await readManifestFiles(release.manifest, invocation.storageScopeId)).filter(file => paths.has(file.path))
      .map(file => ({ path: file.path, mimeType: file.mimeType, size: file.bytes.byteLength,
        digest: entries.find(entry => entry.path === file.path)!.digest,
        ...(file.text === undefined ? { bytes: Array.from(file.bytes) } : { text: file.text }) }));
    await visible(artifactId, invocation, 'source');
    const failure = { ...outcome.failure, conflict: { ...conflict, currentSource: {
      artifactId, releaseId: release.releaseId, digest: conflict.currentDigest, manifest: release.manifest,
      files, sourceRef: null, ...deps.publicationUrls?.(artifactId, release.releaseId),
    } } };
    Object.defineProperty(failure, 'cause', { value: outcome.failure.cause, enumerable: false });
    return { ok: false, failure: Object.freeze(failure) };
  }

  /** Shared guarded-commit response for publish and revert (same commit path, same receipt shape). */
  function commitOutcome(outcome: FinalizeResult,
    artifactId: string, meta: ArtifactMetadata | undefined,
    setCommitState: (state: 'not_committed' | 'committed' | 'unknown') => void) {
    if (!outcome.ok) {
      const failure = { ...outcome.failure, kind: 'operational' as const };
      Object.defineProperty(failure, 'cause', { value: outcome.failure.cause, enumerable: false });
      return { ok: false as const, failure: Object.freeze(failure) };
    }
    setCommitState(outcome.commitState);
    const receipt = object(outcome.result.receipt);
    if (typeof receipt.releaseId !== 'string' || typeof receipt.manifest !== 'string') {
      throw new Error('invalid publication receipt');
    }
    return { ...outcome, result: { status: 201, body: {
      artifactId, releaseId: receipt.releaseId, manifest: receipt.manifest,
      digest: parseManifest(receipt.manifest).digest,
      ...deps.publicationUrls?.(artifactId, receipt.releaseId), ...(receipt.metadata as ArtifactMetadata ?? meta ?? {}),
    } } };
  }

  const app: ArtifactApp = {
    selectedCapabilities: profile.selectedCapabilities,
    profileDigest: profile.profileDigest,
    async execute(request, supplied) {
      let operation = 'unsupported';
      let phase = 'selection';
      let commitState: 'not_committed' | 'committed' | 'unknown' = 'not_committed';
      let invocation = supplied;
      try {
        const capability = profile.capabilityForRoute(request.method, request.path) ??
          (request.method === 'GET' && /^\/meta\/[^/]*$/.test(request.path) &&
            profile.selectedCapabilities.includes('artifacts_get') ? 'artifacts_get' : undefined);
        if (!capability) throw new ArtifactProfileInputError(true);
        operation = capability.slice('artifacts_'.length);
        phase = 'entry';
        if (!supplied || !supplied.invocationId || typeof supplied.authorizeCommit !== 'function') {
          throw new ArtifactProfileInputError();
        }
        invocation = Object.freeze({ ...supplied });
        if (!invocation.actorId) throw new ArtifactOperationError('anonymous');
        if (request.actorId !== invocation.actorId || !invocation.storageScopeId ||
          (request.storageScopeId !== undefined && request.storageScopeId !== invocation.storageScopeId)) {
          throw new ArtifactProfileInputError();
        }
        let args: Record<string, unknown>;
        const getPrefix = capability === 'artifacts_get' ? '/meta/'
          : capability === 'artifacts_list_versions' ? '/versions/'
          : capability === 'artifacts_get_source' ? '/source/' : undefined;
        if (getPrefix !== undefined) {
          if (request.body !== undefined && Object.keys(object(request.body)).length) throw new ArtifactProfileInputError();
          args = { artifactId: request.path.slice(getPrefix.length) };
        } else {
          args = { ...object(request.body ?? {}) };
          if (Object.hasOwn(args, 'storageScopeId')) {
            if (args.storageScopeId !== invocation.storageScopeId) throw new ArtifactProfileInputError();
            delete args.storageScopeId;
          }
        }
        const normalized = profile.validate(capability, args, request.idempotencyKey);
        const command = capability === 'artifacts_ensure' || capability === 'artifacts_publish' ||
          capability === 'artifacts_revert'
          ? createArtifactCommand(profile, capability, args, invocation, deps.derivation, request.idempotencyKey) : undefined;
        if (command) {
          phase = 'migration';
          await assertArtifactReplayMigration(deps.legacyRecords, command, invocation, normalized.idempotencyKey as string);
        }
        phase = 'dispatch';
        if (capability === 'artifacts_ensure') {
          const meta = metadataOf(normalized);
          const outcome = await ensure.ensure(invocation, { ...normalized,
            envelopeKey: request.idempotencyKey } as Parameters<typeof ensure.ensure>[1]);
          if (!outcome.ok) return outcome;
          await storeMetadata(outcome.result.artifactId, meta);
          return { ...outcome, result: { status: 201, body: { ...outcome.result, ...(meta ?? {}) } } };
        }
        if (capability === 'artifacts_publish' || capability === 'artifacts_revert') {
          const artifactId = normalized.artifactId as string;
          const acl = await visible(artifactId, invocation);
          if (acl.ownerId !== invocation.actorId) throw new ArtifactOperationError('access_denied');
          const limits = profile.operations.find((entry) => entry.operation === 'publish')!.limits;
          const publication = createGuardedPublicationService({ ...deps.publication, coordinator: deps.coordinator,
            limits: { maxFiles: limits.publishFilesMax, maxFileBytes: limits.maxDecodedFileBytes,
              maxTotalBytes: limits.maxDecodedTotalBytes } });
          const meta = metadataOf(normalized);
          const input = { ownerId: acl.ownerId, storageScopeId: invocation.storageScopeId, artifactId,
            identity: command!.identity, actorId: invocation.actorId, invocationId: invocation.invocationId,
            attemptId: invocation.invocationId, policyRevision: await deps.ensureHost.readPolicyRevision(),
            authorizeCommit: invocation.authorizeCommit, metadata: meta,
            operation: capability === 'artifacts_revert' ? 'revert' as const : 'publish' as const,
            expectedCurrentReleaseId: normalized.expectedCurrentReleaseId as string | null | undefined };
          const replay = await publication.replayFinalized(input);
          if (replay !== undefined) return commitOutcome(replay, artifactId, meta, state => { commitState = state; });
          let files: { path: string; mimeType: string; bytes: Uint8Array }[];
          let source: { kind: 'inline-original' } | { kind: 'base-commit'; commit: string };
          let releaseProfile: Record<string, JsonValue>;
          if (capability === 'artifacts_publish') {
            files = normalized.edits !== undefined
              ? await editedFiles(artifactId, invocation, normalized.edits as unknown as EditOperation[], input.expectedCurrentReleaseId)
              : (normalized.files as Record<string, JsonValue>[]).map((file) => ({
                path: file.path as string, mimeType: file.mimeType as string, bytes: Uint8Array.from(file.bytes as number[]),
              }));
            if (normalized.edits !== undefined) {
              const { edits: _edits, ...snapshot } = normalized;
              profile.validate(capability, { ...snapshot, files: files.map(file => ({ ...file, bytes: Array.from(file.bytes) })) });
            }
            source = { kind: 'inline-original' };
            releaseProfile = normalized.profile as Record<string, JsonValue>;
          } else {
            const releaseId = normalized.releaseId as string;
            const target = await deps.publication.getRelease(releaseId);
            const targetManifest = target === undefined ? undefined : parseManifest(target.manifest);
            if (target === undefined || targetManifest?.artifactId !== artifactId) {
              throw new ArtifactOperationError('not_found');
            }
            if (await deps.lifecycle.getReleaseState(releaseId) === 'purged') {
              throw new ArtifactOperationError('release_unavailable', { release: { reason: 'purged' } });
            }
            files = (await readManifestFiles(target.manifest, invocation.storageScopeId))
              .map((file) => ({ path: file.path, mimeType: file.mimeType, bytes: file.bytes }));
            source = { kind: 'base-commit', commit: releaseId };
            releaseProfile = (targetManifest.profile ?? {}) as Record<string, JsonValue>;
          }
          const outcome = await publication.publishFinalized({
            ...input, source, profile: releaseProfile, files,
          });
          const committed = commitOutcome(outcome, artifactId, meta, (state) => { commitState = state; });
          return await conflictSource(committed, normalized, invocation);
        }
        if (capability === 'artifacts_get') {
          const artifactId = normalized.artifactId as string;
          const acl = await visible(artifactId, invocation);
          const state = await deps.lifecycle.stateOf(artifactId);
          const current = await deps.publication.getCurrent(artifactId);
          return { ok: true, invocationId: invocation.invocationId, commitState: 'not_committed', replayed: false,
            result: { status: 200, body: { artifactId, ownerId: acl.ownerId, storageScopeId: acl.storageScopeId,
              state, isPublic: acl.isPublic, withdrawn: state === 'withdrawn', currentReleaseId: current?.releaseId,
              ...(acl.metadata !== undefined ? { metadata: acl.metadata } : {}),
              ...(acl.ownerId === invocation.actorId ? { grants: acl.grants } : {}) } } };
        }
        if (capability === 'artifacts_get_source') {
          const artifactId = normalized.artifactId as string;
          await visible(artifactId, invocation, 'source');
          const current = await deps.publication.getCurrent(artifactId);
          if (current === undefined) throw new ArtifactOperationError('not_found');
          const manifest = parseManifest(current.manifest);
          const files = [];
          for (const file of await readManifestFiles(current.manifest, invocation.storageScopeId)) {
            files.push(file.text === undefined
              ? { path: file.path, mimeType: file.mimeType, bytes: Array.from(file.bytes) }
              : { path: file.path, mimeType: file.mimeType, text: file.text });
          }
          return { ok: true, invocationId: invocation.invocationId, commitState: 'not_committed', replayed: false,
            result: { status: 200, body: { artifactId, releaseId: current.releaseId,
              digest: manifest.digest ?? null, files } } };
        }
        if (capability === 'artifacts_list_versions') {
          const artifactId = normalized.artifactId as string;
          await visible(artifactId, invocation);
          const current = await deps.publication.getCurrent(artifactId);
          const releases = [];
          for (const release of await deps.publication.listReleases(artifactId)) {
            const manifest = parseManifest(release.manifest);
            releases.push({ releaseId: release.releaseId, createdAt: release.createdAt,
              author: typeof manifest.ownerId === 'string' ? manifest.ownerId : null,
              state: await deps.lifecycle.getReleaseState(release.releaseId),
              isCurrent: current?.releaseId === release.releaseId,
              digest: release.manifestDigest });
          }
          return { ok: true, invocationId: invocation.invocationId, commitState: 'not_committed', replayed: false,
            result: { status: 200, body: { artifactId, total: releases.length, releases } } };
        }
        const visibleArtifacts: unknown[] = [];
        for (const artifactId of await deps.acls.listArtifactIds()) {
          const acl = await deps.acls.getArtifactAcl(artifactId);
          if (!acl || acl.storageScopeId !== invocation.storageScopeId) continue;
          const state = await deps.lifecycle.stateOf(artifactId);
          if (deps.lifecycle.canRead({ artifactId, state }, acl, invocation.actorId, 'read', deps.isApprovedAccount)) {
            visibleArtifacts.push({ artifactId, ownerId: acl.ownerId, state, isPublic: acl.isPublic,
              ...(acl.metadata !== undefined ? { metadata: acl.metadata } : {}) });
          }
        }
        const offset = normalized.offset as number;
        return { ok: true, invocationId: invocation.invocationId, commitState: 'not_committed', replayed: false,
          result: { status: 200, body: { total: visibleArtifacts.length,
            artifacts: visibleArtifacts.slice(offset, offset + (normalized.limit as number)) } } };
      } catch (cause) {
        const failure = classifyArtifactFailure(cause, { invocationId: invocation?.invocationId ?? '',
          operation, phase, commitState }, (error) => error instanceof ArtifactProfileInputError
            ? new ArtifactOperationError(error.category) : deps.mapHostError?.(error));
        if (cause instanceof CommitQuarantineError) {
          const migration = { ...failure, kind: 'operational' as const, category: 'provider_unavailable' as const,
            variant: 'legacy_quarantine', httpStatus: 503, publicCode: 'capability_unavailable', retriable: false };
          Object.defineProperty(migration, 'cause', { value: cause, enumerable: false });
          return { ok: false, failure: Object.freeze(migration) };
        }
        return { ok: false, failure };
      }
    },
    async handle(request, invocation) {
      return projectArtifactHttpOutcome(await app.execute(request, invocation), profile.requireExpectedCurrentReleaseId === true);
    },
  };
  return Object.freeze(app);
}
