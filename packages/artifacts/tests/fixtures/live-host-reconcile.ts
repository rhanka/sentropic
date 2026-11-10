import { createMemoryGitBindingStore } from '../../src/server/git-bindings.js';
import type { GitBindingStore } from '../../src/server/git-contracts.js';
import type { ReconcileBuilderStatus, ReconcileJobStore, ReconcileStatusClient } from '../../src/live-host/reconcile.js';

export const SCOPE = 'scope-a';
export const ARTIFACT = 'artifact-a';
export const JOB = 'job-1';
export const SHA = 'c'.repeat(40);

type JobRow = { state: string; code?: string | undefined; reason?: string | undefined; releaseId?: string | undefined;
  updatedAtMs: number };

/** In-memory host job store with pending-to-terminal compare-and-swap, like the host ledger. */
export function reconcileJobStore(initial: Record<string, JobRow> = {}) {
  const rows = new Map<string, JobRow>(Object.entries(initial));
  const key = (scopeId: string, artifactId: string, jobId: string) => JSON.stringify([scopeId, artifactId, jobId]);
  const store: ReconcileJobStore = {
    async listPending({ nowMs, olderThanMs, limit }) {
      return [...rows.entries()]
        .filter(([, row]) => (row.state === 'build_pending' || row.state === 'building') && nowMs - row.updatedAtMs >= olderThanMs)
        .slice(0, limit)
        .map(([raw, row]) => {
          const [scopeId, artifactId, jobId] = JSON.parse(raw) as [string, string, string];
          return { scopeId, artifactId, jobId, updatedAtMs: row.updatedAtMs };
        });
    },
    async read(input) {
      const row = rows.get(key(input.scopeId, input.artifactId, input.jobId));
      return row ? { ...row } : undefined;
    },
    async markFailed(input) {
      const row = rows.get(key(input.scopeId, input.artifactId, input.jobId));
      if (!row) return 'not-found';
      if (row.state !== 'build_pending' && row.state !== 'building') return 'already-terminal';
      rows.set(key(input.scopeId, input.artifactId, input.jobId),
        { state: 'build_failed', ...(input.code !== undefined ? { code: input.code } : {}),
          ...(input.reason ? { reason: input.reason } : {}), updatedAtMs: 0 });
      return 'updated';
    },
    async markPublished(input) {
      const row = rows.get(key(input.scopeId, input.artifactId, input.jobId));
      if (!row) return 'not-found';
      if (row.state !== 'build_pending' && row.state !== 'building') return 'already-terminal';
      rows.set(key(input.scopeId, input.artifactId, input.jobId), { state: 'published', releaseId: input.releaseId, updatedAtMs: 0 });
      return 'updated';
    },
  };
  return { store, rows };
}

/** Fake builder status client keyed by jobId; `fail` throws (transport), absent answers unknown. */
export function reconcileStatusClient(answers: Record<string, ReconcileBuilderStatus | undefined> = {},
  fail: string[] = []) {
  let concurrent = 0; let peak = 0;
  const client: ReconcileStatusClient = {
    async status({ jobId }) {
      concurrent++; peak = Math.max(peak, concurrent);
      try {
        await new Promise(resolve => setTimeout(resolve, 1));
        if (fail.includes(jobId)) throw new Error('transport down');
        return answers[jobId];
      } finally { concurrent--; }
    },
  };
  return { client, load: () => peak };
}

/** Memory binding store seeded with one `attached` binding for (`SCOPE`, artifact): the success path
 * already moved it on, so a stale job row must not move the binding. */
export async function attachedBindings(artifactId = ARTIFACT): Promise<GitBindingStore> {
  const bindings = createMemoryGitBindingStore();
  await bindings.write({ binding: { artifactId, storageScopeId: SCOPE, repoId: 'repo-a', branch: 'artifact/shared/demo',
    channel: 'shared', personalPrincipalId: null, subPath: '', baseCommitSha: 'a'.repeat(40), headCommitSha: 'a'.repeat(40),
    releaseCommitSha: 'b'.repeat(40), autoPublish: false, executor: 'sandbox', pendingJobId: null, pendingCommitSha: null,
    state: 'attached', generation: 1, version: 1, attachedBy: 'alice',
    attachedAt: '2026-11-05T00:00:00.000Z', updatedAt: '2026-11-05T00:00:00.000Z' },
    expectedVersion: null, actorId: 'alice', idempotencyKey: `attach-${artifactId}`, commandHash: `attach-${artifactId}`,
    event: { action: 'attach', afterSha: 'a'.repeat(40) } });
  return bindings;
}

/** Memory binding store seeded with one `build_pending` binding for (`SCOPE`, artifact, job). */
export async function buildPendingBindings(artifactId = ARTIFACT, jobId = JOB): Promise<GitBindingStore> {
  const bindings = createMemoryGitBindingStore();
  await bindings.write({ binding: { artifactId, storageScopeId: SCOPE, repoId: 'repo-a', branch: 'artifact/shared/demo',
    channel: 'shared', personalPrincipalId: null, subPath: '', baseCommitSha: 'a'.repeat(40), headCommitSha: SHA,
    releaseCommitSha: null, autoPublish: false, executor: 'sandbox', pendingJobId: null, pendingCommitSha: null,
    state: 'attached', generation: 1, version: 1, attachedBy: 'alice',
    attachedAt: '2026-11-05T00:00:00.000Z', updatedAt: '2026-11-05T00:00:00.000Z' },
    expectedVersion: null, actorId: 'alice', idempotencyKey: `attach-${artifactId}`, commandHash: `attach-${artifactId}`,
    event: { action: 'attach', afterSha: SHA } });
  await bindings.write({ binding: { artifactId, storageScopeId: SCOPE, repoId: 'repo-a', branch: 'artifact/shared/demo',
    channel: 'shared', personalPrincipalId: null, subPath: '', baseCommitSha: 'a'.repeat(40), headCommitSha: SHA,
    releaseCommitSha: null, autoPublish: false, executor: 'sandbox', pendingJobId: jobId, pendingCommitSha: SHA,
    state: 'build_pending', generation: 1, version: 2, attachedBy: 'alice',
    attachedAt: '2026-11-05T00:00:00.000Z', updatedAt: '2026-11-05T00:00:00.000Z' },
    expectedVersion: 1, actorId: 'alice', idempotencyKey: `publish-${artifactId}-${jobId}`, commandHash: `publish-${artifactId}-${jobId}`,
    event: { action: 'publish', beforeSha: undefined, afterSha: SHA, invocationId: 'test' } });
  return bindings;
}
