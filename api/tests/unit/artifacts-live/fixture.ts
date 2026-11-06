import { vi } from 'vitest';
import type { DraftSnapshot, LiveBinding, LivePorts, LiveStore } from '../../../src/services/artifacts/live/ports';
import type { LiveState } from '../../../src/services/artifacts/live/records';
import { createLiveController } from '../../../src/services/artifacts/live/controller';
import { createBuilderPods, type KubernetesCore } from '../../../src/services/artifacts/live/pods';
import type { CacheReceipt } from '../../../src/services/artifacts/live/cache';

export const key = { storageScopeId: 'scope-a', artifactId: 'artifact-a' };
export function fixture() {
  let state: LiveState | undefined;
  let tail = Promise.resolve(); let sequence = 0; let now = 0;
  const events: string[] = []; const published: string[] = [];
  const binding: LiveBinding = { generation: 1, ownerId: 'owner', headSha: 'B', healthy: true,
    autoPublish: true, automaticAuthorized: true, releaseId: 'release-B', releaseCommit: 'B', initialUnpublishedBranchEligible: false };
  let draft: DraftSnapshot = { generation: 1, revision: 1, baseHeadSha: 'B', treeSha: 'tree-B-dirty', dirty: true };
  const objects = new Map<string, { metadata: { name: string; uid: string; labels: Record<string, string> }; spec: unknown }>();
  const core: KubernetesCore = {
    get: vi.fn(async (kind, name) => objects.get(kind + name) as never),
    create: vi.fn(async (kind, value) => {
      const object = structuredClone(value) as { metadata: { name: string; uid: string; labels: Record<string, string> }; spec: unknown };
      object.metadata.uid = `uid-${++sequence}`; objects.set(kind + object.metadata.name, object); return object as never;
    }),
    delete: vi.fn(async (kind, name, uid) => {
      if (objects.get(kind + name)?.metadata.uid !== uid) throw new Error('UID mismatch');
      objects.delete(kind + name);
    }),
    waitDeleted: vi.fn(async (kind, name) => { if (objects.has(kind + name)) throw new Error('still running'); }),
  };
  const store: LiveStore = {
    read: async () => structuredClone(state),
    async transaction(_key, work) {
      const previous = tail; let unlock!: () => void;
      tail = new Promise<void>(resolve => { unlock = resolve; }); await previous;
      const unit = { state: structuredClone(state), save(next: LiveState) { unit.state = next; } };
      const before = { binding: structuredClone(binding), published: [...published] };
      try { const result = await work(unit); state = structuredClone(unit.state); return structuredClone(result); }
      catch (error) { Object.assign(binding, before.binding); published.splice(0, published.length, ...before.published); throw error; }
      finally { unlock(); }
    },
  };
  const ports: LivePorts = {
    store, now: () => now, id: () => `id-${++sequence}`, binding: vi.fn(async () => ({ ...binding })),
    forge: { head: vi.fn(async () => binding.headSha), fastForward: vi.fn(async (_key, before, after) => before < after),
      snapshot: vi.fn(async (_key, headSha) => ({ headSha, treeSha: `tree-${headSha}`, lockfile: new Uint8Array(),
        cacheIdentity: {} as never, stagingRef: `clean-${headSha}` })) },
    drafts: { current: vi.fn(async () => ({ ...draft })), checkpoint: vi.fn(async () => { events.push('checkpoint'); }),
      advanceClean: vi.fn(async (_key, _expected, headSha) => (draft = { ...draft, baseHeadSha: headSha, treeSha: `tree-${headSha}` })) },
    pods: createBuilderPods(core, 'setInterval(() => {}, 1000)'),
    cache: { acquire: vi.fn(async () => ({ key: 'cache' } as CacheReceipt)) },
    worker: {
      clean: vi.fn(async () => { events.push('clean'); }),
      prepare: vi.fn(async (_runtime, source) => { events.push(`prepare:${source.headSha}`); }),
      restore: vi.fn(async () => { events.push('restore'); }),
      live: vi.fn(async runtime => ({ revision: runtime.sourceRevision, routeEpoch: runtime.routeEpoch })),
      quiesce: vi.fn(async () => { events.push('quiesce'); }),
      build: vi.fn(async () => { events.push('build'); return { candidateDigest: 'candidate' }; }),
      verify: vi.fn(async () => { events.push('verify'); }),
    },
    routes: { revoke: vi.fn(async () => { events.push('revoke'); }), ready: vi.fn(async () => { events.push('ready'); }) },
    publication: { commit: vi.fn(async (_unit, _key, attempt) => {
      published.push(attempt.headSha); binding.releaseCommit = attempt.headSha; binding.releaseId = `release-${attempt.headSha}`;
      return { releaseId: binding.releaseId };
    }) },
  };
  return { ports, controller: createLiveController(ports), binding, core, objects, events, published,
    advance(ms: number) { now += ms; }, draft: () => draft, state: () => store.read(key) };
}
