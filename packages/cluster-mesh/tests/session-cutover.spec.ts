import { describe, expect, it } from 'vitest';
import {
  activateSessionCutover,
  rollbackSessionCutover,
  type NamespaceCutoverRecord,
} from '../src/index.js';

describe('session durable cutover', () => {
  it('selects one author after shadow proof and rolls back to the prior generation', async () => {
    let record: NamespaceCutoverRecord | null = null;
    const store = {
      async find() { return record; },
      async activate(next: NamespaceCutoverRecord) { record = next; },
      async rollback(_key: unknown, generationId: string) {
        record = { ...record!, selectedGenerationId: generationId, status: 'rolled_back' };
      },
    };
    await activateSessionCutover({
      store, key: { compositionRoot: 'product', namespace: '/session' },
      generationId: 'generation-1', previousGenerationId: 'generation-0', author: 'session-module',
      strategy: 'runtime-shadow',
      async readLegacy() { return { sessions: 1, devices: 1 }; },
      async readCandidate() { return { sessions: 1, devices: 1 }; },
      async validateDriveIntent() { return true; },
    });
    expect(record).toMatchObject({ status: 'active', activeAuthor: 'session-module' });
    await rollbackSessionCutover({ store, key: { compositionRoot: 'product', namespace: '/session' } });
    expect(record).toMatchObject({ status: 'rolled_back', selectedGenerationId: 'generation-0' });
  });

  it('rejects a real mismatch between independent legacy and candidate snapshots', async () => {
    await expect(activateSessionCutover({
      store: {
        async find() { return null; }, async activate() {}, async rollback() {},
      },
      key: { compositionRoot: 'product', namespace: '/session' },
      generationId: 'generation-1', previousGenerationId: 'generation-0', author: 'session-module',
      strategy: 'runtime-shadow',
      async readLegacy() { return { sessions: 1, devices: 1 }; },
      async readCandidate() { return { sessions: 2, devices: 1 }; },
      async validateDriveIntent() { return true; },
    })).rejects.toThrow('session cutover shadow proof failed');
  });
});
