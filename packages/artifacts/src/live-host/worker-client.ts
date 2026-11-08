import { ArtifactOperationError } from '../server/failures.js';
import type { GitBindingStore } from '../server/git-contracts.js';
import type { LiveInvitationState, LiveWorkerPort } from '../server/live-contracts.js';
import type { LiveIdentity, LiveStore } from '../server/live-store.js';
import { stageLiveDraft, type LiveDraftSource } from './draft-stager.js';

/** Builder control paths of the host live API (s-archi contract 07/11), relative to the builder base URL. */
export const LIVE_WORKER_PATHS = Object.freeze({ reconcile: 'v1/live/reconcile', stop: 'v1/live/stop' });
const MAX_ANSWER_BYTES = 64 * 1024;
const ID = /^[A-Za-z0-9_-]{1,128}$/;
const REVISION = /^[\x21-\x7e]{1,256}$/;

/** Host port: the live runtime of the package store record (owner, session and fences); undefined without a runtime. */
export interface LiveWorkerFences {
  current(identity: LiveIdentity): Promise<{ ownerId: string; liveSessionId: string; leaseEpoch: number; routeEpoch: number } | undefined>;
}
/** Builder answer of a reconcile; the package checks it against its own fences before marking the session LIVE. */
export interface LiveBridgeAck { liveSessionId: string; leaseEpoch: number; routeEpoch: number; revision: string; ready: boolean }
export interface LiveWorkerClientOptions {
  /** Builder base URL (https, no query or fragment); absent keeps every call closed with builder_unavailable. */
  readonly baseUrl?: string | undefined;
  /** S2S credential of the host (scope artifacts:builder); the builder takes the storage scope from it, never from a body. */
  readonly identity?: { authorization(): Promise<string> } | undefined;
  readonly fetch?: typeof fetch;
  /** Page, seal and stop calls (default 10 s). */
  readonly timeoutMs?: number;
  /** Reconcile call (default 30 s): the builder answers within its live wait (25 s in the product builder). */
  readonly reconcileTimeoutMs?: number;
  /** Host port: owner and fences of the current live runtime (see liveStoreFences). */
  readonly fences: LiveWorkerFences;
  /** Host port: the git binding of the artifact; only an attached binding of the exact generation is sent. */
  readonly bindings: Pick<GitBindingStore, 'get'>;
  /** Host port: the session invitation state of the live session (LiveSessionService.liveInvitationState). */
  readonly sessionState: (identity: LiveIdentity, liveSessionId: string) => Promise<LiveInvitationState>;
  /** Host port: the current durable draft, staged (pages, then seal) before every reconcile (see liveStoreDrafts). */
  readonly drafts: LiveDraftSource;
}

/** The LiveWorkerFences of a host on the package LiveStore: ownerId and fences come from the record runtime. */
export function liveStoreFences(store: LiveStore): LiveWorkerFences {
  return {
    async current(identity) {
      const runtime = await store.transaction(identity, async tx => tx.record?.runtime ?? undefined);
      return runtime ? { ownerId: runtime.ownerId, liveSessionId: runtime.liveSessionId, leaseEpoch: runtime.leaseEpoch,
        routeEpoch: runtime.routeEpoch } : undefined;
    },
  };
}

function builderBase(raw: string): URL {
  const base = new URL(raw);
  if (base.protocol !== 'https:' || base.search || base.hash) throw new ArtifactOperationError('builder_unavailable');
  return new URL(base.pathname.endsWith('/') ? base.href : `${base.href}/`);
}
/** Reads the answer to completion and parses at most MAX_ANSWER_BYTES of JSON; anything else is undefined. */
async function boundedJson(response: Response): Promise<unknown> {
  if (!response.body) return undefined;
  const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_ANSWER_BYTES) { await reader.cancel().catch(() => undefined); return undefined; }
      chunks.push(value);
    }
    const text = Buffer.concat(chunks).toString('utf8');
    return text ? JSON.parse(text) as unknown : undefined;
  } catch { return undefined; }
}
const count = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;
function parseAck(raw: unknown): LiveBridgeAck {
  const r = raw as Record<string, unknown> | null | undefined;
  if (!r || typeof r !== 'object' || typeof r.liveSessionId !== 'string' || !ID.test(r.liveSessionId) || !count(r.leaseEpoch)
    || !count(r.routeEpoch) || typeof r.revision !== 'string' || !REVISION.test(r.revision) || typeof r.ready !== 'boolean') {
    throw new ArtifactOperationError('provider_unavailable');
  }
  return { liveSessionId: r.liveSessionId, leaseEpoch: r.leaseEpoch, routeEpoch: r.routeEpoch, revision: r.revision, ready: r.ready };
}

