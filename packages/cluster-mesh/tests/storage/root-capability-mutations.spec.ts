import { describe, expect, it, vi } from 'vitest';
import { StagedCore } from '../../src/storage/staged-core.js';
import { createStagedTestKernel } from './staged-client.js';
import { grantFor } from './authority-corpus.js';
import { runStagedFenceRotationCorpus, runStagedOwnershipCorpus } from './staged-integrity-corpus.js';

type TestScope = ReturnType<ReturnType<typeof createStagedTestKernel>['bindNew']>;
const wrap = (bound: TestScope, overrides: Record<string, unknown>): TestScope => new Proxy(bound, { get(target, key) {
  return Object.hasOwn(overrides, key) ? overrides[String(key)] : Reflect.get(target, key, target);
} });
const pair = () => {
  const root = createStagedTestKernel({ moduleId: 'comments' });
  const local = root.bindNew(grantFor({ operations: ['read', 'write', 'maintain'] }));
  const foreign = root.bindNew(grantFor({ token: 'foreign-mutant', scope: { tenantId: 'other', workspaceId: 'w' }, operations: ['read', 'write', 'maintain'] }));
  return { root, local, foreign };
};
describe('K4 capability and ownership mutation qualification', () => {
  it('should kill scope-blind handle rebinding with the valid recipient capability', async () => {
    const { local, foreign } = pair();
    const blind = (bound: TestScope) => wrap(bound, { stageFragment: (input: Parameters<TestScope['stageFragment']>[0]) =>
      bound.stageFragment({ ...input, unit: { ...input.unit, moduleId: 'comments', scope: bound.scope } }),
    });
    await expect(runStagedOwnershipCorpus(blind(local), blind(foreign))).rejects.toThrow(/C03: a colliding foreign handle cannot stage/);
  });
  it.each(['record', 'append'] as const)('should kill a caller-owned %s buffer in the read path', async (kind) => {
    const { local, foreign } = pair();
    const alias = (bound: TestScope) => {
      let source: Parameters<TestScope['stageFragment']>[0]['effects'] | null = null;
      return wrap(bound, {
        stageFragment: async (input: Parameters<TestScope['stageFragment']>[0]) => { const result = await bound.stageFragment(input); source = input.effects; return result; },
        readRecord: async (key: string) => {
          const result = await bound.readRecord(key);
          const raw = source?.records.find((row) => row.key === key);
          return kind === 'record' && result && raw ? { ...result, bytes: raw.bytes } : result;
        },
        readChain: async (chainId: string) => (await bound.readChain(chainId)).map((row) => {
          const raw = source?.appends.find((entry) => entry.chainId === chainId && entry.record.id === row.id);
          return kind === 'append' && raw ? { ...row, bytes: raw.record.bytes } : row;
        }),
      });
    };
    const target = kind === 'record' ? /C01: nested record bytes are owned at acceptance/ : /C01: nested append bytes are owned at acceptance/;
    await expect(runStagedOwnershipCorpus(alias(local), alias(foreign))).rejects.toThrow(target);
  });
  it('should kill an audit reader that includes accepted hidden operations', async () => {
    const { local, foreign } = pair();
    let hidden = false;
    const leaking = wrap(local, {
      stageFragment: async (input: Parameters<TestScope['stageFragment']>[0]) => { const result = await local.stageFragment(input); hidden = true; return result; },
      auditRead: async () => [...await local.auditRead(), ...(hidden ? [{ staged: true }] : [])],
    });
    await expect(runStagedOwnershipCorpus(leaking, foreign)).rejects.toThrow(/C01: staged effects stay invisible to the audit reader/);
  });
  it('should kill a runtime that omits the current fence registry check', async () => {
    const check = vi.spyOn(StagedCore.prototype, 'assertFence').mockImplementation(() => undefined);
    try {
      const { root, local } = pair();
      await expect(runStagedFenceRotationCorpus(local, (fence) => root.rotateFence(local.scope, fence)))
        .rejects.toThrow(/C03: a superseded fence cannot publish/);
    } finally { check.mockRestore(); }
  });
});
