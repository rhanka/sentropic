/** Selected HTTP control surface over the authorized atomic services. */
import { createHash } from 'node:crypto';
import type { JsonValue } from './contracts.js';
import { parseManifest } from './codecs.js';
import { assertCompiledArtifactsProfile, ArtifactProfileInputError,
  type CompiledArtifactsProfile } from './profile/index.js';
import { createArtifactCommand, type ArtifactKeyDerivationBinding } from './server/command-identity.js';
import { createGuardedEnsureService, type GuardedEnsureHost } from './server/service.js';
import { assertArtifactReplayMigration, type IdempotencyStore } from './server/idempotency.js';
import { combineSharingPolicy, maskEmailHint, resolveSharingPolicy, type KvPort, type PrincipalDirectoryPort,
  type SharingPolicy, type SharingPolicyPort } from './server/ports.js';
import { createGuardedPublicationService,
  type GuardedPublicationDeps, type PublicationService } from './server/publication.js';
import { SERVER_MAX_FILE_BYTES, SERVER_MAX_UPLOAD_SESSIONS_PER_PRINCIPAL } from './server/publication-limits.js';
import { releaseBudget } from './profile/validation.js';
import { commitStagedUpload, createUploadService, STAGED_FILE_TTL_MS, stagedFileExpired,
  type CommitStagedUploadDeps, type StagingStore, type UploadSessionStore,
  type UploadSignerPort } from './server/uploads.js';
import { createHmacUploadPageCookieSigner, createMemoryUploadPageStore, createUploadPageService } from './server/upload-page.js';
import type { ArtifactsMetrics } from './server/metrics.js';
import type { UploadPageStore } from './server/upload-page.js';
import { accessModeOf, evaluateGrant, type ArtifactAcl, type ArtifactMetadata, type AclStore } from './server/access.js';
import { assertConsentScopeId } from './server/consent.js';
import type { ArtifactReaderStore } from './server/reader-store.js';
import type { LifecycleService } from './server/lifecycle.js';
import { applyEdits, type EditableFile, type EditOperation } from './server/edits.js';
import { CommitQuarantineError, type ArtifactInvocationContext,
  type ArtifactCommitCoordinator, type FinalizeResult } from './server/commit/types.js';
import { ArtifactOperationError, classifyArtifactFailure, type ArtifactOutcome, type ArtifactHostFailureMapper } from './server/failures.js';
import { projectArtifactHttpOutcome } from './server/outcome-projection.js';
import { readArtifactSource } from './server/source-read.js';
import { artifactSummary } from './server/summary.js';
import { artifactVersions } from './server/versions.js';
import { manageArtifact, type ManagementUnit, type ArtifactConfirmationPort } from './server/management.js';
import { createPostgresManagementUnit } from './adapters/postgres-management.js';
import type { FinalizeTxClient } from './server/commit/types.js';
import type { SourceStore } from './server/sources.js';
import { TEXT_MIME_RE, validateFileBytes } from './server/mime.js';
import { API_GUIDE_REF } from './server/templates.js';
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
  sources?: Pick<SourceStore, 'getSource'>;
  management?: { createUnit?: (client: FinalizeTxClient) => ManagementUnit; confirmation?: ArtifactConfirmationPort };
  acls: AclStore;
  lifecycle: Pick<LifecycleService, 'stateOf' | 'canRead' | 'getReleaseState'>;
  isApprovedAccount?: (principalId: string) => boolean;
  /** G1 lock 2 (runtime, revocable): sharing policy per scope, resolved fail-closed. */
  sharingPolicy?: SharingPolicyPort;
  /** G1: server-resolved platform admin predicate (never a tool argument). */
  actorIsAdmin?: (actorId: string, storageScopeId: string) => boolean | Promise<boolean>;
  /** G2: host principal directory; required for userRef resolution and output projection. */
  directory?: PrincipalDirectoryPort;
  /** Lot 1a: reader consent store; absent ⇒ consent routes fail closed with `capability_unavailable`. */
  readerConsent?: ArtifactReaderStore;
  /** One trusted URL policy shared by HTTP and MCP receipts: the artifact page and the exact version page. */
  publicationUrls?: (artifactId: string, releaseId: string) => { stableUrl: string; versionUrl: string };
  /** Files parity LOT 1: upload session ports, required when an upload capability is selected. */
  uploads?: {
    sessions: UploadSessionStore;
    staging: StagingStore;
    signer: UploadSignerPort;
    idempotency?: IdempotencyStore;
    /** LOT 2 §D: per-artifact staged TTL (host option, ceiling 7 days) and per-scope staging aggregate. */
    stagedFileTtlMs?: number;
    stagingQuotaBytesPerScope?: number;
    /** LOT 2 §D.3: upload/storage metering; absent ⇒ no-op. */
    metrics?: ArtifactsMetrics;
  };
  /** LOT 2 §A.5: browser upload page host wiring (required when `artifacts_create_upload_page` is selected). */
  uploadPage?: {
    /** Page ledger; absent ⇒ an in-memory ledger (single process only). */
    pages?: UploadPageStore;
    cookieSecret: string | Uint8Array;
    controlOrigin: string;
    pageBaseUrl: string;
    s3Origins: readonly string[];
  };
}
export interface ArtifactApp {
  readonly selectedCapabilities: CompiledArtifactsProfile['selectedCapabilities'];
  readonly profileDigest: string;
  execute(request: HttpRequest, invocation: ArtifactInvocationContext): Promise<ArtifactOutcome<HttpResponse>>;
  handle(request: HttpRequest, invocation: ArtifactInvocationContext): Promise<HttpResponse>;
}

/** Retained for consumers describing canonical textual publication inputs. */
export { TEXT_MIME_PATTERN } from './server/mime.js';

