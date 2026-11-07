import { vi } from 'vitest';
import type { DraftSnapshot, LiveBinding, LivePorts, LiveStore } from '../../../src/services/artifacts/live/ports';
import type { LiveKey, LiveState } from '../../../src/services/artifacts/live/records';
import { createLiveController } from '../../../src/services/artifacts/live/controller';
import { createBuilderPods, type KubernetesCore } from '../../../src/services/artifacts/live/pods';
import type { CacheReceipt } from '../../../src/services/artifacts/live/cache';
import { createFairAdmission } from '../../../src/services/artifacts/live/admission';
import { createHeavyGate } from '../../../src/services/artifacts/live/heavy';
import { builderPlacement } from '../../../src/services/artifacts/live/placement';

export const key = { storageScopeId: 'scope-a', artifactId: 'artifact-a' };
export const owner = { principalId: 'owner' };
export const placement = builderPlacement({ ARTIFACT_BUILDER_NAMESPACE: 'artifact-builders-test',
  ARTIFACT_BUILDER_SERVICE_DOMAIN: 'artifact-builders-test.svc.cluster.local' });
/** GB1 inputs of every fixture commit: a lock without script entries, so no qualification file is required. */
export const gb1Descriptor = JSON.stringify({ version: 1, buildScript: 'build:artifact', outputDir: 'dist', lockfilePath: 'package-lock.json' });
const gb1Manifest = { name: 'fixture', version: '1.0.0', scripts: { 'build:artifact': 'vite build' } };
const gb1 = { subPath: '', files: { 'sentropic.artifact.json': gb1Descriptor, 'package.json': JSON.stringify(gb1Manifest),
  'package-lock.json': JSON.stringify({ lockfileVersion: 3, packages: { '': gb1Manifest } }) } };
