import { it } from 'node:test';
import assert from 'node:assert/strict';
import { packedScope, preparePackedGate } from '../packed.mjs';
it('discovers only packed tests and refuses missing/source/outside scopes', () => {
  const names = ['host-exports.test.ts', 'session-store-restart.test.ts', 'host-child.ts'];
  assert.deepEqual(packedScope('tools/gateway-evolution/packed', names), names.slice(0, 2));
  for (const scope of ['packages/llm-gateway/tests/session-store.test.ts', 'tools/gateway-evolution/packed/../source.test.ts', 'tools/gateway-evolution/packed/missing.test.ts', 'tools/gateway-evolution/packed/host-child.ts']) assert.throws(() => packedScope(scope, names), { code: 'bad-scope' });
});
it('refuses unowned staging paths before reading artifacts or starting installs', async () => {
  await assert.rejects(preparePackedGate({ output: '/tmp/not-owned', manifestPath: 'missing', scope: 'all' }), { code: 'bad-path' });
});
