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
 */
import { buildEnsureRequest } from './client.js';
import type { ParameterSchema } from './parameters.js';
import type { ArtifactService } from './server/service.js';
import type { PublicationService } from './server/publication.js';
import type { LifecycleService } from './server/lifecycle.js';
import type { ForkRecord, ForkService } from './server/fork.js';
import { evaluateAccess, grantAccess, revokeAccess, type AclStore, type ArtifactAcl } from './server/access.js';
import { attachSource, type SourceStore } from './server/sources.js';
import { assertArtifactAccess } from './server/authorization.js';

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
  isApprovedAccount?: (principalId: string) => boolean;
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

function fail(error: unknown): HttpResponse {
  const message = error instanceof Error ? error.message : String(error);
  return { status: errorStatus(message), body: { error: message } };
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

/** Create the HTTP app over injected services (no server, no fetch). */
export function createHttpArtifactApp(deps: HttpAppDeps) {
  const isApproved = deps.isApprovedAccount ?? (() => false);

  async function requireAcl(artifactId: string): Promise<ArtifactAcl> {
    const acl = await deps.acls.getArtifactAcl(artifactId);
    if (acl === undefined) throw new Error(`unknown artifact: ${artifactId}`);
    return acl;
  }

  return {
    async handle(request: HttpRequest): Promise<HttpResponse> {
      try {
        if (request.actorId.length === 0) return { status: 401, body: { error: 'anonymous' } };
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
          const acl = await requireAcl(artifactId);
          assertArtifactAccess({ actorUserId: request.actorId, artifactOwnerId: acl.ownerId, action: 'mutate' });
          if (acl.storageScopeId === undefined) throw new Error('invalid request: missing storage scope');
          const rawFiles = body['files'];
          if (!Array.isArray(rawFiles)) throw new Error('invalid request: missing files');
          const files = rawFiles.map((file: unknown) => {
            const entry = needObject(file);
            return {
              path: needString(entry['path'], 'file.path'),
              mimeType: needString(entry['mimeType'], 'file.mimeType'),
              bytes: needBytes(entry['bytes']),
            };
          });
          const source = body['source'];
          const attached = source === undefined ? undefined : attachSource(source as never);
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
          if (artifactId.length === 0) return { status: 404, body: { error: 'not found' } };
          const acl = await requireAcl(artifactId);
          const state = await deps.lifecycle.stateOf(artifactId);
          if (!deps.lifecycle.canRead({ artifactId, state }, acl, request.actorId, 'read', isApproved)) {
            return { status: 404, body: { error: 'not found' } };
          }
          const current = await deps.publication.getCurrent(artifactId);
          if (current === undefined) return { status: 404, body: { error: 'not found' } };
          return { status: 200, body: current };
        }

        if (request.method === 'POST' && ['/withdraw', '/restore', '/delete'].includes(request.path)) {
          const artifactId = needString(body['artifactId'], 'artifactId');
          await requireAcl(artifactId);
          if (request.path === '/withdraw') await deps.lifecycle.withdraw(artifactId, request.actorId);
          if (request.path === '/restore') await deps.lifecycle.restore(artifactId, request.actorId);
          if (request.path === '/delete') await deps.lifecycle.deleteArtifact(artifactId, request.actorId);
          return { status: 200, body: { artifactId, state: await deps.lifecycle.stateOf(artifactId) } };
        }

        if (request.method === 'POST' && request.path === '/purge') {
          const artifactId = needString(body['artifactId'], 'artifactId');
          await requireAcl(artifactId);
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
          await requireAcl(artifactId);
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
          await requireAcl(artifactId);
          const result = await deps.lifecycle.renew(artifactId, request.actorId);
          return { status: 200, body: result };
        }

        if (request.method === 'POST' && request.path === '/fork') {
          const artifactId = needString(body['artifactId'], 'artifactId');
          const acl = await requireAcl(artifactId);
          // Right first (403), terminal state second (410): like other
          // mutations, a known object reports its state instead of hiding it.
          if (!evaluateAccess(acl, request.actorId, 'read', isApproved)) {
            throw new Error('access denied: cannot read artifact to fork');
          }
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
          const acl = await requireAcl(artifactId);
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
          const acl = await requireAcl(artifactId);
          const updated = revokeAccess(acl, request.actorId, needString(body['principalId'], 'principalId'));
          await deps.acls.putArtifactAcl(artifactId, updated);
          return { status: 200, body: { grants: updated.grants } };
        }

        if (request.method === 'POST' && request.path === '/sources') {
          const artifactId = needString(body['artifactId'], 'artifactId');
          const acl = await requireAcl(artifactId);
          assertArtifactAccess({ actorUserId: request.actorId, artifactOwnerId: acl.ownerId, action: 'mutate' });
          const attached = attachSource((body['source'] ?? {}) as never);
          await deps.sources.putSource(artifactId, attached);
          return { status: 200, body: attached };
        }

        if (request.method === 'GET' && request.path.startsWith('/source/')) {
          const artifactId = request.path.slice('/source/'.length);
          if (artifactId.length === 0) return { status: 404, body: { error: 'not found' } };
          const acl = await requireAcl(artifactId);
          if (!evaluateAccess(acl, request.actorId, 'source', isApproved)) {
            throw new Error('access denied: source export requires a source grant');
          }
          const source = await deps.sources.getSource(artifactId);
          if (source === undefined) return { status: 404, body: { error: 'no source attached' } };
          return { status: 200, body: source };
        }

        return { status: 404, body: { error: 'unknown route' } };
      } catch (error) {
        return fail(error);
      }
    },
  };
}
