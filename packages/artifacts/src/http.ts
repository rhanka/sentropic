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
  type ArtifactCommitCoordinator, type FinalizeRequest } from './server/commit/types.js';
import { ArtifactOperationError, classifyArtifactFailure, type ArtifactOutcome } from './server/failures.js';
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
  profile: CompiledArtifactsProfile;
  coordinator: ArtifactCommitCoordinator;
  derivation: ArtifactKeyDerivationBinding;
  /** Explicit pilot-state inventory reader; supply an empty reader only for a verified fresh store. */
  legacyRecords: Pick<KvPort, 'get'>;
  ensureHost: GuardedEnsureHost;
  publication: Omit<GuardedPublicationDeps, 'coordinator' | 'limits'> & {
    getCurrent: PublicationService['getCurrent'];
  };
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
  const supported = ['artifacts_ensure', 'artifacts_publish', 'artifacts_list', 'artifacts_get'];
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

  async function visible(artifactId: string, invocation: ArtifactInvocationContext): Promise<ArtifactAcl> {
    const acl = await deps.acls.getArtifactAcl(artifactId);
    if (!acl || acl.storageScopeId !== invocation.storageScopeId) throw new ArtifactOperationError('not_found');
    const state = await deps.lifecycle.stateOf(artifactId);
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
        const command = capability === 'artifacts_ensure' || capability === 'artifacts_publish'
          ? createArtifactCommand(profile, capability, args, invocation, deps.derivation, request.idempotencyKey) : undefined;
        if (command) {
          phase = 'migration';
          await assertArtifactReplayMigration(deps.legacyRecords, command, invocation, normalized.idempotencyKey as string);
        }
            const acl = await deps.acls.getArtifactAcl(artifactId);
            if (acl === undefined) continue;
            const state = await deps.lifecycle.stateOf(artifactId);
            if (!deps.lifecycle.canRead({ artifactId, state }, acl, request.actorId, 'read', isApproved)) {
              continue;
            }
            visible.push({ artifactId, ownerId: acl.ownerId, state, isPublic: acl.isPublic });
          }
          return {
            status: 200,
            body: {
              total: visible.length,
              artifacts: visible.slice(offset as number, (offset as number) + (limit as number)),
            },
          };
        }

        if (request.method === 'GET' && request.path.startsWith('/meta/')) {
          const artifactId = request.path.slice('/meta/'.length);
          if (artifactId.length === 0) return { status: 404, body: errorBody(404) };
          const acl = await requireVisible(artifactId, request.actorId);
          const state = await deps.lifecycle.stateOf(artifactId);
          const current = await deps.publication.getCurrent(artifactId);
          return {
            status: 200,
            body: {
              artifactId,
              ownerId: acl.ownerId,
              storageScopeId: acl.storageScopeId,
              state,
              isPublic: acl.isPublic,
              withdrawn: state === 'withdrawn',
              currentReleaseId: current?.releaseId,
              // Grant rosters stay owner-visible; readers learn no principals.
              ...(request.actorId === acl.ownerId ? { grants: acl.grants } : {}),
            },
          };
        }

        if (request.method === 'POST' && request.path === '/uploads') {
          const { uploads } = requireUploads();
          const artifactId = needString(body['artifactId'], 'artifactId');
          const acl = await requireVisible(artifactId, request.actorId);
          assertArtifactAccess({ actorUserId: request.actorId, artifactOwnerId: acl.ownerId, action: 'mutate' });
          const maxSize = body['maxSize'];
          if (maxSize !== undefined && (!Number.isSafeInteger(maxSize) || (maxSize as number) < 1)) {
            throw new Error('invalid request: maxSize must be a positive integer');
          }
          const limits = deps.publication.limits ?? DEFAULT_PUBLICATION_LIMITS;
          const begun = await uploads.begin({
            mimeType: needString(body['mimeType'], 'mimeType'),
            maxSize: Math.min((maxSize as number | undefined) ?? Infinity, limits.maxFileBytes, limits.maxTotalBytes),
          });
          uploadOwners.set(begun.uploadId, { artifactId, ownerId: request.actorId });
          return { status: 201, body: begun };
        }

        if (request.method === 'POST' && request.path === '/uploads/append') {
          const { uploads } = requireUploads();
          const uploadId = needString(body['uploadId'], 'uploadId');
          requireUploadOwner(uploadId, request.actorId);
          const offset = body['offset'];
          if (!Number.isSafeInteger(offset) || (offset as number) < 0) {
            throw new Error('invalid request: offset must be a non-negative integer');
          }
          const limits = deps.publication.limits ?? DEFAULT_PUBLICATION_LIMITS;
          const remaining = Math.min(uploads.remainingBytes(uploadId, offset as number),
            limits.maxFileBytes - (offset as number), limits.maxTotalBytes - (offset as number));
          const appended = await uploads.append(uploadId, offset as number,
            needBytes(body['bytes'], remaining));
          return { status: 200, body: appended };
        }

        if (request.method === 'POST' && request.path === '/uploads/commit') {
          const { uploads, staging } = requireUploads();
          const uploadId = needString(body['uploadId'], 'uploadId');
          const binding = requireUploadOwner(uploadId, request.actorId);
          const artifactId = needString(body['artifactId'], 'artifactId');
          if (artifactId !== binding.artifactId) {
            throw new Error('invalid request: upload belongs to another artifact');
          }
          const acl = await requireVisible(artifactId, request.actorId);
          assertArtifactAccess({ actorUserId: request.actorId, artifactOwnerId: acl.ownerId, action: 'mutate' });
          if (acl.storageScopeId === undefined) throw new Error('invalid request: missing storage scope');
          const size = body['size'];
          if (!Number.isInteger(size) || (size as number) < 0) {
            throw new Error('invalid request: size must be a non-negative integer');
          }
          const files = [{
            path: needString(body['path'], 'path'),
            mimeType: needString(body['mimeType'], 'mimeType'),
            bytes: new Uint8Array(0),
          }];
          await uploads.commit(uploadId, {
            digest: needString(body['digest'], 'digest'),
            size: size as number,
          }, (bytes) => {
            files[0]!.bytes = bytes;
            validatePublicationFiles(files, deps.publication.limits ?? DEFAULT_PUBLICATION_LIMITS);
          });
          const result = await deps.publication.publish({
            ownerId: acl.ownerId,
            storageScopeId: acl.storageScopeId,
            artifactId,
            profile: (body['profile'] ?? {}) as Record<string, string | number | boolean | null | undefined>,
            files,
            idempotencyKey: typeof body['idempotencyKey'] === 'string' ? body['idempotencyKey'] : undefined,
            paramsHash: typeof body['paramsHash'] === 'string' ? body['paramsHash'] : undefined,
          });
          await deps.lifecycle.trackRelease(artifactId, result.releaseId);
          await staging.discard(uploadId);
          return { status: 201, body: result };
        }

        if (request.method === 'GET' && request.path.startsWith('/templates/')) {
          const templateId = request.path.slice('/templates/'.length);
          if (templateId.length === 0 || templateId.includes('/')) {
            return { status: 404, body: errorBody(404) };
          }
          const template = await requireTemplates().getTemplate(templateId);
          if (template === undefined) return { status: 404, body: errorBody(404) };
          return { status: 200, body: template };
        }

        if (
          request.method === 'GET' &&
          (request.path === '/api-guide' || request.path.startsWith('/api-guide/'))
        ) {
          const version = request.path === '/api-guide'
            ? undefined
            : request.path.slice('/api-guide/'.length);
          if (version !== undefined && (version.length === 0 || version.includes('/'))) {
            return { status: 404, body: errorBody(404) };
          }
          const guide = await requireTemplates().getApiGuide(version);
          if (guide === undefined) return { status: 404, body: errorBody(404) };
          return { status: 200, body: guide };
        }

        if (request.method === 'POST' && request.path === '/access/public') {
          const artifactId = needString(body['artifactId'], 'artifactId');
          const acl = await requireVisible(artifactId, request.actorId);
          assertArtifactAccess({ actorUserId: request.actorId, artifactOwnerId: acl.ownerId, action: 'mutate' });
          if (typeof body['isPublic'] !== 'boolean') {
            throw new Error('invalid request: isPublic must be a boolean');
          }
          await deps.acls.putArtifactAcl(artifactId, { ...acl, isPublic: body['isPublic'] });
          return { status: 200, body: { artifactId, isPublic: body['isPublic'] } };
        }

        return { status: 404, body: errorBody(404) };
      } catch (error) {
        return fail(error);
      }
    },
  };
}
