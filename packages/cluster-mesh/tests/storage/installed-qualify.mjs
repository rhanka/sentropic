import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const resolutions = [];
registerHooks({ resolve(specifier, context, next) {
  if (context.parentURL?.includes('/@sentropic/cluster-mesh/')) assert.ok(!/^(pg|drizzle-orm)(\/|$)/.test(specifier), 'production driver edge');
  const result = next(specifier, context); resolutions.push(result.url);
  assert.ok(!/^file:\/\/(\/workspace|\/probe)\//.test(result.url), 'checkout source resolution');
  return result;
} });
const packageRoot = new URL('../', import.meta.resolve('@sentropic/cluster-mesh'));
const oracle = new URL('assets/storage/comments/oracle/', packageRoot);
const manifest = JSON.parse(await readFile(new URL('manifest.json', oracle), 'utf8'));
for (const artifact of manifest.artifacts) assert.equal(createHash('sha256').update(await readFile(new URL(artifact.file, oracle))).digest('hex'), artifact.sha256);
const { canonicalRecordBytes, hashRecord, RECORD_KINDS } = await import('@sentropic/comments');
const vectors = JSON.parse(await readFile(new URL('revision-hash-v1.json', oracle), 'utf8'));
assert.deepEqual([...new Set(vectors.records.map((record) => record.kind))].sort(), [...RECORD_KINDS].sort());
for (const vector of vectors.records) {
  assert.equal(canonicalRecordBytes(vector.kind, vector.envelope), vector.canonical);
  assert.equal(hashRecord(vector.kind, vector.envelope), vector.digest);
}
const { installedHost, grantFor } = await import('./installed-host.mjs');
const { runCommentsConformance } = await import('./installed-oracle.mjs');
const host = await installedHost(); const grants = new Map();
try {
  const store = new Proxy({}, { get(_target, key) { return async (scope, ...args) => {
    const identity = JSON.stringify(scope); let grant = grants.get(identity);
    if (!grant) { grant = grantFor(scope); await host.root.bindNew(grant); grants.set(identity, grant); }
    return host.module.withContext(grant, () => Reflect.apply(host.module.store[key], host.module.store, [scope, ...args]));
  }; } });
  await runCommentsConformance(store);
  await host.module.withContext(host.grant, async () => {
    await assert.rejects(host.module.store.transaction().run(async () => {
      await host.module.store.appendAnnotationRevision(host.scope, 'rollback', host.annotation('rollback'), { kind: 'creation', aggregateVersion: 0 });
      assert.ok(await host.module.store.getAnnotationHead(host.scope, 'rollback'));
      throw new Error('installed rollback');
    }), /installed rollback/);
    assert.equal(await host.module.store.getAnnotationHead(host.scope, 'rollback'), null);
  });
  const { qualifyInstalledTransport } = await import('./installed-transport.mjs');
  const transport = await qualifyInstalledTransport(installedHost, grantFor);
  const { qualifyInstalledNamespace } = await import('./installed-namespace.mjs');
  const namespace = await qualifyInstalledNamespace(host);
  const archive = await readFile('/candidate.tgz');
  const report = { version: 1, archive: { sha256: createHash('sha256').update(archive).digest('hex'), integrity: `sha512-${createHash('sha512').update(archive).digest('base64')}` },
    package: JSON.parse(await readFile(new URL('package.json', packageRoot), 'utf8')).version,
    oracle: { manifest, unchangedCorpus: 'pass', elevenKinds: 'pass', pendingReadsAndRollback: 'pass' },
    injectedSingleSession: host.metrics(), transport, namespace, checkoutImports: resolutions.filter((url) => url.includes('/workspace/')) };
  await writeFile('/reports/installed-comments.json', `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report));
} finally { await host.close(); }
