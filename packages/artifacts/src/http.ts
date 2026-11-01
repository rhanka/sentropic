/** Selected HTTP control surface over the authorized atomic services. */
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
import type { ArtifactAcl, AclStore } from './server/access.js';
import type { LifecycleService } from './server/lifecycle.js';
import { CommitQuarantineError, type ArtifactInvocationContext,
  type ArtifactCommitCoordinator } from './server/commit/types.js';
import { ArtifactOperationError, classifyArtifactFailure, type ArtifactOutcome, type ArtifactHostFailureMapper } from './server/failures.js';
import { projectArtifactHttpOutcome } from './server/outcome-projection.js';
import { readArtifactSource } from './server/source-read.js';
import { artifactSummary } from './server/summary.js';
import { manageArtifact, type ManagementUnit, type ArtifactConfirmationPort } from './server/management.js';
import { createPostgresManagementUnit } from './adapters/postgres-management.js';
import type { FinalizeTxClient } from './server/commit/types.js';
import type { SourceStore } from './server/sources.js';
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
    getRelease?: PublicationService['getRelease'];
  };
  sources?: Pick<SourceStore, 'getSource'>;
  management?: { createUnit?: (client: FinalizeTxClient) => ManagementUnit; confirmation?: ArtifactConfirmationPort };
  acls: AclStore;
  lifecycle: Pick<LifecycleService, 'stateOf' | 'canRead'>;
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

