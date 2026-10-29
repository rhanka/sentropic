import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const transferPath = 'spec/evidence/memory-mcp-l5/p3-registry-v9-obligations.md';
const transferSha = '51c80d524644a8038c29adbe4f9fed253e1c24dcee09e6d29c97e0d894607e7f';
const remoteFiles = [
  'packages/mcp-platform/tests/remote-bound-dispatch.test.ts',
  'packages/cluster-mesh/tests/registry/remote-adapter.spec.ts',
  'packages/cluster-mesh/tests/registry/host-bridge.spec.ts',
  'packages/cluster-mesh/tests/registry/host-bridge.e2e.spec.ts',
];

/** Resolve the approved memory-first transfer without editing the frozen catalog. */
export function resolvePredecessors(root, catalog) {
  try {
    const bytes = readFileSync(resolve(root, transferPath));
    if (sha(bytes) !== transferSha) return { resolved: false };
    const mappings = catalog.pendingPredecessorMappings, p09 = catalog.proofs.find(p => p.id === 'P09');
    const expected = [...remoteFiles, 'tools/memory-mcp-l5/fixtures/l0'];
    if (!Array.isArray(mappings) || mappings.length !== expected.length ||
        expected.some(file => mappings.filter(m => m.file === file).length !== 1) ||
        p09?.files.length !== 18 || !p09.files.every(file => existsSync(resolve(root, file)))) return { resolved: false };
    const preBytes = readFileSync(resolve(root, 'tools/memory-mcp-l5/artifacts/pre-candidate-manifest.json'));
    if (sha(preBytes) !== '1c96bada2a749155f29aae763fa73ea6379c385d619f70614110f59b6b10b730') return { resolved: false };
    const pre = JSON.parse(preBytes), fixture = pre.contractInventory.find(row => row.path.endsWith('/60a8bfa828b5eabd360232ea5865391c23f99f48/index.json'));
    if (!fixture || sha(readFileSync(resolve(root, fixture.path))) !== fixture.sha256) return { resolved: false };
    return { resolved: true, authority: { path: transferPath, sha256: transferSha },
      l0Fixture: fixture, transferred: remoteFiles.map(file => ({ file, owners: ['R2', 'R7a'],
        status: 'required in later 22-suite R2-MEMORY and R7a-MEMORY acceptance; not executed by L5' })) };
  } catch { return { resolved: false }; }
}
