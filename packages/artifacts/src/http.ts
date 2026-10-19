/**
 * L-5c — transport-free HTTP app (spec-v8 §9 5c).
 *
 * Part 1: request/response types, ordered error mapping, dispatch and the
 * ensure route. The app delegates to the same services as direct calls
 * (parity); only the DTO validation and status mapping live here. Created
 * views are owned by the caller — no client-supplied owner. Part 2 adds
 * publish/read; part 3 adds lifecycle/fork/access/source routes.
 *
 * Status mapping (first match wins): access denied → 403; state conflicts
 * (already/conflict/lost races, premature purge) → 409; unknown
 * artifact/release/intent/upload/blob or missing source → 404; terminal or
 * removed states (purged/deleted) → 410; failed byte verification → 422;
 * invalid input → 400; anything else → 500 (never expected).
 *
 * m5 hardening: error bodies are stable codes only (never raw internal
 * messages, which can carry driver text or stored identifiers). An actor
 * who cannot read an artifact gets the identical 404 answer as for an
 * unknown artifact on every route — no 404/403 existence oracle. Precise
 * 403 answers remain for actors who can already read the artifact.
 */
import { buildEnsureRequest } from './client.js';
import type { ParameterSchema } from './parameters.js';
import type { ArtifactService } from './server/service.js';
import type { PublicationBlobStore, PublicationService } from './server/publication.js';
import { createContentRuntime } from './server/runtime.js';
import type { LifecycleService } from './server/lifecycle.js';
import type { ForkRecord, ForkService } from './server/fork.js';
import { evaluateAccess, grantAccess, revokeAccess, type AclStore, type ArtifactAcl } from './server/access.js';
import { parseSourceRef, type SourceStore } from './server/sources.js';
import { assertArtifactAccess } from './server/authorization.js';
import type { StagingStore, UploadService } from './server/uploads.js';
import type { TemplateCatalogPort } from './server/templates.js';

export interface HttpRequest {
  method: string;
  path: string;
  body: unknown;
  actorId: string;
}

export interface HttpResponse {
  status: number;
  body: unknown;
}

export interface HttpAppDeps {
  parameterSchema: ParameterSchema;
  artifacts: ArtifactService;
  publication: PublicationService;
  lifecycle: LifecycleService;
  forks: ForkService;
  acls: AclStore;
  sources: SourceStore;
  blobs: PublicationBlobStore;
  isApprovedAccount?: (principalId: string) => boolean;
  /** Bounded upload sessions (L-5e); upload routes refuse when unwired. */
  uploads?: UploadService;
  staging?: StagingStore;
  /** Template kit + API guide catalog (L-5e); refuses when unwired. */
  templates?: TemplateCatalogPort;
}

function errorStatus(message: string): number {
  if (/access denied/.test(message)) return 403;
  if (/can only purge|already |conflict|lost/.test(message)) return 409;
  if (/unknown artifact|unknown release|unknown intent|unknown upload|unknown blob|not found|no source|no release/.test(message)) {
    return 404;
  }
  if (/terminal|purged|deleted/.test(message)) return 410;
  if (/digest|size mismatch|read-back/.test(message)) return 422;
  if (/invalid|missing|empty|duplicate|unknown action|unknown kind|budget|offset|committed|scope mismatch|malformed|forged|byte/.test(message)) {
    return 400;
  }
  return 500;
}

const ERROR_CODES: Record<number, string> = {
  400: 'invalid_request',
  401: 'anonymous',
  403: 'access_denied',
  404: 'not_found',
  409: 'conflict',
  410: 'gone',
  422: 'verification_failed',
  500: 'internal_error',
};

/** Stable error body for one status; internal messages never leave the app. */
export function errorBody(status: number): { error: string } {
  return { error: ERROR_CODES[status] ?? 'internal_error' };
}

function fail(error: unknown): HttpResponse {
  const message = error instanceof Error ? error.message : String(error);
  const status = errorStatus(message);
  return { status, body: errorBody(status) };
}

