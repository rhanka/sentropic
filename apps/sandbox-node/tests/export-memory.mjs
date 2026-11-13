import assert from 'node:assert/strict';
import { createExecutionNode, FakeRuntimeAdapter } from '../dist/index.js';

class ArchiveAdapter extends FakeRuntimeAdapter {
  async exportOutput() { return Buffer.alloc(8 * 1048576); }
}
const { daemon } = createExecutionNode({ adapter: new ArchiveAdapter() });
const devScope = { kind: 'ui', writable: ['ui/**'], refused: ['ui/dist/**'], source: { repo: 'gc-fixture', path: 'scope', commit: '1' } };
const ownership = { tenantId: 'sentropic', poolOwned: false, workspaceId: 'w', principalId: 'p', attemptId: 'a', purpose: 'test', generation: 1, custodyEpoch: 1 };
const refs = [];
for (let i = 0; i < 8; i++) {
  refs.push(await (async () => {
    const box = await daemon.createSandbox({ commandId: `create-${i}`, ownership, spec: { tenantId: 'sentropic', devScope,
      profile: 'node-22', baseMounts: [], quotaMiB: 8, quotaInodes: 32, command: ['/bin/sleep', 'infinity'] } });
    await daemon.promoteToRunning('sentropic', box.id, { commandId: `run-${i}`, devScope, uid: 1000, gid: 1000, quotaMiB: 704 });
    await daemon.stopSandbox('sentropic', box.id, { commandId: `stop-${i}`, devScope, stop: { retainOutput: true } });
    const output = await daemon.exportArtifacts('sentropic', box.id, { commandId: `export-${i}`, devScope,
      spec: { buildId: `b-${i}`, subPath: 'ui/dist', maxBytes: 16 * 1048576 } });
    const ref = new WeakRef(output.bytes);
    await daemon.deleteSandbox('sentropic', box.id, { commandId: `delete-${i}`, devScope });
    return ref;
  })());
}
for (let i = 0; i < 3; i++) { await new Promise(resolve => setImmediate(resolve)); global.gc(); }
assert.equal(refs.filter(ref => ref.deref()).length, 0, 'destroyed archive buffers remain reachable');
// Keep the daemon strongly reachable through every GC cycle.
assert.equal(daemon.listSandboxes('sentropic').length, 8);
console.log('PASS: eight 8 MiB archive buffers reclaimed while daemon remains alive');