function object(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new ArtifactProfileInputError();
  return value as Record<string, unknown>;
}
/** Other mutation surfaces need their own qualification before host activation. */
export function assertArtifactsTransportProfile(value: unknown): asserts value is CompiledArtifactsProfile {
  assertCompiledArtifactsProfile(value);
  const supported = ['artifacts_ensure', 'artifacts_publish', 'artifacts_list', 'artifacts_get',
    'artifacts_list_versions', 'artifacts_get_source', 'artifacts_revert', 'artifacts_set_access', 'artifacts_delete',
    'artifacts_lookup_people', 'artifacts_list_access',
    'artifacts_create_upload', 'artifacts_commit_upload', 'artifacts_publish_bundle',
    'artifacts_create_upload_page', 'artifacts_list_assets', 'artifacts_publish_bundle_v2',
    'artifacts_revoke_reader_consent'];
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
  if (profile.selectedCapabilities.includes('artifacts_get_source') &&
    (!deps.sources || !deps.publication.getRelease)) throw new Error('artifact source read ports required');
  if (profile.selectedCapabilities.includes('artifacts_delete') && !deps.management?.confirmation) {
    throw new Error('artifact delete confirmation port required');
  }
  // Files parity LOT 1: upload ports are required as soon as one upload capability is selected.
  // list_assets needs only the session ledger (released listing works without staging/signer).
  const uploadCapabilities = ['artifacts_create_upload', 'artifacts_commit_upload', 'artifacts_publish_bundle',
    'artifacts_create_upload_page', 'artifacts_publish_bundle_v2'];
  const needsUploads = uploadCapabilities.some((name) =>
    (profile.selectedCapabilities as readonly string[]).includes(name));
  if (needsUploads && !deps.uploads) throw new Error('artifact upload ports required');
  const budget = releaseBudget(profile);
  const uploadService = deps.uploads === undefined ? undefined : createUploadService(
    { sessions: deps.uploads.sessions, staging: deps.uploads.staging, signer: deps.uploads.signer },
    { maxUploadBytes: Math.min(budget.fileBytesMax, SERVER_MAX_FILE_BYTES),
      maxSessionsPerPrincipal: SERVER_MAX_UPLOAD_SESSIONS_PER_PRINCIPAL,
      ...(deps.uploads.stagedFileTtlMs === undefined ? {} : { stagedFileTtlMs: deps.uploads.stagedFileTtlMs }),
      ...(deps.uploads.stagingQuotaBytesPerScope === undefined ? {}
        : { stagingQuotaBytesPerScope: deps.uploads.stagingQuotaBytesPerScope }),
      ...(deps.uploads.metrics === undefined ? {} : { metrics: deps.uploads.metrics }) });
  // LOT 2 §A: the browser page shares the session ledger, the CAS blobs and
  // the refs with the agent channel, so quotas cover both together.
  if (profile.selectedCapabilities.includes('artifacts_create_upload_page') && deps.uploadPage === undefined) {
    throw new Error('artifacts control plane needs upload page host wiring (uploadPage)');
  }
  const pageService = profile.selectedCapabilities.includes('artifacts_create_upload_page') &&
    uploadService !== undefined ? createUploadPageService({
      pages: deps.uploadPage?.pages ?? createMemoryUploadPageStore(),
      sessions: deps.uploads!.sessions, staging: deps.uploads!.staging, signer: deps.uploads!.signer,
      blobs: deps.publication.blobs, refs: deps.publication.refs,
      ...(deps.uploads!.idempotency === undefined ? {} : { idempotency: deps.uploads!.idempotency }),
      cookieSigner: createHmacUploadPageCookieSigner({ secret: deps.uploadPage!.cookieSecret }),
      controlOrigin: deps.uploadPage!.controlOrigin, pageBaseUrl: deps.uploadPage!.pageBaseUrl,
      s3Origins: deps.uploadPage!.s3Origins,
      profile: { maxFiles: budget.filesMax, maxFileBytes: budget.fileBytesMax,
        maxTotalBytes: budget.totalBytesMax, mimeTypes: profile.rules.mimeTypes,
        pathMaxBytes: profile.rules.pathMaxBytes },
      budget: { filesMax: budget.filesMax, totalBytesMax: budget.totalBytesMax },
      ...(deps.uploads!.stagingQuotaBytesPerScope === undefined ? {}
        : { stagingQuotaBytesPerScope: deps.uploads!.stagingQuotaBytesPerScope }),
      ...(deps.uploads!.metrics === undefined ? {} : { metrics: deps.uploads!.metrics }),
    }) : undefined;
  const stagedFileTtlMs = deps.uploads?.stagedFileTtlMs ?? STAGED_FILE_TTL_MS;
  const ensure = createGuardedEnsureService({ profile, coordinator: deps.coordinator,
    derivation: deps.derivation, host: {
      lockBinding: (client, binding) => deps.ensureHost.lockBinding(client, binding),
      abandonAttempt: id => deps.ensureHost.abandonAttempt(id),
      readPolicyRevision: () => deps.ensureHost.readPolicyRevision(),
      async resolveBinding(client, binding) {
        const receipt = await deps.ensureHost.resolveBinding(client, binding);
        if (receipt.created && binding.metadata) {
          await deps.publication.createUnitWriter(client).updateMetadata(receipt.artifactId, binding.metadata);
        }
        return receipt;
      },
    } });

  /** G1 double lock: profile capability (lock 1) AND runtime port (lock 2), fail-closed. */
  async function sharingPolicyContext(storageScopeId: string): Promise<SharingPolicy> {
    return combineSharingPolicy(profile.rules.allowPublicSharing,
      await resolveSharingPolicy(deps.sharingPolicy, storageScopeId));
  }

  async function visible(artifactId: string, invocation: ArtifactInvocationContext,
    action: 'read' | 'source' | true = 'read'): Promise<ArtifactAcl> {
    const acl = await deps.acls.getArtifactAcl(artifactId);
    if (!acl || acl.storageScopeId !== invocation.storageScopeId) throw new ArtifactOperationError('not_found');
    const state = await deps.lifecycle.stateOf(artifactId);
    if (acl.ownerId === invocation.actorId && (state === 'deleted' || state === 'purged')) {
      // Management must still authorize terminal owners before replaying a receipt.
      if (action === true) return acl;
      throw new ArtifactOperationError('gone');
    }
    const policy = await sharingPolicyContext(invocation.storageScopeId);
    if (!deps.lifecycle.canRead({ artifactId, state }, acl, invocation.actorId, action === true ? 'read' : action,
      deps.isApprovedAccount, policy)) {
      throw new ArtifactOperationError('not_found');
    }
    return acl;
  }

  /**
   * Files parity LOT 2 — resolve the files/assets union to bytes BEFORE any
   * commit step. One missing, expired, digest-mismatched or unauthorized asset
   * fails the whole publish and commits nothing. v1 only produces inline,
   * upload and cas forms; v2 additionally resolves copy/carry and the
   * keep-unmodified carry of the expected current release.
   */
  async function resolveBundleAssets(invocation: ArtifactInvocationContext, artifactId: string,
    entries: { files: Record<string, JsonValue>[]; assets: Record<string, JsonValue>[] },
    options: { allowExtendedForms: boolean; keepUnmodifiedPaths: boolean;
      expectedCurrentReleaseId: string | null }): Promise<{ files: { path: string; mimeType: string;
        bytes: Uint8Array }[]; origins: Record<string, string>; uploadPins: { digest: string;
          uploadId: string }[] }> {
    const fail = (path: string, reason: string): never => {
      throw new ArtifactOperationError('verification_failed',
        { publicDetails: { asset: { path, reason } } });
    };
    const checkBytes = (path: string, mimeType: string, bytes: Uint8Array): void => {
      if (!profile.rules.mimeTypes.includes(mimeType)) fail(path, 'MIME type not allowed by profile');
      validateFileBytes(mimeType, bytes);
    };
    const readCas = async (path: string, digest: string, size: number): Promise<Uint8Array> => {
      const bytes = await deps.publication.blobs.getBlob(blobKey(invocation.storageScopeId, digest));
      if (bytes === undefined) fail(path, 'blob missing');
      if (bytes.length !== size ||
        `sha256:${createHash('sha256').update(bytes).digest('hex')}` !== digest) {
        fail(path, 'size/digest mismatch');
      }
      return bytes;
    };
    const files: { path: string; mimeType: string; bytes: Uint8Array }[] = [];
    const origins: Record<string, string> = {};
    const uploadPins: { digest: string; uploadId: string }[] = [];
    for (const file of entries.files) {
      const bytes = Uint8Array.from(file.bytes as number[]);
      checkBytes(file.path as string, file.mimeType as string, bytes);
      files.push({ path: file.path as string, mimeType: file.mimeType as string, bytes });
      origins[file.path as string] = 'inline';
    }
    for (const asset of entries.assets) {
      const path = asset.path as string;
      if (Object.hasOwn(asset, 'uploadId')) {
        const staged = await deps.uploads!.sessions.getStagedFile(asset.uploadId as string);
        if (staged === undefined || staged.artifactId !== artifactId) fail(path, 'unknown upload');
        if (stagedFileExpired(staged, Date.now(), stagedFileTtlMs)) fail(path, 'staged file expired');
        const bytes = await deps.publication.blobs.getBlob(blobKey(invocation.storageScopeId, staged.digest));
        if (bytes === undefined || bytes.length !== staged.size ||
          `sha256:${createHash('sha256').update(bytes).digest('hex')}` !== staged.digest) {
          fail(path, 'staged blob missing or digest mismatch');
        }
        checkBytes(path, staged.mimeType, bytes);
        files.push({ path, mimeType: staged.mimeType, bytes });
        origins[path] = `upload:${staged.uploadId}`;
        uploadPins.push({ digest: staged.digest, uploadId: staged.uploadId });
      } else if (Object.hasOwn(asset, 'sourceArtifactId') || Object.hasOwn(asset, 'carryFromReleaseId')) {
        if (!options.allowExtendedForms) fail(path, 'extended asset form needs publish_bundle_v2');
        const copy = await resolveCopiedAsset(invocation, artifactId, asset, fail);
        // The copied/carried MIME comes from a manifest, not the caller: it
        // must still be inside the target profile allowlist (v1 forms keep
        // their LOT 1 magic-only check; only the staged TTL is new there).
        if (!profile.rules.mimeTypes.includes(copy.mimeType)) fail(path, 'MIME type not allowed by profile');
        checkBytes(path, copy.mimeType, copy.bytes);
        files.push({ path, mimeType: copy.mimeType, bytes: copy.bytes });
        origins[path] = copy.origin;
      } else {
        const digest = asset.digest as string;
        const size = asset.size as number;
        const mimeType = asset.mimeType as string;
        const bytes = await readCas(path, digest, size);
        checkBytes(path, mimeType, bytes);
        files.push({ path, mimeType, bytes });
        origins[path] = 'cas';
      }
    }
    if (options.keepUnmodifiedPaths && options.expectedCurrentReleaseId !== null) {
      const base = await deps.publication.getRelease!(options.expectedCurrentReleaseId);
      if (base === undefined || base.artifactId !== artifactId) fail('(base release)', 'unknown release');
      const manifest = parseManifest(base.manifest);
      for (const file of (manifest.files as { path: string; mimeType: string;
        size: number; digest: string }[] | undefined) ?? []) {
        if (Object.hasOwn(origins, file.path)) continue;
        const bytes = await readCas(file.path, file.digest, file.size);
        checkBytes(file.path, file.mimeType, bytes);
        files.push({ path: file.path, mimeType: file.mimeType, bytes });
        origins[file.path] = `carry:${options.expectedCurrentReleaseId}`;
      }
    }
    return { files, origins, uploadPins };
  }

  /** Copy/carry resolution for `artifacts_publish_bundle_v2` (same failure contract). */
  async function resolveCopiedAsset(invocation: ArtifactInvocationContext, artifactId: string,
    asset: Record<string, JsonValue>,
    fail: (path: string, reason: string) => never): Promise<{ mimeType: string; bytes: Uint8Array;
      origin: string }> {
    const path = asset.path as string;
    const readManifestFile = async (sourceArtifactId: string, sourceReleaseId: string | undefined,
      sourcePath: string | undefined): Promise<{ mimeType: string; bytes: Uint8Array }> => {
      const sourceAcl = await deps.acls.getArtifactAcl(sourceArtifactId);
      if (sourceAcl === undefined) fail(path, 'unknown source artifact');
      if (sourceAcl.storageScopeId !== invocation.storageScopeId) fail(path, 'cross-scope copy not supported');
      const sourceState = await deps.lifecycle.stateOf(sourceArtifactId);
      if (!deps.lifecycle.canRead({ artifactId: sourceArtifactId, state: sourceState }, sourceAcl,
        invocation.actorId, 'source', deps.isApprovedAccount,
        await sharingPolicyContext(invocation.storageScopeId))) {
        throw new ArtifactOperationError('access_denied');
      }
      const release = sourceReleaseId === undefined ? await deps.publication.getCurrent(sourceArtifactId)
        : deps.publication.getRelease === undefined ? undefined
          : await deps.publication.getRelease(sourceReleaseId);
      if (release === undefined || release.artifactId !== sourceArtifactId) fail(path, 'unknown source release');
      const manifest = parseManifest(release.manifest);
      const wanted = sourcePath ?? path;
      const entry = ((manifest.files as { path: string; mimeType: string; size: number;
        digest: string }[] | undefined) ?? []).find((file) => file.path === wanted);
      if (entry === undefined) fail(path, 'source path missing');
      const bytes = await deps.publication.blobs.getBlob(blobKey(invocation.storageScopeId, entry.digest));
      if (bytes === undefined || bytes.length !== entry.size ||
        `sha256:${createHash('sha256').update(bytes).digest('hex')}` !== entry.digest) {
        fail(path, 'source blob missing or digest mismatch');
      }
      return { mimeType: entry.mimeType, bytes };
    };
    if (Object.hasOwn(asset, 'sourceArtifactId')) {
      const sourceArtifactId = asset.sourceArtifactId as string;
      const { mimeType, bytes } = await readManifestFile(sourceArtifactId,
        asset.sourceReleaseId as string | undefined, asset.sourcePath as string | undefined);
      const release = (asset.sourceReleaseId as string | undefined) ??
        await deps.publication.getCurrent(sourceArtifactId).then((current) => current?.releaseId);
      return { mimeType, bytes, origin: `copy:${sourceArtifactId}:${release ?? 'current'}` };
    }
    const carryFromReleaseId = asset.carryFromReleaseId as string;
    const release = await deps.publication.getRelease!(carryFromReleaseId);
    if (release === undefined || release.artifactId !== artifactId) fail(path, 'unknown release');
    const { mimeType, bytes } = await readManifestFile(artifactId, carryFromReleaseId,
      asset.sourcePath as string | undefined);
    return { mimeType, bytes, origin: `carry:${carryFromReleaseId}` };
  /**
   * G1 management visibility for `set_access` (converged-r2 §2.3 order (2)):
   * readers pass as before; any other actor gets `not_found` unless it is an
   * APPROVED platform admin of the SAME storageScopeId. The predicate is
   * evaluated per call — never inferred from merely being wired — so a
   * non-reader non-admin cannot distinguish an existing artifact (403) from a
   * missing one (404): the existence oracle is closed. The management right
   * itself (owner, or admin-reduce-only) is decided inside the transaction by
   * `canManageAccess` (403 otherwise). The exception never makes the admin a
   * content reader.
   */
  async function visibleForManagement(artifactId: string, invocation: ArtifactInvocationContext): Promise<ArtifactAcl> {
    const acl = await deps.acls.getArtifactAcl(artifactId);
    if (!acl || acl.storageScopeId !== invocation.storageScopeId) throw new ArtifactOperationError('not_found');
    const state = await deps.lifecycle.stateOf(artifactId);
    if (acl.ownerId === invocation.actorId && (state === 'deleted' || state === 'purged')) return acl;
    const policy = await sharingPolicyContext(invocation.storageScopeId);
    if (deps.lifecycle.canRead({ artifactId, state }, acl, invocation.actorId, 'read', deps.isApprovedAccount, policy)) {
      return acl;
    }
    if (await deps.actorIsAdmin?.(invocation.actorId, invocation.storageScopeId) === true &&
      deps.isApprovedAccount?.(invocation.actorId) === true) return acl;
    throw new ArtifactOperationError('not_found');
  }

  /** Display metadata fields present on validated args (ensure/publish). */
  function metadataOf(normalized: Record<string, JsonValue>): ArtifactMetadata | undefined {
    const meta: ArtifactMetadata = {};
    if (typeof normalized.title === 'string') meta.title = normalized.title;
    if (typeof normalized.description === 'string') meta.description = normalized.description;
    if (typeof normalized.icon === 'string' || normalized.icon === null) meta.icon = normalized.icon;
    return Object.keys(meta).length > 0 ? meta : undefined;
  }

  /**
   * G2 projection (converged-r2 §2.3): no internal principal id (`sub`) ever
   * reaches a model payload. When a directory port is wired, every summary
   * `ownerId` and grant `principalId` keeps its field name but carries the
   * opaque `userRef` (re-injectable into `set_access`). Without a port the
   * legacy trusted form is kept (G1 behaviour).
   */
  async function projectUserRef(internalId: string, storageScopeId: string): Promise<string> {
    if (!deps.directory) return internalId;
    return (await deps.directory.describePrincipal(storageScopeId, internalId))?.userRef ?? internalId;
  }
  async function projectSummary<T extends { ownerId: string }>(summary: T, storageScopeId: string): Promise<T> {
    if (!deps.directory) return summary;
    return { ...summary, ownerId: await projectUserRef(summary.ownerId, storageScopeId) };
  }
  async function projectGrants(grants: ArtifactAcl['grants'], storageScopeId: string): Promise<ArtifactAcl['grants']> {
    if (!deps.directory) return grants;
    return Promise.all(grants.map(async (grant) => ({ ...grant,
      principalId: await projectUserRef(grant.principalId, storageScopeId) })));
  }

  /**
   * G2 visibility for `artifacts_list_access` (§2.3 order (2), same admin
   * exception as `set_access`): the owner, a grant holder, a content reader
   * or an APPROVED platform admin of the SAME storageScopeId pass; any other
   * actor gets `not_found` so the artifact's existence never leaks. The
   * exception never makes the admin a content reader.
   */
  async function visibleForAccessList(artifactId: string, invocation: ArtifactInvocationContext): Promise<ArtifactAcl> {
    const acl = await deps.acls.getArtifactAcl(artifactId);
    if (!acl || acl.storageScopeId !== invocation.storageScopeId) throw new ArtifactOperationError('not_found');
    if (acl.ownerId === invocation.actorId) return acl;
    if (acl.grants.some((grant) => grant.principalId === invocation.actorId)) return acl;
    const state = await deps.lifecycle.stateOf(artifactId);
    const policy = await sharingPolicyContext(invocation.storageScopeId);
    if (deps.lifecycle.canRead({ artifactId, state }, acl, invocation.actorId, 'read', deps.isApprovedAccount, policy)) {
      return acl;
    }
    if (await deps.actorIsAdmin?.(invocation.actorId, invocation.storageScopeId) === true &&
      deps.isApprovedAccount?.(invocation.actorId) === true) return acl;
    throw new ArtifactOperationError('not_found');
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
        ...(file.text === undefined
          ? { base64: Buffer.from(file.bytes).toString('base64'), encoding: 'base64' as const }
          : { text: file.text, encoding: 'utf8' as const }) }));
    await visible(artifactId, invocation, 'source');
    const failure = { ...outcome.failure, conflict: { ...conflict, currentSource: {
      artifactId, releaseId: release.releaseId, digest: conflict.currentDigest, manifest: release.manifest,
      files, sourceRef: null, guideRef: API_GUIDE_REF, ...deps.publicationUrls?.(artifactId, release.releaseId),
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
      previousReleaseId: receipt.previousReleaseId ?? null, updatedAt: receipt.updatedAt ?? null,
      ...(typeof receipt.revertedFromReleaseId === 'string' ? { revertedFromReleaseId: receipt.revertedFromReleaseId } : {}),
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
        const getPrefix = request.method !== 'GET' ? undefined : capability === 'artifacts_get' ? '/meta/'
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
        const normalized = profile.validate(capability, args, request.idempotencyKey, { deferPrecondition: true });
        const command = ['artifacts_ensure', 'artifacts_publish', 'artifacts_set_access', 'artifacts_delete', 'artifacts_revert',
          'artifacts_commit_upload', 'artifacts_publish_bundle', 'artifacts_publish_bundle_v2'].includes(capability)
          ? createArtifactCommand(profile, capability, args, invocation, deps.derivation, request.idempotencyKey,
            { deferPrecondition: true }) : undefined;
        if (command && ['ensure', 'publish'].includes(command.operation)) {
          phase = 'migration';
          await assertArtifactReplayMigration(deps.legacyRecords, command, invocation, normalized.idempotencyKey as string);
        }
        phase = 'dispatch';
        if (capability === 'artifacts_ensure') {
          const outcome = await ensure.ensure(invocation, { ...normalized,
            envelopeKey: request.idempotencyKey } as Parameters<typeof ensure.ensure>[1]);
          if (outcome.ok) {
            commitState = outcome.commitState;
            const state = await deps.lifecycle.stateOf(outcome.result.artifactId);
            if (state === 'deleted' || state === 'purged') throw new ArtifactOperationError('gone');
          }
          if (!outcome.ok) return outcome;
          const artifactId = outcome.result.artifactId;
          const acl = await visible(artifactId, invocation);
          const summary = await projectSummary(artifactSummary({ artifactId, acl, actorId: invocation.actorId,
            state: await deps.lifecycle.stateOf(artifactId), current: await deps.publication.getCurrent(artifactId),
            urls: deps.publicationUrls, approved: deps.isApprovedAccount,
            policy: await sharingPolicyContext(invocation.storageScopeId) }), invocation.storageScopeId);
          return { ...outcome, result: { status: 201, body: profile.resultEnvelopeVersion === 2
            ? { ...summary, ...outcome.result } : { ...outcome.result, ...acl.metadata } } };
        }
        if (capability === 'artifacts_get_source') {
          const artifactId = normalized.artifactId as string;
          const result = await readArtifactSource({
            storageScopeId: invocation.storageScopeId,
            authorize: async () => {
              const acl = await visible(artifactId, invocation);
              const state = await deps.lifecycle.stateOf(artifactId);
              if (!deps.lifecycle.canRead({ artifactId, state }, acl, invocation.actorId, 'source',
                deps.isApprovedAccount, await sharingPolicyContext(invocation.storageScopeId))) {
                throw new ArtifactOperationError('access_denied');
              }
            }, getCurrent: deps.publication.getCurrent, getRelease: deps.publication.getRelease!,
            getSource: (id) => deps.sources!.getSource(id), getBlob: (key) => deps.publication.blobs.getBlob(key),
            urls: deps.publicationUrls, maxFiles: 32, maxTotalBytes: 262144,
          }, normalized as unknown as Parameters<typeof readArtifactSource>[1]);
          return { ok: true, result: { status: 200, body: result }, invocationId: invocation.invocationId,
            commitState: 'not_committed', replayed: false };
        }
        if (capability === 'artifacts_list_assets') {
          const artifactId = normalized.artifactId as string;
          const acl = await visible(artifactId, invocation);
          const listState = (normalized.state as string | undefined) ?? 'all';
          const wantStaged = listState === 'staged' || listState === 'all';
          const wantReleased = listState === 'released' || listState === 'all';
          // Staged rows are owner-only (access_denied, never a filtered empty list);
          // the source read right gates the released branch below.
          if (wantStaged && acl.ownerId !== invocation.actorId) {
            throw new ArtifactOperationError('access_denied');
          }
          const limit = normalized.limit as number;
          const cursor = normalized.cursor as string | undefined;
          const releaseId = normalized.releaseId as string | undefined;
          const pageSessionId = normalized.pageSessionId as string | undefined;
          type AssetEntry = { path: string; mimeType: string; size: number; digest: string;
            state: 'staged' | 'released'; uploadId?: string; pageSessionId?: string; releaseId?: string };
          const stagedEntries: AssetEntry[] = [];
          if (wantStaged) {
            if (deps.uploads === undefined) throw new ArtifactProfileInputError(true);
            const rows = await deps.uploads.sessions.listStagedFiles(artifactId);
            for (const record of rows
              .filter((entry) => pageSessionId === undefined || entry.pageSessionId === pageSessionId)
              .sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0))) {
              stagedEntries.push({ path: record.path, mimeType: record.mimeType, size: record.size,
                digest: record.digest, state: 'staged', uploadId: record.uploadId,
                ...(record.pageSessionId === undefined ? {} : { pageSessionId: record.pageSessionId }) });
            }
          }
          const releasedEntries: AssetEntry[] = [];
          let listedReleaseId: string | undefined;
          if (wantReleased) {
            const artifactState = await deps.lifecycle.stateOf(artifactId);
            if (!deps.lifecycle.canRead({ artifactId, state: artifactState }, acl, invocation.actorId, 'source',
              deps.isApprovedAccount, await sharingPolicyContext(invocation.storageScopeId))) {
              throw new ArtifactOperationError('access_denied');
            }
            const current = releaseId === undefined ? await deps.publication.getCurrent(artifactId)
              : deps.publication.getRelease === undefined ? undefined
                : await deps.publication.getRelease(releaseId);
            // A release of another artifact reads as empty (no cross-artifact oracle).
            if (current !== undefined && (releaseId === undefined || current.artifactId === artifactId)) {
              listedReleaseId = current.releaseId;
              const manifest = parseManifest(current.manifest);
              for (const file of (manifest.files as { path: string; mimeType: string;
                size: number; digest: string }[] | undefined) ?? []) {
                releasedEntries.push({ path: file.path, mimeType: file.mimeType, size: file.size,
                  digest: file.digest, state: 'released', releaseId: current.releaseId });
              }
            }
          }
          const stagedPaths = new Set(stagedEntries.map((entry) => entry.path));
          const entries = [...stagedEntries,
            ...releasedEntries.filter((entry) => !stagedPaths.has(entry.path))];
          let offset = 0;
          if (cursor !== undefined) {
            const decoded = Buffer.from(cursor, 'base64url').toString('utf8');
            const match = /^lot2-assets:(\d+)$/.exec(decoded);
            if (match?.[1] === undefined || !Number.isSafeInteger(Number(match[1]))) {
              throw new ArtifactProfileInputError();
            }
            offset = Math.min(Number(match[1]), entries.length);
          }
          const page = entries.slice(offset, offset + limit);
          const nextCursor = offset + limit < entries.length
            ? Buffer.from(`lot2-assets:${offset + limit}`, 'utf8').toString('base64url') : undefined;
          return { ok: true, invocationId: invocation.invocationId, commitState: 'not_committed', replayed: false,
            result: { status: 200, body: { artifactId,
              ...(listedReleaseId === undefined ? {} : { releaseId: listedReleaseId }), assets: page,
              total: entries.length, ...(nextCursor === undefined ? {} : { nextCursor }) } } };
        }
        if (capability === 'artifacts_set_access' || capability === 'artifacts_delete') {
          const artifactId = normalized.artifactId as string;
          const acl = capability === 'artifacts_set_access'
            ? await visibleForManagement(artifactId, invocation)
            : await visible(artifactId, invocation, true);
          if (capability === 'artifacts_delete' && acl.ownerId !== invocation.actorId) {
            throw new ArtifactOperationError('access_denied');
          }
          const outcome = await manageArtifact({ coordinator: deps.coordinator,
            createUnit: deps.management?.createUnit ?? createPostgresManagementUnit,
            confirmation: deps.management?.confirmation, readPolicyRevision: () => deps.ensureHost.readPolicyRevision(),
            isApprovedPrincipal: deps.isApprovedAccount ?? (() => false),
            sharingPolicy: deps.sharingPolicy,
            profileAllowPublicSharing: profile.rules.allowPublicSharing,
            actorIsAdmin: deps.actorIsAdmin,
            directory: deps.directory,
            validateNewCommand: () => { profile.validate(capability, args, request.idempotencyKey); },
          }, invocation, command!, normalized.confirmationRef as string | undefined);
          return outcome.ok ? { ...outcome, result: { status: 200, body: outcome.result } } : outcome;
        }
        if (capability === 'artifacts_revoke_reader_consent') {
          // Self-revocation only: the reader is the invocation principal
          // (mcp-core.ts:225); no principalId argument exists, so the model
          // can never target another person. Error order: syntax (validated
          // above) → visibility (not_found, no existence oracle) → store
          // gate (capability_unavailable when no port is wired).
          const artifactId = normalized.artifactId as string;
          await visible(artifactId, invocation);
          const store = deps.readerConsent;
          if (!store) throw new ArtifactProfileInputError(true);
          const scope = normalized.scope as string | undefined;
          if (scope !== undefined) assertConsentScopeId(scope);
          const at = new Date().toISOString();
          // The route serves the MCP revocation tool; the api binding records
          // first-party screen/api surfaces through the service layer instead.
          const audit = { actor: invocation.actorId, surface: 'mcp' as const };
          const result = await store.revokeAllConsents({ storageScopeId: invocation.storageScopeId,
            readerAccountId: invocation.actorId, artifactId, ...(scope === undefined ? {} : { scopeId: scope }) },
            'self', at, audit);
          return { ok: true, invocationId: invocation.invocationId, commitState: 'not_committed' as const,
            replayed: false, result: { status: 200, body: scope === undefined
              ? { artifactId, scopeId: null, changed: result.changed, revoked: result.revoked }
              : { artifactId, scopeId: scope, changed: result.changed,
                revokedAt: result.changed ? at : null } } };
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
          profile.validate(capability, args, request.idempotencyKey);
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
            const releaseId = normalized[profile.resultEnvelopeVersion === 2 ? 'targetReleaseId' : 'releaseId'] as string;
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
          if (capability === 'artifacts_publish') {
            // B.2 MIME ceiling: magic-byte / strict-UTF-8 / SVG validation on every
            // newly published file (revert re-releases already-verified blobs).
            for (const file of files) validateFileBytes(file.mimeType, file.bytes);
          }
          const outcome = await publication.publishFinalized({
            ...input, source, profile: releaseProfile, files,
          });
          const committed = commitOutcome(outcome, artifactId, meta, (state) => { commitState = state; });
          return await conflictSource(committed, normalized, invocation);
        }
        if (capability === 'artifacts_create_upload') {
          const artifactId = normalized.artifactId as string;
          const acl = await visible(artifactId, invocation);
          if (acl.ownerId !== invocation.actorId) throw new ArtifactOperationError('access_denied');
          let created;
          try {
            created = await uploadService!.create({
              artifactId, storageScopeId: invocation.storageScopeId, ownerId: acl.ownerId,
              mimeType: normalized.mimeType as string,
              ...(normalized.maxSize === undefined ? {} : { maxSize: normalized.maxSize as number }),
            });
          } catch (cause) {
            if (cause instanceof Error && /open upload session quota/.test(cause.message)) {
              throw new ArtifactOperationError('limit_exceeded', { cause,
                publicDetails: { upload: { reason: 'open_session_quota' } } });
            }
            if (cause instanceof Error && /scope staging quota/.test(cause.message)) {
              throw new ArtifactOperationError('limit_exceeded', { cause,
                publicDetails: { upload: { reason: 'scope_staging_quota' } } });
            }
            if (cause instanceof Error && /invalid/.test(cause.message)) throw new ArtifactProfileInputError();
            throw cause;
          }
          return { ok: true, invocationId: invocation.invocationId, commitState: 'not_committed', replayed: false,
            result: { status: 201, body: { uploadId: created.uploadId, uploadUrl: created.uploadUrl,
              method: created.method, expiresAt: created.expiresAt, maxSize: created.maxSize,
              requiredHeaders: created.requiredHeaders, checksumHeader: created.checksumHeader } } };
        }
        if (capability === 'artifacts_commit_upload') {
          const artifactId = normalized.artifactId as string;
          const acl = await visible(artifactId, invocation);
          if (acl.ownerId !== invocation.actorId) throw new ArtifactOperationError('access_denied');
          const uploadId = normalized.uploadId as string;
          const digest = normalized.digest as string;
          const size = normalized.size as number;
          const mimeType = normalized.mimeType as string;
          const path = normalized.path as string;
          const commitInput = { uploadId, artifactId, storageScopeId: invocation.storageScopeId,
            ownerId: acl.ownerId, path, mimeType, digest, size };
          // LOT 2: the shared commit core — same code as the browser page channel.
          const commitDeps: CommitStagedUploadDeps = { sessions: deps.uploads!.sessions,
            staging: deps.uploads!.staging, blobs: deps.publication.blobs, refs: deps.publication.refs,
            budget: { filesMax: budget.filesMax, totalBytesMax: budget.totalBytesMax },
            ...(deps.uploads!.metrics === undefined ? {} : { metrics: deps.uploads!.metrics }) };
          const work = async (): Promise<Record<string, unknown>> => {
            let staged: StagedFileRecord;
            try {
              staged = await commitStagedUpload(uploadService!, commitDeps, commitInput);
            } catch (cause) {
              if (cause instanceof Error && /budget exceeded/.test(cause.message)) {
                throw new ArtifactOperationError('limit_exceeded', { cause,
                  publicDetails: { upload: { reason: 'staged_budget' } } });
              }
              if (cause instanceof Error && (/unknown upload/.test(cause.message) || /closed/.test(cause.message))) {
                // One response for unknown, foreign-bound, closed or expired sessions (no oracle).
                throw new ArtifactOperationError('verification_failed', { cause,
                  publicDetails: { upload: { reason: 'session unknown, bound elsewhere, closed or expired' } } });
              }
              if (cause instanceof Error && /staged object missing/.test(cause.message)) {
                throw new ArtifactOperationError('verification_failed',
                  { publicDetails: { upload: { reason: 'staged object missing' } } });
              }
              throw new ArtifactOperationError('verification_failed', { cause,
                publicDetails: { upload: { reason: 'size/digest/MIME mismatch' } } });
            }
            return { artifactId, uploadId, path, mimeType, digest, size,
              state: 'staged', stagedAt: staged.createdAt };
          };
          let body: Record<string, unknown>;
          if (deps.uploads!.idempotency !== undefined && command !== undefined) {
            // Same key + same digest replays; same key + different payload is command_conflict.
            const storeKey = JSON.stringify(['commit_upload', acl.ownerId, normalized.idempotencyKey]);
            try {
              const { result } = await deps.uploads!.idempotency.execute(storeKey, command.identity.commandHash, work);
              body = result as Record<string, unknown>;
            } catch (cause) {
              if (cause instanceof Error && /idempotency conflict/.test(cause.message)) {
                throw new ArtifactOperationError('command_conflict', { cause });
              }
              throw cause;
            }
          } else {
            body = await work();
          }
          return { ok: true, invocationId: invocation.invocationId, commitState: 'committed', replayed: false,
            result: { status: 201, body } };
        }
        if (capability === 'artifacts_create_upload_page') {
          const artifactId = normalized.artifactId as string;
          const acl = await visible(artifactId, invocation);
          if (acl.ownerId !== invocation.actorId) throw new ArtifactOperationError('access_denied');
          let minted;
          try {
            minted = await pageService!.mint({ artifactId, storageScopeId: invocation.storageScopeId,
              ownerId: acl.ownerId,
              ...(normalized.maxFiles === undefined ? {} : { maxFiles: normalized.maxFiles as number }) });
          } catch (cause) {
            if (cause instanceof Error && /quota exceeded/.test(cause.message)) {
              throw new ArtifactOperationError('limit_exceeded', { cause,
                publicDetails: { upload: { reason: 'open_page_quota' } } });
            }
            if (cause instanceof Error && /invalid/.test(cause.message)) throw new ArtifactProfileInputError();
            throw cause;
          }
          return { ok: true, invocationId: invocation.invocationId, commitState: 'not_committed', replayed: false,
            result: { status: 201, body: { pageSessionId: minted.pageSessionId,
              uploadPageUrl: minted.uploadPageUrl, expiresAt: minted.expiresAt, maxFiles: minted.maxFiles,
              maxFileBytes: minted.maxFileBytes, maxTotalBytes: minted.maxTotalBytes,
              allowedMimeTypes: minted.allowedMimeTypes } } };
        }
        if (capability === 'artifacts_publish_bundle') {
          const artifactId = normalized.artifactId as string;
          const acl = await visible(artifactId, invocation);
          if (acl.ownerId !== invocation.actorId) throw new ArtifactOperationError('access_denied');
          const publication = createGuardedPublicationService({ ...deps.publication, coordinator: deps.coordinator,
            limits: { maxFiles: budget.filesMax, maxFileBytes: budget.fileBytesMax, maxTotalBytes: budget.totalBytesMax } });
          const meta = metadataOf(normalized);
          const input = { ownerId: acl.ownerId, storageScopeId: invocation.storageScopeId, artifactId,
            identity: command!.identity, actorId: invocation.actorId, invocationId: invocation.invocationId,
            attemptId: invocation.invocationId, policyRevision: await deps.ensureHost.readPolicyRevision(),
            authorizeCommit: invocation.authorizeCommit, metadata: meta, operation: 'publish' as const,
            expectedCurrentReleaseId: normalized.expectedCurrentReleaseId as string | null };
          const replay = await publication.replayFinalized(input);
          if (replay !== undefined) return commitOutcome(replay, artifactId, meta, state => { commitState = state; });
          profile.validate(capability, args, request.idempotencyKey);
          // Resolve the files/assets union BEFORE any commit step: one missing,
          // expired or digest-mismatched asset fails the whole publish and commits nothing.
          const { files, origins } = await resolveBundleAssets(invocation, artifactId, {
            files: (normalized.files ?? []) as Record<string, JsonValue>[],
            assets: (normalized.assets ?? []) as Record<string, JsonValue>[],
          }, { allowExtendedForms: false, keepUnmodifiedPaths: false, expectedCurrentReleaseId: null });
          const outcome = await publication.publishFinalized({
            ...input, source: { kind: 'inline-original' },
            profile: normalized.profile as Record<string, JsonValue>, files,
          });
          const committed = commitOutcome(outcome, artifactId, meta, (state) => { commitState = state; });
          if (committed.ok) {
            const parsedBundleManifest = parseManifest((committed.result.body as { manifest: string }).manifest);
            const entries = (parsedBundleManifest.files as ManifestFileEntry[] | undefined) ?? [];
            (committed.result.body as Record<string, unknown>).files = entries.map((entry) => ({
              path: entry.path, mimeType: entry.mimeType, size: entry.size, digest: entry.digest,
              origin: origins[entry.path] ?? 'inline',
            }));
          }
          return committed;
        }
        if (capability === 'artifacts_get') {
          const artifactId = normalized.artifactId as string;
          const acl = await visible(artifactId, invocation);
          const state = await deps.lifecycle.stateOf(artifactId);
          const current = await deps.publication.getCurrent(artifactId);
          return { ok: true, invocationId: invocation.invocationId, commitState: 'not_committed', replayed: false,
            result: { status: 200, body: { ...await projectSummary(artifactSummary({ artifactId, acl, state, current,
              actorId: invocation.actorId, urls: deps.publicationUrls, approved: deps.isApprovedAccount,
              policy: await sharingPolicyContext(invocation.storageScopeId) }), invocation.storageScopeId),
              ...(acl.metadata !== undefined ? { metadata: acl.metadata } : {}),
              ...(acl.ownerId === invocation.actorId
                ? { grants: await projectGrants(acl.grants, invocation.storageScopeId) } : {}) } } };
        }
        if (capability === 'artifacts_list_versions') {
          const artifactId = normalized.artifactId as string;
          await visible(artifactId, invocation);
          const current = await deps.publication.getCurrent(artifactId);
          if (profile.resultEnvelopeVersion === 2) {
            const body = await artifactVersions({ artifactId, storageScopeId: invocation.storageScopeId,
              currentReleaseId: current?.releaseId ?? null, releases: await deps.publication.listReleases(artifactId),
              limit: normalized.limit as number | undefined, cursor: normalized.cursor as string | undefined,
              state: id => deps.lifecycle.getReleaseState(id), urls: deps.publicationUrls });
            await visible(artifactId, invocation);
            return { ok: true, invocationId: invocation.invocationId, commitState: 'not_committed', replayed: false,
              result: { status: 200, body } };
          }
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
        if (capability === 'artifacts_lookup_people') {
          // G2 approved-caller guard: the tool has no artifactId, so no visible()
          // carries this check — a pending/disabled account gets access_denied
          // before any directory enumeration.
          if (deps.isApprovedAccount?.(invocation.actorId) !== true) throw new ArtifactOperationError('access_denied');
          if (!deps.directory) throw new ArtifactProfileInputError(true);
          const matches = await deps.directory.searchPeople(invocation.storageScopeId,
            normalized.query as string, normalized.limit as number);
          return { ok: true, invocationId: invocation.invocationId, commitState: 'not_committed', replayed: false,
            result: { status: 200, body: { matches: matches.map((person) => ({ userRef: person.userRef,
              displayName: person.displayName, emailHint: maskEmailHint(person.email) })) } } };
        }
        if (capability === 'artifacts_list_access') {
          const artifactId = normalized.artifactId as string;
          const acl = await visibleForAccessList(artifactId, invocation);
          if (!deps.directory) throw new ArtifactProfileInputError(true);
          const admin = await deps.actorIsAdmin?.(invocation.actorId, invocation.storageScopeId) === true &&
            deps.isApprovedAccount?.(invocation.actorId) === true;
          const canManage = acl.ownerId === invocation.actorId || admin;
          // Owner and admin see the full list; a simple reader sees the mode and its own entry only.
          const visibleGrants = canManage ? acl.grants
            : acl.grants.filter((grant) => grant.principalId === invocation.actorId);
          const grants = await Promise.all(visibleGrants.map(async (grant) => {
            const person = await deps.directory!.describePrincipal(invocation.storageScopeId, grant.principalId);
            const userRef = person?.userRef ?? grant.principalId;
            const { effective, blockedBy } = evaluateGrant(acl, grant.principalId, deps.isApprovedAccount ?? (() => false));
            return { userRef, displayName: person?.displayName ?? userRef,
              ...(person === undefined ? {} : { emailHint: maskEmailHint(person.email) }),
              grant: grant.grant, createdAt: grant.createdAt ?? null, effective,
              ...(blockedBy === undefined ? {} : { blockedBy }) };
          }));
          const owner = await deps.directory.describePrincipal(invocation.storageScopeId, acl.ownerId);
          return { ok: true, invocationId: invocation.invocationId, commitState: 'not_committed', replayed: false,
            result: { status: 200, body: { artifactId, accessMode: accessModeOf(acl),
              owner: { userRef: owner?.userRef ?? acl.ownerId, displayName: owner?.displayName ?? acl.ownerId },
              canManage, grants } } };
        }
        const visibleArtifacts: unknown[] = [];
        const listPolicy = await sharingPolicyContext(invocation.storageScopeId);
        for (const artifactId of await deps.acls.listArtifactIds()) {
          const acl = await deps.acls.getArtifactAcl(artifactId);
          if (!acl || acl.storageScopeId !== invocation.storageScopeId) continue;
          const state = await deps.lifecycle.stateOf(artifactId);
          if (deps.lifecycle.canRead({ artifactId, state }, acl, invocation.actorId, 'read', deps.isApprovedAccount, listPolicy)) {
            visibleArtifacts.push(await projectSummary(artifactSummary({ artifactId, acl, state, actorId: invocation.actorId,
              current: await deps.publication.getCurrent(artifactId), urls: deps.publicationUrls,
              approved: deps.isApprovedAccount, policy: listPolicy }), invocation.storageScopeId));
          }
        }
        const offset = normalized.offset as number;
        return { ok: true, invocationId: invocation.invocationId, commitState: 'not_committed', replayed: false,
          result: { status: 200, body: { total: visibleArtifacts.length,
            artifacts: visibleArtifacts.slice(offset, offset + (normalized.limit as number)) } } };
      } catch (cause) {
        const failure = classifyArtifactFailure(cause, { invocationId: invocation?.invocationId ?? '',
          operation, phase, commitState }, (error) => error instanceof ArtifactProfileInputError
            ? new ArtifactOperationError(error.category, { publicDetails: error.details }) : deps.mapHostError?.(error));
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
      return projectArtifactHttpOutcome(await app.execute(request, invocation), profile.resultEnvelopeVersion === 2);
    },
  };
  return Object.freeze(app);
}
