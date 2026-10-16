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
import type { ForkService } from './server/fork.js';
import type { AclStore, ArtifactAcl } from './server/access.js';
import type { SourceStore } from './server/sources.js';

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
  if (/unknown artifact|unknown release|unknown intent|unknown upload|unknown blob|not found|no source/.test(message)) {
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

/** Create the HTTP app over injected services (no server, no fetch). */
export function createHttpArtifactApp(deps: HttpAppDeps) {
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
          return { status: 201, body: result };
        }

        return { status: 404, body: { error: 'unknown route' } };
      } catch (error) {
        return fail(error);
      }
    },
  };
}
