import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
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
await assert.rejects(modules.load('comments'), (error) => error.reason === 'not_installed' || error.code === 'not_installed');
assert.ok(!resolved.some((url) => url.includes('/@sentropic/comments/') || url.includes('/node_modules/pg/')));
console.log(JSON.stringify({ bareRoot: 'pass', storageLeaves: 'pass', disabledComments: 'pass', missingPeerRefusal: 'pass' }));