const idOf = (k: LiveKey) => `${k.storageScopeId}/${k.artifactId}`;
export function fixture(options: { capacity?: number } = {}) {
  const states = new Map<string, LiveState>(); const drafts = new Map<string, DraftSnapshot>();
  const owners = new Map<string, string>();
  let tail = Promise.resolve(); let sequence = 0; let now = 0;
  const events: string[] = []; const published: string[] = [];
  const binding: LiveBinding = { generation: 1, ownerId: 'owner', headSha: 'B', healthy: true,
    autoPublish: true, automaticAuthorized: true, releaseId: 'release-B', releaseCommit: 'B', initialUnpublishedBranchEligible: false };
  const invitation = { epoch: 0, expiresAt: null as number | null };
  const keys = new Map<string, LiveKey>();
  const admission = createFairAdmission({ capacity: options.capacity ?? 1, waiterTtlMs: 60_000, now: () => now,
    holders: () => store.active() });
  const draftOf = (k: LiveKey) => {
    if (!drafts.has(idOf(k))) drafts.set(idOf(k), { generation: 1, revision: 'r1', baseHeadSha: 'B', treeSha: 'tree-B-dirty', dirty: true });
    return drafts.get(idOf(k))!;
  };
  const objects = new Map<string, { metadata: { name: string; uid: string; labels: Record<string, string> }; spec: unknown;
    status?: { phase?: string } }>();
  const core: KubernetesCore = {
    get: vi.fn(async (kind, name) => objects.get(kind + name) as never),
    create: vi.fn(async (kind, value) => {
      const object = structuredClone(value) as { metadata: { name: string; uid: string; labels: Record<string, string> }; spec: unknown };
      object.metadata.uid = `uid-${++sequence}`; objects.set(kind + object.metadata.name, object); return object as never;
    }),
    delete: vi.fn(async (kind, name, uid) => {
      if (!objects.has(kind + name)) return;
      if (objects.get(kind + name)?.metadata.uid !== uid) throw new Error('UID mismatch');
      objects.delete(kind + name);
    }),
    waitDeleted: vi.fn(async (kind, name) => { if (objects.has(kind + name)) throw new Error('still running'); }),
  };
  const store: LiveStore = {
    read: async k => structuredClone(states.get(idOf(k))),
    active: async () => [...states].filter(([, state]) => state.runtime.phase !== 'DORMANT')
      .map(([id, state]) => ({ key: keys.get(id)!, ownerId: state.runtime.ownerId })),
    async transaction(k, work) {
      const previous = tail; let unlock!: () => void;
      tail = new Promise<void>(resolve => { unlock = resolve; }); await previous;
      const unit = { state: structuredClone(states.get(idOf(k))), save(next: LiveState) { unit.state = next; } };
      const before = { binding: structuredClone(binding), published: [...published] };
      try {
        const result = await work(unit);
        if (unit.state) { states.set(idOf(k), structuredClone(unit.state)); keys.set(idOf(k), { ...k }); }
        return structuredClone(result);
      } catch (error) { Object.assign(binding, before.binding); published.splice(0, published.length, ...before.published); throw error; }
      finally { unlock(); }
    },
  };
  const ports: LivePorts = {
    store, now: () => now, id: () => `id-${++sequence}`,
    binding: vi.fn(async k => ({ ...binding, ownerId: owners.get(idOf(k)) ?? binding.ownerId })),
    forge: { head: vi.fn(async () => binding.headSha), fastForward: vi.fn(async (_key, before, after) => before < after),
      reachable: vi.fn(async () => true),
      snapshot: vi.fn(async (_key, headSha) => ({ headSha, treeSha: `tree-${headSha}`, lockfile: new Uint8Array(),
        cacheIdentity: {} as never, stagingRef: `clean-${headSha}`, gb1 })) },
    drafts: { current: vi.fn(async k => ({ ...draftOf(k) })), checkpoint: vi.fn(async () => { events.push('checkpoint'); }),
      advanceClean: vi.fn(async (k, _expected, headSha) => {
        const next = { ...draftOf(k), baseHeadSha: headSha, treeSha: `tree-${headSha}` }; drafts.set(idOf(k), next); return next;
      }) },
    admission, heavy: createHeavyGate({ maxWaitMs: 60_000 }),
    invitations: { current: vi.fn(async () => ({ ...invitation })) },
    pods: createBuilderPods(core, 'setInterval(() => {}, 1000)', placement),
    cache: { acquire: vi.fn(async () => ({ key: 'cache', identity: { lockSha256: 'lock-sha', nodeVersion: 'v24', npmVersion: '11' } } as CacheReceipt)) },
    worker: {
      clean: vi.fn(async () => { events.push('clean'); }),
      prepare: vi.fn(async (_runtime, source) => { events.push(`prepare:${source.headSha}`); }),
      restore: vi.fn(async () => { events.push('restore'); }),
      live: vi.fn(async runtime => ({ revision: runtime.sourceRevision, routeEpoch: runtime.routeEpoch })),
      quiesce: vi.fn(async () => { events.push('quiesce'); }),
      build: vi.fn(async () => { events.push('build'); return { candidateDigest: 'candidate' }; }),
      verify: vi.fn(async () => { events.push('verify'); }),
      renew: vi.fn(async () => undefined),
    },
    routes: { revoke: vi.fn(async () => { events.push('revoke'); }), ready: vi.fn(async () => { events.push('ready'); }) },
    publication: { job: vi.fn(async (_key, jobId: string) => ({ jobId, generation: binding.generation, headSha: 'A',
      expectedReleaseId: binding.releaseId })),
      commit: vi.fn(async (_unit, _key, attempt) => {
      published.push(attempt.headSha); binding.releaseCommit = attempt.headSha; binding.releaseId = `release-${attempt.headSha}`;
      return { releaseId: binding.releaseId };
    }) },
  };
  return { ports, controller: createLiveController(ports), binding, core, objects, events, published, owners,
    invitation, admission, advance(ms: number) { now += ms; }, draft: (k: LiveKey = key) => draftOf(k),
    state: (k: LiveKey = key) => store.read(k) };
}
