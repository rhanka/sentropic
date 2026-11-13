import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, copyFileSync, writeFileSync, chmodSync, rmSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { RunscRuntimeAdapter } from './runtime-adapter.js';
import { isolationProbe, requireIsolationResults } from './isolation-probe.js';
import { acquireNodeLock } from './node-lock.js';
import { assertCleanStartup } from './restart.js';
import { assertNoQualificationLeftovers } from './qualification-leftovers.js';
import { createQualificationDirectory, qualificationDiskMiB, qualificationInodes } from './qualification-storage.js';
import { qualificationPrerequisites } from './qualification-prerequisites.js';
import { hostNetworkWitnesses, qualificationHostAddresses, networkIsolationProbe, networkTargets, tenantWitnessHost, tenantWitnessScript } from './qualification-network.js';
import { waitForQualificationPort } from './qualification-runtime.js';

export async function qualifyIsolation(): Promise<void> {
  assert.equal(process.env.QUALIFICATION_ONLY, 'isolated', 'isolated qualification host required');
  assert.equal(process.getuid?.(), 0, 'root required');
  assert.ok(existsSync('/etc/execution-node/isolated-qualification'), 'isolated qualification marker required');
  const release = dirname(process.execPath), root = '/var/lib/builder/tenants';
  const run = (file: string, args: string[]) => execFileSync(file, args, { encoding: 'utf8', timeout: 10000 }).trim();
  const releaseLock = await acquireNodeLock();
  let failed = false;
  const report = (name: string, ok: boolean) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`); if (!ok) failed = true; };
  let interrupted = false;
  const interrupt = () => { interrupted = true; report('qualification interrupted', false); };
  process.once('SIGINT', interrupt); process.once('SIGTERM', interrupt);
  const adapter = new RunscRuntimeAdapter();
  const boxes: Array<{ tenant: string; network: 'none' | 'ports'; uid: string; path: string; base: string; image: string; loop: string; runtimeId?: string }> = [];
  let witnesses: Awaited<ReturnType<typeof hostNetworkWitnesses>> | undefined;
  const previousPorts = process.env.EXECUTION_NODE_PORTS_ENABLED;
  let directory: string | undefined, cleanupFailed = false;
  try {
    assert.equal(run('systemctl', ['show', 'execution-node.service', '--property=ActiveState', '--value']), 'inactive', 'service must be stopped');
    assertCleanStartup();
    assertNoQualificationLeftovers(release);
    qualificationPrerequisites(release);
    directory = createQualificationDirectory(release, 'qi');
    // Consume the operator's authorization once, under the shared lock.
    rmSync('/etc/execution-node/isolated-qualification');
    process.env.EXECUTION_NODE_PORTS_ENABLED = 'true'; // Qualification-only, never changes agent.env.
    const hosts = qualificationHostAddresses(); console.log(`RECEIPT host_public_ips=${hosts.join(',')}`);
    witnesses = await hostNetworkWitnesses();
    for (const network of ['none', 'ports'] as const) for (const tenant of ['sentropic', 'immo']) {
      assert.ok(!interrupted, 'qualification interrupted');
      // Require the installed tenant loop mounts; never create or modify them.
      const device = run('findmnt', ['--noheadings', '--raw', '--output=SOURCE', '--mountpoint', join(root, tenant)]);
      assert.match(device, /^\/dev\/loop[0-9]+$/);
      const loop = run('losetup', ['--noheadings', '--output=BACK-FILE', device]);
      assert.ok(loop.startsWith('/'));
      const uid = `qual-isolation-${randomUUID()}`, path = join(directory, tenant, 'sandboxes', uid);
      const base = mkdtempSync(join(directory, `base-${tenant}-`));
      const image = join(base, 'source.erofs');
      boxes.push({ tenant, network, uid, path, base, image, loop });
      copyFileSync(join(release, 'qualification.erofs'), image);
      const { runtimeId } = await adapter.runSandbox({ tenantId: tenant, sandboxUid: uid, network,
        overlayUpper: join(path, 'upper'), overlayWork: join(path, 'work'), quotaMiB: 704,
        diskQuotaMiB: qualificationDiskMiB, quotaInodes: qualificationInodes, uid: 1000, gid: 1000,
        command: ['/usr/local/bin/node', '-e', tenantWitnessScript(tenant)],
        mounts: [{ source: join(release, 'rootfs.erofs'), target: '/bases/rootfs/release', readOnly: true },
          ...['source', 'dependencies'].map(kind => ({ source: image, target: `/bases/${kind}/qualification`, readOnly: true }))],
      });
      boxes[boxes.length - 1]!.runtimeId = runtimeId;
      await waitForQualificationPort(uid, AbortSignal.timeout(5000), () => {});
      for (const directory of [path, base]) {
        const sentinel = join(directory, 'isolation-marker');
        writeFileSync(sentinel, 'foreign tenant sentinel', { mode: 0o666 });
        chmodSync(sentinel, 0o666);
      }
      report(`${tenant} ${network} real runsc systrap and tenant witness started`, true);
    }
    for (const box of boxes) {
      assert.ok(!interrupted, 'qualification interrupted');
      const other = boxes.find(candidate => candidate.tenant !== box.tenant && candidate.network === box.network)!;
      const targets = networkTargets(hosts, tenantWitnessHost(other.tenant));
      const networkResult = run('runsc', ['--root=/run/execution-node/runsc', 'exec', `sandbox-${box.uid}`,
        '/usr/local/bin/node', '-e', networkIsolationProbe(targets)]);
      requireIsolationResults(networkResult, (name, ok) => report(`${box.tenant} ${box.network} ${name}`, ok), targets.length + 4);
      const paths = [{ path: other.path, directory: true }, { path: other.base, directory: true },
        { path: other.loop, directory: false }, { path: join(root, other.tenant), directory: true,
          file: join(other.path, 'isolation-marker') },
        ...['/var/lib/builder', '/etc/execution-node/keys', '/run/execution-node'].map(path => ({ path, directory: true }))];
      const result = run('runsc', ['--root=/run/execution-node/runsc', 'exec', `sandbox-${box.uid}`,
        '/usr/local/bin/node', '-e', isolationProbe(paths)]);
      requireIsolationResults(result, (name, ok) => report(`${box.tenant} ${box.network} ${name}`, ok), paths.length * 2 + 9);
      const scope = `builder-sbx-${box.uid}.scope`;
      for (const [property, expected] of Object.entries({ Slice: `builder-tenant-${box.tenant}.slice`,
        MemoryHigh: String(704 * 1048576), MemoryLow: String(704 * 1048576), CPUWeight: '200', TasksMax: '512', OOMPolicy: 'kill' })) {
        report(`${box.tenant} scope ${property}`, run('systemctl', ['show', scope, `--property=${property}`, '--value']) === expected);
      }
      const group = run('systemctl', ['show', scope, '--property=ControlGroup', '--value']);
      report(`${box.tenant} cgroup ancestry`, group.startsWith(`/builder.slice/builder-tenant.slice/builder-tenant-${box.tenant}.slice/`) && group.endsWith(`/${scope}`));
    }
  } catch (error) { console.error(error instanceof Error ? error.message : 'isolation execution failed'); report('real-host isolation execution', false); }
  finally {
    if (previousPorts === undefined) delete process.env.EXECUTION_NODE_PORTS_ENABLED;
    else process.env.EXECUTION_NODE_PORTS_ENABLED = previousPorts;
    try { await witnesses?.close(); } catch { failed = true; report('host witnesses cleanup', false); }
    for (const box of boxes.reverse()) {
      try {
        // A launcher failure still registers a bundle in the real adapter.
        const runtimeId = box.runtimeId ?? `runsc-${box.tenant}-${box.uid}`;
        if (existsSync(box.path)) await adapter.destroySandbox(runtimeId);
        const mounts = readFileSync('/proc/self/mountinfo', 'utf8');
        const noMounts = !mounts.split('\n').some(line => {
          const target = line.split(' ')[4]; return target === box.path || target?.startsWith(`${box.path}/`);
        });
        report(`${box.tenant} mounts gone`, noMounts);
        report(`${box.tenant} sandbox removed`, !existsSync(box.path));
        report(`${box.tenant} scope gone`, run('systemctl', ['list-units', '--all', '--plain', '--no-legend', `builder-sbx-${box.uid}.scope`]) === '');
        assert.ok(noMounts && !existsSync(box.path));
        rmSync(box.base, { recursive: true });
        report(`${box.tenant} test bases removed`, !existsSync(box.base));
      } catch { cleanupFailed = true; report(`${box.tenant} cleanup`, false); }
    }
    process.removeListener('SIGINT', interrupt); process.removeListener('SIGTERM', interrupt);
    if (directory && !cleanupFailed) rmSync(directory, { recursive: true, force: true });
    releaseLock();
  }
  if (failed) throw new Error('isolation qualification failed');
}