/**
 * HTTP LiveWorkerPort of the Sentropic builder, composed as the package LiveService `worker`. A reconcile reads the
 * attached binding of the exact generation (else git_not_attached before any call), the runtime owner and fences,
 * stages the current draft (pages, then seal), then posts the closed RECONCILE body; a stop posts the closed STOP body.
 * Unconfigured: builder_unavailable. Transport error, non-200 reconcile, non-204 stop or page/seal, malformed ACK:
 * provider_unavailable (the package keeps the durable intent for the fenced reconciliation).
 */
export function createLiveWorkerClient(options: LiveWorkerClientOptions): LiveWorkerPort {
  const base = options.baseUrl !== undefined && options.identity !== undefined ? builderBase(options.baseUrl) : undefined;
  const bounded = <V>(map: Map<string, V>, key: string, value: V) => {
    if (!map.has(key) && map.size >= 4096) map.delete(map.keys().next().value!);
    map.set(key, value);
  };
  /** Session epoch floor per binding generation: never lower than an epoch already sent (409 stale_invitation). */
  const floors = new Map<string, number>();
  const floor = (identity: LiveIdentity, epoch: number) => {
    const key = JSON.stringify([identity.storageScopeId, identity.artifactId, identity.bindingGeneration]);
    const next = Math.max(floors.get(key) ?? 0, epoch);
    bounded(floors, key, next);
    return next;
  };
  /** One stage+reconcile or stop at a time per artifact in this client: a late seal never overwrites a newer revision. */
  const lanes = new Map<string, Promise<void>>();
  function serial<T>(identity: LiveIdentity, run: () => Promise<T>): Promise<T> {
    const key = JSON.stringify([identity.storageScopeId, identity.artifactId]);
    const next = (lanes.get(key) ?? Promise.resolve()).then(run);
    const tail = next.then(() => undefined, () => undefined);
    lanes.set(key, tail);
    void tail.then(() => { if (lanes.get(key) === tail) lanes.delete(key); });
    return next;
  }
  async function call(path: string, body: unknown, timeoutMs = options.timeoutMs ?? 10_000) {
    if (!base) throw new ArtifactOperationError('builder_unavailable');
    try {
      const response = await (options.fetch ?? fetch)(new URL(path, base), { method: 'POST', redirect: 'error',
        headers: { 'content-type': 'application/json', authorization: await options.identity!.authorization() },
        body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) });
      return { status: response.status, payload: await boundedJson(response) };
    } catch (error) {
      if (error instanceof ArtifactOperationError) throw error;
      throw new ArtifactOperationError('provider_unavailable');
    }
  }
  async function reconcile(identity: LiveIdentity): Promise<LiveBridgeAck> {
    const record = await options.bindings.get(identity.storageScopeId, identity.artifactId);
    if (!record || record.state === 'detached' || record.generation !== identity.bindingGeneration) {
      throw new ArtifactOperationError('git_not_attached');
    }
    const fences = await options.fences.current(identity);
    if (!fences) throw new ArtifactOperationError('provider_unavailable');
    await stageLiveDraft(options.drafts, identity, (path, body) => call(path, body));
    const session = await options.sessionState(identity, fences.liveSessionId);
    const answer = await call(LIVE_WORKER_PATHS.reconcile, { artifactId: identity.artifactId,
      bindingGeneration: identity.bindingGeneration, ownerId: fences.ownerId, liveSessionId: fences.liveSessionId,
      leaseEpoch: fences.leaseEpoch, routeEpoch: fences.routeEpoch,
      binding: { repoId: record.repoId, branch: record.branch, subPath: record.subPath },
      invitation: { epoch: floor(identity, session.epoch), expiresAt: session.expiresAt } }, options.reconcileTimeoutMs ?? 30_000);
    if (answer.status !== 200) throw new ArtifactOperationError('provider_unavailable');
    return parseAck(answer.payload);
  }
  return {
    async reconcile(identity) {
      if (!base) throw new ArtifactOperationError('builder_unavailable');
      return serial(identity, () => reconcile(identity));
    },
    async stop(input) {
      if (!base) throw new ArtifactOperationError('builder_unavailable');
      await serial(input, async () => {
        const answer = await call(LIVE_WORKER_PATHS.stop, { artifactId: input.artifactId, bindingGeneration: input.bindingGeneration,
          liveSessionId: input.liveSessionId, leaseEpoch: input.leaseEpoch });
        if (answer.status !== 204) throw new ArtifactOperationError('provider_unavailable');
      });
    },
  };
}
