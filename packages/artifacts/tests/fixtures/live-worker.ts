import { vi } from 'vitest';
import { LIVE_DRAFT_LIMITS } from '../../src/live-host/index.js';
import { persistLiveOverlay } from '../../src/server/live-drafts.js';
import { createMemoryLiveStore, type LiveOverlayEntry, type LiveRuntimeState } from '../../src/server/live-store.js';

/** Builder base URL of the fake; every call is posted below it. */
export const BASE = 'https://builder.test/api/v1/artifacts/builder';
/** Closed key sets of the host live API bodies (host-live-api.ts). */
export const SETS = {
  page: ['artifactId', 'bindingGeneration', 'files', 'page', 'revision'],
  seal: ['artifactId', 'baseHeadSha', 'bindingGeneration', 'deletes', 'pages', 'revision', 'treeSha'],
  reconcile: ['artifactId', 'binding', 'bindingGeneration', 'invitation', 'leaseEpoch', 'liveSessionId', 'ownerId', 'routeEpoch'],
  stop: ['artifactId', 'bindingGeneration', 'leaseEpoch', 'liveSessionId'],
} as const;
export const keysOf = (value: object) => Object.keys(value).sort();

/**
 * Fake builder host with the host live API rules (host-live-api.ts, remote-drafts.ts): closed bodies, non-empty pages of
 * canonical base64 regular files in order from 0, a seal of exactly the staged pages, and a reconcile that answers 409
 * draft_not_staged unless a draft of that generation is sealed. It ACKs the sealed revision with the body fences.
 */
export function fakeBuilder(override: Partial<Record<'page' | 'seal' | 'reconcile' | 'stop', number>> = {}) {
  const calls: Array<{ path: string; body: any; authorization: string }> = [];
  let staging: { revision: string; files: Array<{ path: string; mode: number; text: string }>; pages: number } | null = null;
  let sealed: { generation: number; revision: string; files: Array<{ path: string; mode: number; text: string }>; deletes: string[];
    baseHeadSha: string; treeSha: string } | null = null;
  const answer = (status: number, body?: unknown) => new Response(body === undefined ? null : JSON.stringify(body), { status });
  const fetcher = vi.fn(async (url: URL, init: RequestInit) => {
    const path = String(url).slice(BASE.length + 1); const body = JSON.parse(String(init.body));
    calls.push({ path, body, authorization: (init.headers as Record<string, string>).authorization });
    const route = path.replace('v1/live/', '').replace('draft/', '') as keyof typeof SETS;
    if (override[route]) return answer(override[route]!, { error: 'builder_unavailable' });
    if (keysOf(body).join() !== SETS[route].join()) return answer(400, { error: 'invalid_request' });
    if (route === 'page') {
      if (!body.files.length || body.files.length > LIVE_DRAFT_LIMITS.paths) return answer(400, { error: 'invalid_request' });
      let bytes = 0;
      for (const f of body.files) {
        const raw = Buffer.from(f.data, 'base64'); bytes += raw.byteLength;
        if (keysOf(f).join() !== 'data,mode,path' || ![0o644, 0o755].includes(f.mode) || raw.toString('base64') !== f.data) {
          return answer(400, { error: 'invalid_request' });
        }
      }
      if (bytes > LIVE_DRAFT_LIMITS.pageBytes || body.page >= LIVE_DRAFT_LIMITS.pages) return answer(413, { error: 'limit_exceeded' });
      if (body.page === 0) staging = { revision: body.revision, files: [], pages: 0 };
      else if (!staging || staging.revision !== body.revision || staging.pages !== body.page) return answer(409, { error: 'staging_moved' });
      staging!.files.push(...body.files.map((f: any) => ({ path: f.path, mode: f.mode, text: Buffer.from(f.data, 'base64').toString() })));
      staging!.pages++;
      return answer(204);
    }
    if (route === 'seal') {
      const staged = body.pages === 0 ? { files: [] } : staging?.revision === body.revision && staging.pages === body.pages ? staging : null;
      if (!staged) return answer(409, { error: 'staging_moved' });
      sealed = { generation: body.bindingGeneration, revision: body.revision, files: staged.files, deletes: body.deletes,
        baseHeadSha: body.baseHeadSha, treeSha: body.treeSha };
      staging = null;
      return answer(204);
    }
    if (route === 'reconcile') {
      if (!sealed || sealed.generation !== body.bindingGeneration) return answer(409, { error: 'draft_not_staged' });
      return answer(200, { liveSessionId: body.liveSessionId, leaseEpoch: body.leaseEpoch, routeEpoch: body.routeEpoch,
        revision: sealed.revision, ready: true });
    }
    return answer(204);
  });
  return { fetcher, calls, sealed: () => sealed };
}

export const HEAD = 'a'.repeat(40); export const BASE_TREE = 'b'.repeat(40); export const LIVE_TREE = 'c'.repeat(40);
export const id = { storageScopeId: 'scope-a', artifactId: 'art-1', bindingGeneration: 2 };
export const keys = { current: async () => ({ version: 'k1', key: Buffer.alloc(32, 9) }), resolve: async () => Buffer.alloc(32, 9) };
export const runtime = { liveSessionId: 'sess-1', phase: 'REVIVING', leaseEpoch: 4, routeEpoch: 3, rowVersion: 1, ownerId: 'owner-alice',
  podUid: null, sourceRevision: 'r', baseHeadSha: HEAD, liveTreeSha: LIVE_TREE, idleDeadline: '2099-01-01T00:00:00.000Z',
  activeAttemptId: null, stateDetail: null, appliedRevision: null, lastAccessAt: '2026-11-08T00:00:00.000Z', pendingWake: false };

/** A memory LiveStore holding one draft of `overlay` and a REVIVING runtime owned by owner-alice. */
export async function seededStore(overlay: LiveOverlayEntry[]) {
  const store = createMemoryLiveStore();
  const record = await store.transaction(id, async tx => {
    const written = await persistLiveOverlay(tx, keys, { identity: id, expectedRevision: null, baseHeadSha: HEAD, baseTreeSha: BASE_TREE,
      liveTreeSha: overlay.length ? LIVE_TREE : BASE_TREE, overlay }, Date.now());
    tx.record!.runtime = structuredClone(runtime) as LiveRuntimeState;
    return written;
  });
  return { store, record };
}
