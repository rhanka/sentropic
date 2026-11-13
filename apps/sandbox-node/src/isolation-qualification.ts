import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, chmodSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { RunscRuntimeAdapter } from './runtime-adapter.js';
import { isolationProbe, requireIsolationResults } from './isolation-probe.js';

export function prepareIsolationFixture(base: string): string {
  const fixture = join(base, 'fixture'), marker = join(fixture, 'isolation-marker');
  mkdirSync(join(fixture, 'node_modules'), { recursive: true });
  chmodSync(fixture, 0o777);
  writeFileSync(marker, 'isolation fixture', { mode: 0o666 });
  // Defeat the host umask: a DAC denial must not substitute for the EROFS check.
  chmodSync(marker, 0o666);
  return fixture;
}

export async function qualifyIsolation(): Promise<void> {
  assert.equal(process.env.QUALIFICATION_ONLY, 'isolated', 'isolated qualification host required');
  assert.equal(process.getuid?.(), 0, 'root required');
  assert.ok(existsSync('/etc/execution-node/isolated-qualification'), 'isolated qualification marker required');
  const release = dirname(process.execPath), root = '/var/lib/builder/tenants';
  const run = (file: string, args: string[]) => execFileSync(file, args, { encoding: 'utf8', timeout: 10000 }).trim();
  let failed = false;
  const report = (name: string, ok: boolean) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`); if (!ok) failed = true; };
  let interrupted = false;
  const interrupt = () => { interrupted = true; report('qualification interrupted', false); };
  process.once('SIGINT', interrupt); process.once('SIGTERM', interrupt);
  const adapter = new RunscRuntimeAdapter();
  const boxes: Array<{ tenant: string; uid: string; path: string; base: string; image: string; loop: string; runtimeId?: string }> = [];
  try {
    for (const tenant of ['sentropic', 'immo']) {
      assert.ok(!interrupted, 'qualification interrupted');
      // Require the installed tenant loop mounts; never create or modify them.
      const device = run('findmnt', ['--noheadings', '--raw', '--output=SOURCE', '--mountpoint', join(root, tenant)]);
      assert.match(device, /^\/dev\/loop[0-9]+$/);
      const loop = run('losetup', ['--noheadings', '--output=BACK-FILE', device]);
      assert.ok(loop.startsWith('/'));
      const uid = `qual-isolation-${randomUUID()}`, path = join(root, tenant, 'sandboxes', uid);
      const base = mkdtempSync(join(root, tenant, 'bases', 'qual-isolation-'));
      const image = join(base, 'source.erofs');
      boxes.push({ tenant, uid, path, base, image, loop });
      const fixture = prepareIsolationFixture(base);
      run('mkfs.erofs', ['--quiet', '--all-root', '-T', '1767225600', image, fixture]);
      const { runtimeId } = await adapter.runSandbox({ tenantId: tenant, sandboxUid: uid,
        overlayUpper: join(path, 'upper'), overlayWork: join(path, 'work'), quotaMiB: 704,
        diskQuotaMiB: 16, quotaInodes: 1024, uid: 1000, gid: 1000,
        command: ['/usr/local/bin/node', '-e', 'setInterval(() => {}, 1000)'],
        mounts: [{ source: join(release, 'rootfs.erofs'), target: '/bases/rootfs/release', readOnly: true },
          ...['source', 'dependencies'].map(kind => ({ source: image, target: `/bases/${kind}/qualification`, readOnly: true }))],
      });
      boxes[boxes.length - 1]!.runtimeId = runtimeId;
      report(`${tenant} real runsc systrap started`, true);
    }
    for (const box of boxes) {
      assert.ok(!interrupted, 'qualification interrupted');
      const other = boxes.find(candidate => candidate.tenant !== box.tenant)!;
      const paths = [{ path: other.path, directory: true }, { path: join(root, other.tenant, 'bases'), directory: true },
        { path: other.loop, directory: false }, { path: join(root, other.tenant), directory: true },
        ...['/var/lib/builder', '/etc/execution-node/keys', '/run/execution-node'].map(path => ({ path, directory: true }))];
      const result = run('runsc', ['--root=/run/execution-node/runsc', 'exec', `sandbox-${box.uid}`,
        '/usr/local/bin/node', '-e', isolationProbe(paths)]);
      requireIsolationResults(result, (name, ok) => report(`${box.tenant} ${name}`, ok), paths.length * 2 + 9);
      const scope = `builder-sbx-${box.uid}.scope`;
      for (const [property, expected] of Object.entries({ Slice: `builder-tenant-${box.tenant}.slice`,
        MemoryHigh: String(704 * 1048576), MemoryLow: String(704 * 1048576), CPUWeight: '200', TasksMax: '512', OOMPolicy: 'kill' })) {
        report(`${box.tenant} scope ${property}`, run('systemctl', ['show', scope, `--property=${property}`, '--value']) === expected);
      }
      const group = run('systemctl', ['show', scope, '--property=ControlGroup', '--value']);
      report(`${box.tenant} cgroup ancestry`, group.startsWith(`/builder.slice/builder-tenant.slice/builder-tenant-${box.tenant}.slice/`) && group.endsWith(`/${scope}`));
    }
  } catch { report('real-host isolation execution', false); }
  finally {
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
      } catch { report(`${box.tenant} cleanup`, false); }
    }
    process.removeListener('SIGINT', interrupt); process.removeListener('SIGTERM', interrupt);
  }
  if (failed) throw new Error('isolation qualification failed');
}