function needObject(body: unknown): Record<string, unknown> {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new Error('invalid request: body must be an object');
  }
  return body as Record<string, unknown>;
}

function needString(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`invalid request: missing ${name}`);
  return value;
}

function needBytes(value: unknown): Uint8Array {
  if (!Array.isArray(value)) throw new Error('invalid file bytes: must be an array');
  const bytes = new Uint8Array(value.length);
  for (let i = 0; i < value.length; i += 1) {
    const byte = value[i];
    if (typeof byte !== 'number' || !Number.isInteger(byte) || byte < 0 || byte > 255) {
      throw new Error(`invalid file bytes: byte ${i} out of range`);
    }
    bytes[i] = byte;
  }
  return bytes;
}

/** Canonical text MIME types; parameters are omitted (encoding is always UTF-8). */
export const TEXT_MIME_PATTERN = '^(?:text/[a-z0-9!#$&^_.+-]+|application/(?:javascript|ecmascript|json|xml|[a-z0-9!#$&^_.+-]+\\+(?:json|xml))|image/svg\\+xml)(?![\\s\\S])';

function needFileBytes(entry: Record<string, unknown>, mimeType: string): Uint8Array {
  const hasBytes = 'bytes' in entry;
  const hasText = 'text' in entry;
  if (hasBytes === hasText) throw new Error('invalid file: supply exactly one of bytes or text');
  if (hasBytes) return needBytes(entry['bytes']);
  if (typeof entry['text'] !== 'string' || !new RegExp(TEXT_MIME_PATTERN).test(mimeType)) {
    throw new Error('invalid file text: expected a string and a canonical text MIME type');
  }
  return new TextEncoder().encode(entry['text']);
}

