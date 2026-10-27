import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { acceptsCommentsRefusal, RESERVED_NEXT } from './pack-only-dev-gate.mjs';
const resolved = [];
registerHooks({ resolve(specifier, context, next) {
  assert.ok(!/^(@sentropic\/comments(?:\/|$)|pg$|drizzle(?:-orm)?(?:\/|$))/.test(specifier), `disabled dependency evaluated: ${specifier}`);
  const result = next(specifier, context); resolved.push(result.url);
  assert.ok(!result.url.startsWith('file:///workspace/'), 'checkout resolution is forbidden');
  return result;
} });
const root = await import('@sentropic/cluster-mesh');
await import('@sentropic/cluster-mesh/storage');
await import('@sentropic/cluster-mesh/storage/postgres');
const { createCommentsNamespaceModule } = await import('@sentropic/cluster-mesh/compose/comments');
const modules = root.createClusterMeshModules();
const disabled = await createCommentsNamespaceModule(modules, { enabled: false, createRouter() { throw new Error('disabled router evaluated'); } });
assert.equal(disabled.enabled, false);
// Pack-only topic branches carry `<reservedNext>-dev.N` by plan: their leaf
// sits outside the frozen Comments range, so the bare install refuses with
// `incompatible_version` instead of `not_installed`. The pair is read from the
// refusal itself: the installed filesystem always carries this package, so it
// cannot prove which pair the loader refused.
const packOnly = { publishedPin: process.env.CM_PACK_ONLY_PIN ?? '', reservedNext: RESERVED_NEXT };
await assert.rejects(modules.load('comments'), (error) => acceptsCommentsRefusal({
  ...packOnly, packageName: error.packageName, installedVersion: error.installedVersion,
  reason: error.reason, code: error.code,
}));
assert.ok(!resolved.some((url) => url.includes('/@sentropic/comments/') || url.includes('/node_modules/pg/')));
console.log(JSON.stringify({ bareRoot: 'pass', storageLeaves: 'pass', disabledComments: 'pass', missingPeerRefusal: 'pass' }));
