/**
 * L-5d — transport-free content handler (owner decision relayed by immo).
 * Serves raw release bytes on the separate content domain (never HTML on
 * the control origin). One wildcard per base: the single UUID label
 * `<id>.<base>` is resolved server-side — an artifact id serves its
 * current release, a release id serves that frozen version; an unknown id
 * gets the same 404 response and timing class whatever kind it would be.
 * Per-version activation: a single-use ticket redeemed by the
 * host-authenticated subject mints a short subject+artifact+release grant
 * as a host-only cookie. Every request re-verifies the grant AND live
 * ACL/lifecycle state, so withdrawal cuts readers at the next request
 * (inside the 60s budget, no cache reliance). Republish demands fresh
 * consent on an artifact id (401); a release id keeps its release.
 * Unknown/unreadable → same 404; bad grants → 401.
 */
import { errorBody } from '../http.js';
import type { AclStore } from '../server/access.js';
import type { LifecycleService } from '../server/lifecycle.js';
import type { PublicationBlobStore, PublicationService } from '../server/publication.js';
import { CONTENT_GRANT_TTL_SECONDS, type GrantSigner, type TicketService } from './grants.js';
import { contentHeaders, grantCookie, parseGrantCookie } from './headers.js';
import { isServiceWorkerPath, parseContentHost, resolveContentPath } from './routing.js';

export interface ContentRequest {
  method: string;
  host: string;
  path: string;
  /** Host-resolved authenticated subject (edge session), when present. */
  actorId?: string;
  cookie?: string;
  ticket?: string;
}

export interface ContentResponse {
  status: number;
  headers: Record<string, string>;
  bytes?: Uint8Array;
  body?: unknown;
}

export interface ContentHandlerDeps {
  acls: AclStore;
  lifecycle: LifecycleService;
  publication: PublicationService;
  blobs: PublicationBlobStore;
  grants: GrantSigner;
  tickets: TicketService;
  baseDomain: string;
  isApprovedAccount?: (principalId: string) => boolean;
  assetCacheSeconds?: number;
}

interface ManifestFile { path?: unknown; digest?: unknown; size?: unknown; mimeType?: unknown }

function jsonResponse(status: number, body: unknown, extra: Record<string, string> = {}): ContentResponse {
  return { status, body, headers: {
    ...contentHeaders({ mimeType: 'application/json', size: Buffer.byteLength(JSON.stringify(body)) }),
    'content-security-policy': "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
    ...extra,
  } };
}

function fail(status: number): ContentResponse {
  return jsonResponse(status, errorBody(status));
}

/** Create the content handler over injected host ports (no server). */
export function createContentHandler(deps: ContentHandlerDeps) {
  const isApproved = deps.isApprovedAccount ?? (() => false);

  async function canReadNow(artifactId: string, subjectId: string): Promise<boolean> {
    const acl = await deps.acls.getArtifactAcl(artifactId);
    if (acl === undefined) return false;
    const state = await deps.lifecycle.stateOf(artifactId);
    return deps.lifecycle.canRead({ artifactId, state }, acl, subjectId, 'read', isApproved);
  }

  async function serveFile(
    artifactId: string,
    manifest: string,
    filePath: string,
  ): Promise<ContentResponse> {
    const acl = await deps.acls.getArtifactAcl(artifactId);
    if (acl === undefined) return fail(404);
    if (acl.storageScopeId === undefined) return fail(500);
    const parsed = JSON.parse(manifest) as { files?: ManifestFile[] };
    const file = (parsed.files ?? []).find((entry) => entry.path === filePath);
    if (file === undefined || typeof file.digest !== 'string') return fail(404);
    const hex = file.digest.startsWith('sha256:') ? file.digest.slice(7) : file.digest;
    const bytes = await deps.blobs.getBlob(`artifacts/${acl.storageScopeId}/blobs/sha256/${hex}`);
    if (bytes === undefined) return fail(404);
    if (typeof file.size === 'number' && bytes.length !== file.size) return fail(422);
    return {
      status: 200,
      headers: contentHeaders({
        mimeType: typeof file.mimeType === 'string' ? file.mimeType : 'application/octet-stream',
        size: bytes.length,
        assetCacheSeconds: deps.assetCacheSeconds,
      }),
      bytes,
    };
  }

  async function handle(request: ContentRequest): Promise<ContentResponse> {
      if (request.method !== 'GET' && request.method !== 'HEAD') return fail(404);
      const origin = parseContentHost(request.host, deps.baseDomain);
      if (origin === undefined) return fail(404);
      // One label, resolved server-side: an artifact id serves its current
      // release, a release id serves that frozen version. Both lookups
      // always run, so an unknown id gets the same 404 and timing class
      // whether it is a missing artifact or a missing release.
      const [current, byRelease] = await Promise.all([
        deps.publication.getCurrent(origin.id),
        deps.publication.getRelease(origin.id),
      ]);
      let artifactId: string;
      let release: { releaseId: string; manifest: string };
      let channel: 'stable' | 'pinned';
      if (current !== undefined) {
        artifactId = origin.id;
        release = current;
        channel = 'stable';
      } else if (byRelease !== undefined) {
        artifactId = byRelease.artifactId;
        release = byRelease;
        channel = 'pinned';
      } else {
        return fail(404);
      }
      if (request.ticket !== undefined) {
        if (request.actorId === undefined || request.actorId.length === 0) return fail(401);
        try {
          await deps.tickets.redeem(request.ticket, {
            subjectId: request.actorId, artifactId, releaseId: release.releaseId, channel,
          });
        } catch {
          return fail(401);
        }
        if (!(await canReadNow(artifactId, request.actorId))) return fail(404);
        const token = deps.grants.issue({
          subjectId: request.actorId,
          artifactId,
          releaseId: release.releaseId,
        });
        return jsonResponse(200, { activated: true, artifactId, releaseId: release.releaseId }, {
          'set-cookie': grantCookie(token, CONTENT_GRANT_TTL_SECONDS),
        });
      }
      const token = parseGrantCookie(request.cookie);
      if (token === undefined) return fail(401);
      let claims;
      try {
        claims = deps.grants.verify(token);
      } catch {
        return fail(401);
      }
      if (claims.artifactId !== artifactId || claims.releaseId !== release.releaseId) {
        return fail(401); // fresh version consent: activate this release
      }
      if (request.actorId !== undefined && request.actorId !== claims.subjectId) return fail(401);
      if (!(await canReadNow(artifactId, claims.subjectId))) return fail(404);
      const filePath = resolveContentPath(request.path);
      if (filePath === undefined || isServiceWorkerPath(filePath)) return fail(404);
      return serveFile(artifactId, release.manifest, filePath);
  }
  return {
    async handle(request: ContentRequest): Promise<ContentResponse> {
      let response: ContentResponse;
      try { response = await handle(request); } catch { response = fail(500); }
      if (request.method === 'HEAD') {
        const { bytes: _bytes, body: _body, ...head } = response;
        return head;
      }
      return response;
    },
  };
}
