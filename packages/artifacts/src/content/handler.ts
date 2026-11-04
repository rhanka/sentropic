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
import type { ArtifactsMetrics } from '../server/metrics.js';
import type { LifecycleService } from '../server/lifecycle.js';
import { combineSharingPolicy, resolveSharingPolicy, type SharingPolicyPort } from '../server/ports.js';
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
  /** Raw HTTP Range header, mapped by the host; absent ⇒ whole file. */
  range?: string;
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
  /** LOT 2 §D.3: `content_range_requests {result}`; absent ⇒ no-op. */
  metrics?: ArtifactsMetrics;
  isApprovedAccount?: (principalId: string) => boolean | Promise<boolean>;
  /** G1 lock 2 (runtime): sharing policy per scope, fail-closed when absent. */
  sharingPolicy?: SharingPolicyPort;
  /** G1 lock 1 (deployment capability), absent ⇒ closed. */
  allowPublicSharing?: boolean;
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
  async function canReadNow(artifactId: string, subjectId: string): Promise<boolean> {
    const acl = await deps.acls.getArtifactAcl(artifactId);
    if (acl === undefined) return false;
    const state = await deps.lifecycle.stateOf(artifactId);
    // G1 double lock, fail-closed: public mode serves anonymous reads only
    // when the profile capability AND the live runtime policy both allow it.
    const policy = acl.storageScopeId === undefined ? undefined : combineSharingPolicy(deps.allowPublicSharing,
      await resolveSharingPolicy(deps.sharingPolicy, acl.storageScopeId));
    // G1 owner Q2: fresh account approval at every read; the host predicate may be async (live DB check).
    const approved = (await deps.isApprovedAccount?.(subjectId)) ?? false;
    return deps.lifecycle.canRead({ artifactId, state }, acl, subjectId, 'read', () => approved, policy);
  }

  /**
   * Files parity LOT 2 §B.4: RFC 9110 §14 single-range subset. Only the
   * `bytes=` unit with one satisfiable range is honored; malformed or
   * multi-range headers fall back to the whole file (never an error).
   */
  function parseRange(header: string | undefined, size: number):
    { start: number; end: number } | 'full' | 'unsatisfiable' | 'ignore' {
    if (header === undefined) return 'full';
    const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
    if (match?.[1] === undefined || match[2] === undefined) return 'ignore';
    if (match[1] === '' && match[2] === '') return 'ignore';
    if (match[1] === '') {
      // Suffix range: the last N bytes; longer than the file ⇒ the file.
      const suffix = Number(match[2]);
      if (!Number.isSafeInteger(suffix) || suffix <= 0) return 'unsatisfiable';
      if (suffix >= size) return size === 0 ? 'unsatisfiable' : { start: 0, end: size - 1 };
      return { start: size - suffix, end: size - 1 };
    }
    const start = Number(match[1]);
    if (!Number.isSafeInteger(start) || start >= size) return 'unsatisfiable';
    if (match[2] === '') return { start, end: size - 1 };
    const end = Number(match[2]);
    if (!Number.isSafeInteger(end) || end < start) return 'ignore';
    return { start, end: Math.min(end, size - 1) };
  }

  async function rangeSlice(key: string, start: number, end: number): Promise<Uint8Array | undefined> {
    const ranged = await deps.blobs.getBlobRange?.(key, start, end);
    if (ranged !== undefined) {
      // A short store read is distrusted: serve the whole file instead.
      return ranged.length === end - start + 1 ? ranged : undefined;
    }
    const bytes = await deps.blobs.getBlob(key);
    return bytes === undefined ? undefined : bytes.slice(start, end + 1);
  }

  async function serveFile(
    artifactId: string,
    manifest: string,
    filePath: string,
    rangeHeader: string | undefined,
  ): Promise<ContentResponse> {
    const acl = await deps.acls.getArtifactAcl(artifactId);
    if (acl === undefined) return fail(404);
    if (acl.storageScopeId === undefined) return fail(500);
    const parsed = JSON.parse(manifest) as { files?: ManifestFile[] };
    const file = (parsed.files ?? []).find((entry) => entry.path === filePath);
    if (file === undefined || typeof file.digest !== 'string') return fail(404);
    const hex = file.digest.startsWith('sha256:') ? file.digest.slice(7) : file.digest;
    const key = `artifacts/${acl.storageScopeId}/blobs/sha256/${hex}`;
    const mimeType = typeof file.mimeType === 'string' ? file.mimeType : 'application/octet-stream';
    const size = typeof file.size === 'number' ? file.size : undefined;
    const emitRange = (result: string): void => {
      if (deps.metrics !== undefined && rangeHeader !== undefined) {
        deps.metrics.emit({ name: 'content_range_requests', labels: { result } });
      }
    };
    if (rangeHeader !== undefined && size !== undefined) {
      const range = parseRange(rangeHeader, size);
      if (range === 'unsatisfiable') {
        emitRange('416');
        const response = fail(416);
        return { ...response, headers: { ...response.headers, 'content-range': `bytes */${size}` } };
      }
      if (range !== 'full' && range !== 'ignore') {
        const bytes = await rangeSlice(key, range.start, range.end);
        if (bytes === undefined) return fail(404);
        emitRange('206');
        return {
          status: 206,
          headers: { ...contentHeaders({ mimeType, size: bytes.length,
            assetCacheSeconds: deps.assetCacheSeconds }),
            'content-range': `bytes ${range.start}-${range.end}/${size}`,
            'accept-ranges': 'bytes' },
          bytes,
        };
      }
      if (range === 'ignore') emitRange('ignored');
    }
    const bytes = await deps.blobs.getBlob(key);
    if (bytes === undefined) return fail(404);
    if (size !== undefined && bytes.length !== size) return fail(422);
    return {
      status: 200,
      headers: { ...contentHeaders({ mimeType, size: bytes.length,
        assetCacheSeconds: deps.assetCacheSeconds }),
        'accept-ranges': 'bytes' },
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
      return serveFile(artifactId, release.manifest, filePath, request.range);
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
