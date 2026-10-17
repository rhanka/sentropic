import type { ScopeGrant } from '../../src/storage/authority.js';
import type { WriterFence } from '../../src/storage/contracts.js';
import type { AuthenticatedStagedHandle, AuthenticatedStagedSeal } from '../../src/storage/staged-state.js';
import type { StagedCommitRoot } from '../../src/storage/staged-units.js';
import type { PgScoped, createPostgresKernel } from '../../src/storage/postgres/index.js';
export const pgCorpusClient = (root: Awaited<ReturnType<typeof createPostgresKernel>>, grant: ScopeGrant<unknown>, bound: PgScoped) => {
  const fences = new Map<string, WriterFence>();
  const extra = {
    beginStaged: async (input: Parameters<PgScoped['beginStaged']>[0]) => {
      await root.provisionFence(grant, input.fence);
      const unit = await bound.beginStaged(input); fences.set(unit.unitId, input.fence); return unit;
    },
    sealStaged: async (input: { unit: AuthenticatedStagedHandle; root: StagedCommitRoot }) => {
      const fence = fences.get(input.unit.unitId)!;
      for (;;) {
        const page = await bound.sealStep({ ...input, fence, limits: { maxRecords: 128, maxAppends: 128, maxEncodedBytes: 524288 } });
        if (page.seal) return page.seal;
      }
    },
    commitStaged: (input: { seal: AuthenticatedStagedSeal; fence: WriterFence }) => bound.commitStaged(input),
    abortStaged: (input: { unit: AuthenticatedStagedHandle }) => bound.abortStaged({ unit: input.unit, fence: fences.get(input.unit.unitId)!, reason: 'corpus cancellation' }),
  };
  return new Proxy(bound, { get(target, property) {
    if (Object.hasOwn(extra, property)) return extra[property as keyof typeof extra];
    const value = Reflect.get(target, property, target) as unknown;
    return typeof value === 'function' ? value.bind(target) : value;
  } });
};