function object(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new ArtifactProfileInputError();
  return value as Record<string, unknown>;
}
/** Other mutation surfaces need their own qualification before host activation. */
export function assertArtifactsTransportProfile(value: unknown): asserts value is CompiledArtifactsProfile {
  assertCompiledArtifactsProfile(value);
  const supported = ['artifacts_ensure', 'artifacts_publish', 'artifacts_list', 'artifacts_get',
    'artifacts_get_source', 'artifacts_set_access', 'artifacts_delete'];
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
  const ensure = createGuardedEnsureService({ profile, coordinator: deps.coordinator,
    derivation: deps.derivation, host: deps.ensureHost });

  async function visible(artifactId: string, invocation: ArtifactInvocationContext): Promise<ArtifactAcl> {
    const acl = await deps.acls.getArtifactAcl(artifactId);
    if (!acl || acl.storageScopeId !== invocation.storageScopeId) throw new ArtifactOperationError('not_found');
    const state = await deps.lifecycle.stateOf(artifactId);
    if (acl.ownerId === invocation.actorId && (state === 'deleted' || state === 'purged')) throw new ArtifactOperationError('gone');
    if (!deps.lifecycle.canRead({ artifactId, state }, acl, invocation.actorId, 'read', deps.isApprovedAccount)) {
      throw new ArtifactOperationError('not_found');
    }
    return acl;
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
        if (capability === 'artifacts_get') {
          if (request.body !== undefined && Object.keys(object(request.body)).length) throw new ArtifactProfileInputError();
          args = { artifactId: request.path.slice('/meta/'.length) };
        } else {
          args = { ...object(request.body ?? {}) };
          if (Object.hasOwn(args, 'storageScopeId')) {
            if (args.storageScopeId !== invocation.storageScopeId) throw new ArtifactProfileInputError();
            delete args.storageScopeId;
          }
        }
        const normalized = profile.validate(capability, args, request.idempotencyKey);
        const command = ['artifacts_ensure', 'artifacts_publish', 'artifacts_set_access', 'artifacts_delete'].includes(capability)
          ? createArtifactCommand(profile, capability, args, invocation, deps.derivation, request.idempotencyKey) : undefined;
        if (command && ['ensure', 'publish'].includes(command.operation)) {
          phase = 'migration';
          await assertArtifactReplayMigration(deps.legacyRecords, command, invocation, normalized.idempotencyKey as string);
        }
        phase = 'dispatch';
        if (capability === 'artifacts_ensure') {
          const outcome = await ensure.ensure(invocation, { ...normalized,
            envelopeKey: request.idempotencyKey } as Parameters<typeof ensure.ensure>[1]);
          if (outcome.ok) {
            const state = await deps.lifecycle.stateOf(outcome.result.artifactId);
            if (state === 'deleted' || state === 'purged') throw new ArtifactOperationError('gone');
          }
          return outcome.ok ? { ...outcome, result: { status: 201, body: outcome.result } } : outcome;
        }
        if (capability === 'artifacts_get_source') {
          const artifactId = normalized.artifactId as string;
          const result = await readArtifactSource({
            storageScopeId: invocation.storageScopeId,
            authorize: async () => {
              const acl = await visible(artifactId, invocation);
              const state = await deps.lifecycle.stateOf(artifactId);
              if (!deps.lifecycle.canRead({ artifactId, state }, acl, invocation.actorId, 'source', deps.isApprovedAccount)) {
                throw new ArtifactOperationError('access_denied');
              }
            }, getCurrent: deps.publication.getCurrent, getRelease: deps.publication.getRelease!,
            getSource: (id) => deps.sources!.getSource(id), getBlob: (key) => deps.publication.blobs.getBlob(key),
            urls: deps.publicationUrls, maxFiles: 32, maxTotalBytes: 262144,
          }, normalized as unknown as Parameters<typeof readArtifactSource>[1]);
          return { ok: true, result: { status: 200, body: result }, invocationId: invocation.invocationId,
            commitState: 'not_committed', replayed: false };
        }
        if (capability === 'artifacts_set_access' || capability === 'artifacts_delete') {
          const outcome = await manageArtifact({ coordinator: deps.coordinator,
            createUnit: deps.management?.createUnit ?? createPostgresManagementUnit,
            confirmation: deps.management?.confirmation, readPolicyRevision: () => deps.ensureHost.readPolicyRevision(),
            isApprovedPrincipal: deps.isApprovedAccount ?? (() => false),
          }, invocation, command!, normalized.confirmationRef as string | undefined);
          return outcome.ok ? { ...outcome, result: { status: 200, body: outcome.result } } : outcome;
        }
        if (capability === 'artifacts_publish') {
          const artifactId = normalized.artifactId as string;
          const acl = await visible(artifactId, invocation);
          if (acl.ownerId !== invocation.actorId) throw new ArtifactOperationError('access_denied');
          const limits = profile.operations.find((entry) => entry.operation === 'publish')!.limits;
          const publication = createGuardedPublicationService({ ...deps.publication, coordinator: deps.coordinator,
            limits: { maxFiles: limits.publishFilesMax, maxFileBytes: limits.maxDecodedFileBytes,
              maxTotalBytes: limits.maxDecodedTotalBytes } });
          const outcome = await publication.publishFinalized({
            ownerId: acl.ownerId, storageScopeId: invocation.storageScopeId, artifactId,
            identity: command!.identity, actorId: invocation.actorId, invocationId: invocation.invocationId,
            attemptId: invocation.invocationId, policyRevision: await deps.ensureHost.readPolicyRevision(),
            authorizeCommit: invocation.authorizeCommit,
            source: { kind: 'inline-original' }, profile: normalized.profile as Record<string, JsonValue>,
            files: (normalized.files as Record<string, JsonValue>[]).map((file) => ({
              path: file.path as string, mimeType: file.mimeType as string, bytes: Uint8Array.from(file.bytes as number[]),
            })),
          });
          if (!outcome.ok) {
            const failure = { ...outcome.failure, kind: 'operational' as const };
            Object.defineProperty(failure, 'cause', { value: outcome.failure.cause, enumerable: false });
            return { ok: false, failure: Object.freeze(failure) };
          }
          commitState = outcome.commitState;
          const receipt = object(outcome.result.receipt);
          if (typeof receipt.releaseId !== 'string' || typeof receipt.manifest !== 'string') {
            throw new Error('invalid publication receipt');
          }
          return { ...outcome, result: { status: 201, body: {
            artifactId, releaseId: receipt.releaseId, manifest: receipt.manifest,
            digest: parseManifest(receipt.manifest).digest,
            ...deps.publicationUrls?.(artifactId, receipt.releaseId),
          } } };
        }
        if (capability === 'artifacts_get') {
          const artifactId = normalized.artifactId as string;
          const acl = await visible(artifactId, invocation);
          const state = await deps.lifecycle.stateOf(artifactId);
          const current = await deps.publication.getCurrent(artifactId);
          return { ok: true, invocationId: invocation.invocationId, commitState: 'not_committed', replayed: false,
            result: { status: 200, body: { ...artifactSummary({ artifactId, acl, state, current,
              actorId: invocation.actorId, urls: deps.publicationUrls, approved: deps.isApprovedAccount }),
              ...(acl.ownerId === invocation.actorId ? { grants: acl.grants } : {}) } } };
        }
        const visibleArtifacts: unknown[] = [];
        for (const artifactId of await deps.acls.listArtifactIds()) {
          const acl = await deps.acls.getArtifactAcl(artifactId);
          if (!acl || acl.storageScopeId !== invocation.storageScopeId) continue;
          const state = await deps.lifecycle.stateOf(artifactId);
          if (deps.lifecycle.canRead({ artifactId, state }, acl, invocation.actorId, 'read', deps.isApprovedAccount)) {
            visibleArtifacts.push(artifactSummary({ artifactId, acl, state, actorId: invocation.actorId,
              current: await deps.publication.getCurrent(artifactId), urls: deps.publicationUrls, approved: deps.isApprovedAccount }));
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
    async handle(request, invocation) { return projectArtifactHttpOutcome(await app.execute(request, invocation)); },
  };
  return Object.freeze(app);
}
