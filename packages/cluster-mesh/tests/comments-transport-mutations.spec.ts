import assert from 'node:assert/strict';
import { describe, expect, it, vi } from 'vitest';
import { COMMAND_CAPABILITIES } from '@sentropic/comments';
import { createCommentsFragment, createCommentsModule } from '../src/comments/index.js';
import * as bindingCodec from '../src/comments/binding-codec.js';
import * as importEffects from '../src/comments/import-effects.js';
import { createPostgresKernel } from '../src/storage/postgres/index.js';
import { commentsHost, importRequest, prepareImport, commitImport } from './storage/comments-host.js';
import { grantFor } from './storage/authority-corpus.js';
import { pgEnabled } from './storage/pg-driver.js';
import { conformanceResource } from '../assets/storage/comments/oracle/conformance.mjs';

const bindingProbe = async (terminal = false) => {
  const h = await commentsHost();
  try {
    await h.module.withContext(h.grant, async () => {
      const records = [h.annotation('a')];
      const request = importRequest(h, [{ unitId: 'u', records }]);
      const binding = {
        version: 'comments-transport-v1' as const, operationId: 'binding-probe', request, unitIds: ['u'],
        sourceBoundary: 'source', targets: [conformanceResource(h.scope)], capabilities: COMMAND_CAPABILITIES,
      };
      const bindingDigest = terminal ? bindingCodec.commentsImportBindingDigest(binding) : '0'.repeat(64);
      const first = createCommentsFragment({ scope: h.scope, operationId: binding.operationId, bindingDigest,
        unitId: 'u', ordinal: '0', predecessorHash: null, terminal: null }, records);
      if (!terminal) {
        await assert.rejects(() => h.module.services.prepareImportFragment({ binding, fragment: first, fence: h.fence }),
          { condition: 'conflict' }, 'CM binding probe: reject foreign binding digest');
        return;
      }
      await h.module.services.prepareImportFragment({ binding, fragment: first, fence: h.fence });
      const last = createCommentsFragment({ scope: h.scope, operationId: binding.operationId, bindingDigest,
        unitId: null, ordinal: '1', predecessorHash: first.digest,
        terminal: { fragmentCount: '2', unitRoots: [{ unitId: 'u', records: '1', payloadDigest: '0'.repeat(64) }] } }, []);
      await assert.rejects(() => h.module.services.prepareImportFragment({ binding, fragment: last, fence: h.fence }),
        { condition: 'incomplete' }, 'CM terminal probe: recompute accepted payload root');
      assert.equal(await h.module.store.getAnnotationHead(h.scope, 'a'), null);
    });
  } finally { await h.fixture.close(); }
};

const ownerProbe = async (mutate = false) => {
  const h = await commentsHost();
  try {
    const units = [{ unitId: 'u', records: [h.annotation('a')] }];
    const request = importRequest(h, units);
    await h.module.withContext(h.grant, async () => {
      await commitImport(h, request, await prepareImport(h, request, 'owner-operation', units));
    });
    const original = h.fixture.options.driver;
    const driver = { transaction: (options, operation) => original.transaction(options, (session) => operation({
      execute: (statement) => session.execute({ ...statement,
        text: mutate ? statement.text.replace('AND p.owner=$4', 'AND $4::text IS NOT NULL') : statement.text,
      }),
    })) } satisfies typeof original;
    const root = await createPostgresKernel({ ...h.fixture.options, driver });
    const reader = grantFor({ scope: h.scope, token: 'other-owner', principalId: 'other-user', operations: ['read'] });
    await root.bindNew(reader);
    const module = createCommentsModule({ storage: root.adapter(), capacity: h.capacity });
    await assert.doesNotReject(async () => {
      const receipts = await module.withContext(reader, () => module.services.recoverBatchReceipts({
        scope: h.scope, batchId: request.batchId, manifestHash: request.manifest.hash,
      }));
      assert.deepEqual(receipts, [], 'CM owner probe: recovery filters foreign operations');
    }, 'CM owner probe: recovery filters foreign operations');
  } finally { await h.fixture.close(); }
};

describe.skipIf(!pgEnabled)('recorded comments transport mutants', () => {
  it('should kill bypassed binding digest derivation', async () => {
    await bindingProbe();
    const mutant = vi.spyOn(bindingCodec, 'commentsImportBindingDigest').mockReturnValue('0'.repeat(64));
    try { await expect(bindingProbe()).rejects.toThrow('CM binding probe: reject foreign binding digest'); }
    finally { mutant.mockRestore(); }
  });
  it('should kill trusting the terminal declared payload root', async () => {
    await bindingProbe(true);
    const mutant = vi.spyOn(importEffects, 'verifyCommentsTerminal')
      .mockImplementation((_state, fragment) => fragment.manifest.terminal!.unitRoots);
    try { await expect(bindingProbe(true)).rejects.toThrow('CM terminal probe: recompute accepted payload root'); }
    finally { mutant.mockRestore(); }
  });
  it('should kill removal of the receipt owner SQL filter', async () => {
    await ownerProbe();
    await expect(ownerProbe(true)).rejects.toThrow('CM owner probe: recovery filters foreign operations');
  });
});