/** Create the HTTP app over injected services (no server, no fetch). */
export function createHttpArtifactApp(deps: HttpAppDeps) {
  const isApproved = deps.isApprovedAccount ?? (() => false);
  const runtime = createContentRuntime({
    acls: deps.acls,
    lifecycle: deps.lifecycle,
    publication: deps.publication,
    blobs: deps.blobs,
  });

  /**
   * Load the ACL only when the actor may learn the artifact exists: the
   * owner always, everyone else only with a live read right. Unknown and
   * unreadable artifacts throw the identical error (no existence oracle).
   */
  // Upload sessions are bound to their creating owner + artifact in-app
  // (the upload service itself is actor-agnostic staging).
  const uploadOwners = new Map<string, { artifactId: string; ownerId: string }>();

  function requireUploads(): { uploads: UploadService; staging: StagingStore } {
    if (deps.uploads === undefined || deps.staging === undefined) {
      throw new Error('invalid request: uploads are not configured on this host');
    }
    return { uploads: deps.uploads, staging: deps.staging };
  }

  function requireTemplates(): TemplateCatalogPort {
    if (deps.templates === undefined) {
      throw new Error('invalid request: templates are not configured on this host');
    }
    return deps.templates;
  }

  function requireUploadOwner(uploadId: string, actorId: string): { artifactId: string } {
    const binding = uploadOwners.get(uploadId);
    if (binding === undefined || binding.ownerId !== actorId) {
      throw new Error(`unknown upload: ${uploadId}`);
    }
    return binding;
  }

  async function requireVisible(artifactId: string, actorId: string): Promise<ArtifactAcl> {
    const acl = await deps.acls.getArtifactAcl(artifactId);
    if (acl === undefined) throw new Error(`unknown artifact: ${artifactId}`);
    if (acl.ownerId === actorId) return acl;
    const state = await deps.lifecycle.stateOf(artifactId);
    if (!deps.lifecycle.canRead({ artifactId, state }, acl, actorId, 'read', isApproved)) {
      throw new Error(`unknown artifact: ${artifactId}`);
    }
    return acl;
  }

  return {
    async handle(request: HttpRequest): Promise<HttpResponse> {
      try {
        if (request.actorId.length === 0) return { status: 401, body: errorBody(401) };
        const body = request.body === undefined ? {} : needObject(request.body);

        if (request.method === 'POST' && request.path === '/ensure') {
          const ensured = buildEnsureRequest(deps.parameterSchema, {
            bindingName: needString(body['bindingName'], 'bindingName'),
            storageScopeId: needString(body['storageScopeId'], 'storageScopeId'),
            idempotencyKey: needString(body['idempotencyKey'], 'idempotencyKey'),
            paramsHash: typeof body['paramsHash'] === 'string' ? body['paramsHash'] : '',
            parameters: (body['parameters'] ?? {}) as Record<string, string | number | boolean | null | undefined>,
          });
          const result = await deps.artifacts.ensurePrivateView({
            actorUserId: request.actorId,
            ownerId: request.actorId,
            storageScopeId: ensured.storageScopeId,
            bindingName: ensured.bindingName,
            idempotencyKey: ensured.idempotencyKey,
            paramsHash: ensured.paramsHash,
          });
          if ((await deps.acls.getArtifactAcl(result.artifactId)) === undefined) {
            await deps.acls.putArtifactAcl(result.artifactId, {
              ownerId: request.actorId,
              storageScopeId: ensured.storageScopeId,
              isPublic: false,
              withdrawn: false,
              grants: [],
            });
          }
          await deps.lifecycle.register(result.artifactId, request.actorId);
          return { status: 201, body: result };
        }

        if (request.method === 'POST' && request.path === '/publish') {
          const artifactId = needString(body['artifactId'], 'artifactId');
          const acl = await requireVisible(artifactId, request.actorId);
          assertArtifactAccess({ actorUserId: request.actorId, artifactOwnerId: acl.ownerId, action: 'mutate' });
          if (acl.storageScopeId === undefined) throw new Error('invalid request: missing storage scope');
          const rawFiles = body['files'];
          if (!Array.isArray(rawFiles)) throw new Error('invalid request: missing files');
          const files = rawFiles.map((file: unknown) => {
            const entry = needObject(file);
            const mimeType = needString(entry['mimeType'], 'file.mimeType');
            return {
              path: needString(entry['path'], 'file.path'),
              mimeType,
              bytes: needFileBytes(entry, mimeType),
            };
          });
          const source = body['source'];
          const attached = source === undefined ? undefined : parseSourceRef(source);
          const result = await deps.publication.publish({
            ownerId: acl.ownerId,
            storageScopeId: acl.storageScopeId,
            artifactId,
            profile: (body['profile'] ?? {}) as Record<string, string | number | boolean | null | undefined>,
            files,
            idempotencyKey: typeof body['idempotencyKey'] === 'string' ? body['idempotencyKey'] : undefined,
            paramsHash: typeof body['paramsHash'] === 'string' ? body['paramsHash'] : undefined,
          });
          if (attached !== undefined) await deps.sources.putSource(artifactId, attached);
          await deps.lifecycle.trackRelease(artifactId, result.releaseId);
          return { status: 201, body: result };
        }

        if (request.method === 'GET' && request.path.startsWith('/current/')) {
          const artifactId = request.path.slice('/current/'.length);
          if (artifactId.length === 0) return { status: 404, body: errorBody(404) };
          await requireVisible(artifactId, request.actorId);
          const state = await deps.lifecycle.stateOf(artifactId);
          if (state === 'deleted' || state === 'purged') {
            return { status: 404, body: errorBody(404) };
          }
          const current = await deps.publication.getCurrent(artifactId);
          if (current === undefined) return { status: 404, body: errorBody(404) };
          return { status: 200, body: current };
        }

        if (request.method === 'POST' && ['/withdraw', '/restore', '/delete'].includes(request.path)) {
          const artifactId = needString(body['artifactId'], 'artifactId');
          await requireVisible(artifactId, request.actorId);
          if (request.path === '/withdraw') await deps.lifecycle.withdraw(artifactId, request.actorId);
          if (request.path === '/restore') await deps.lifecycle.restore(artifactId, request.actorId);
          if (request.path === '/delete') await deps.lifecycle.deleteArtifact(artifactId, request.actorId);
          return { status: 200, body: { artifactId, state: await deps.lifecycle.stateOf(artifactId) } };
        }

        if (request.method === 'POST' && request.path === '/purge') {
          const artifactId = needString(body['artifactId'], 'artifactId');
          await requireVisible(artifactId, request.actorId);
          const digests: string[] = [];
          for (const releaseId of await deps.lifecycle.listReleases(artifactId)) {
            const release = await deps.publication.getRelease(releaseId);
            if (release === undefined) throw new Error(`unknown release: ${releaseId}`);
            const manifest = JSON.parse(release.manifest) as { files?: { digest?: unknown }[] };
            for (const file of manifest.files ?? []) {
              if (typeof file.digest === 'string') digests.push(file.digest);
            }
          }
          const report = await deps.lifecycle.purge(artifactId, request.actorId, digests);
          return { status: 200, body: report };
        }

        if (request.method === 'POST' && request.path === '/promote') {
          const artifactId = needString(body['artifactId'], 'artifactId');
          await requireVisible(artifactId, request.actorId);
          const result = await deps.lifecycle.promote(
            artifactId,
            request.actorId,
            needString(body['releaseId'], 'releaseId'),
            needString(body['expectedCurrent'], 'expectedCurrent'),
          );
          return { status: 200, body: result };
        }

        if (request.method === 'POST' && request.path === '/renew') {
          const artifactId = needString(body['artifactId'], 'artifactId');
          await requireVisible(artifactId, request.actorId);
          const result = await deps.lifecycle.renew(artifactId, request.actorId);
          return { status: 200, body: result };
        }

        if (request.method === 'POST' && request.path === '/fork') {
          const artifactId = needString(body['artifactId'], 'artifactId');
          // Visibility first (404 without a read right, no oracle); a
          // visible object then reports its terminal state (410).
          const acl = await requireVisible(artifactId, request.actorId);
          const state = await deps.lifecycle.stateOf(artifactId);
          if (state === 'deleted' || state === 'purged') {
            throw new Error(`cannot fork ${state} artifact: ${artifactId}`);
          }
          const current = await deps.publication.getCurrent(artifactId);
          if (current === undefined) throw new Error(`no release to fork for ${artifactId}`);
          const manifest = JSON.parse(current.manifest) as { files?: { digest?: unknown }[] };
          const parent: ForkRecord = {
            artifactId,
            ownerId: acl.ownerId,
            releaseId: current.releaseId,
            manifest: current.manifest,
            state,
            readerIds: acl.grants.map((grant) => grant.principalId),
            blobDigests: (manifest.files ?? []).flatMap((file) =>
              typeof file.digest === 'string' ? [file.digest] : [],
            ),
          };
          await deps.forks.track(parent);
          const forked = await deps.forks.fork({ actorId: request.actorId, artifactId });
          return { status: 201, body: forked };
        }

        if (request.method === 'POST' && request.path === '/access/grant') {
          const artifactId = needString(body['artifactId'], 'artifactId');
          const acl = await requireVisible(artifactId, request.actorId);
          const grant = body['grant'];
          if (grant !== 'read' && grant !== 'source') throw new Error('invalid grant: must be read or source');
          const updated = grantAccess(acl, request.actorId, {
            principalId: needString(body['principalId'], 'principalId'),
            grant,
          });
          await deps.acls.putArtifactAcl(artifactId, updated);
          return { status: 200, body: { grants: updated.grants } };
        }

        if (request.method === 'POST' && request.path === '/access/revoke') {
          const artifactId = needString(body['artifactId'], 'artifactId');
          const acl = await requireVisible(artifactId, request.actorId);
          const updated = revokeAccess(acl, request.actorId, needString(body['principalId'], 'principalId'));
          await deps.acls.putArtifactAcl(artifactId, updated);
          return { status: 200, body: { grants: updated.grants } };
        }

        if (request.method === 'POST' && request.path === '/sources') {
          const artifactId = needString(body['artifactId'], 'artifactId');
          const acl = await requireVisible(artifactId, request.actorId);
          assertArtifactAccess({ actorUserId: request.actorId, artifactOwnerId: acl.ownerId, action: 'mutate' });
          const attached = parseSourceRef(body['source'] ?? {});
          await deps.sources.putSource(artifactId, attached);
          return { status: 200, body: attached };
        }

        if (request.method === 'GET' && request.path.startsWith('/content/')) {
          const rest = request.path.slice('/content/'.length).split('/');
          if (rest.length !== 2 || (rest[0]?.length ?? 0) === 0 || (rest[1]?.length ?? 0) === 0) {
            return { status: 404, body: errorBody(404) };
          }
          await requireVisible(rest[0] as string, request.actorId);
          const served = await runtime.serveFile({
            artifactId: rest[0] as string,
            digest: rest[1] as string,
            actorId: request.actorId,
            isApproved,
          });
          return {
            status: 200,
            body: {
              digest: served.digest,
              mimeType: served.mimeType,
              size: served.size,
              bytes: Array.from(served.bytes),
            },
          };
        }

        if (request.method === 'GET' && request.path.startsWith('/source/')) {
          const artifactId = request.path.slice('/source/'.length);
          if (artifactId.length === 0) return { status: 404, body: errorBody(404) };
          const acl = await requireVisible(artifactId, request.actorId);
          if (!evaluateAccess(acl, request.actorId, 'source', isApproved)) {
            throw new Error('access denied: source export requires a source grant');
          }
          const source = await deps.sources.getSource(artifactId);
          if (source === undefined) return { status: 404, body: errorBody(404) };
          return { status: 200, body: source };
        }

        if (request.method === 'POST' && request.path === '/list') {
          const limit = body['limit'] === undefined ? 20 : body['limit'];
          const offset = body['offset'] === undefined ? 0 : body['offset'];
          if (!Number.isInteger(limit) || (limit as number) < 1 || (limit as number) > 100) {
            throw new Error('invalid request: limit must be an integer in 1..100');
          }
          if (!Number.isInteger(offset) || (offset as number) < 0) {
            throw new Error('invalid request: offset must be a non-negative integer');
          }
          // ACL filtering precedes pagination: invisible artifacts neither
          // appear nor shift the page window (spec-v8 5c).
          const visible: Array<{ artifactId: string; ownerId: string; state: string; isPublic: boolean }> = [];
          for (const artifactId of await deps.acls.listArtifactIds()) {
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
          if (maxSize !== undefined && (!Number.isInteger(maxSize) || (maxSize as number) < 1)) {
            throw new Error('invalid request: maxSize must be a positive integer');
          }
          const begun = await uploads.begin({
            mimeType: needString(body['mimeType'], 'mimeType'),
            maxSize: maxSize as number | undefined,
          });
          uploadOwners.set(begun.uploadId, { artifactId, ownerId: request.actorId });
          return { status: 201, body: begun };
        }

        if (request.method === 'POST' && request.path === '/uploads/append') {
          const { uploads } = requireUploads();
          const uploadId = needString(body['uploadId'], 'uploadId');
          requireUploadOwner(uploadId, request.actorId);
          const offset = body['offset'];
          if (!Number.isInteger(offset) || (offset as number) < 0) {
            throw new Error('invalid request: offset must be a non-negative integer');
          }
          const appended = await uploads.append(uploadId, offset as number, needBytes(body['bytes']));
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
          await uploads.commit(uploadId, {
            digest: needString(body['digest'], 'digest'),
            size: size as number,
          });
          const bytes = await staging.read(uploadId);
          const result = await deps.publication.publish({
            ownerId: acl.ownerId,
            storageScopeId: acl.storageScopeId,
            artifactId,
            profile: (body['profile'] ?? {}) as Record<string, string | number | boolean | null | undefined>,
            files: [{
              path: needString(body['path'], 'path'),
              mimeType: needString(body['mimeType'], 'mimeType'),
              bytes,
            }],
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
