import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync, copyFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { RunscRuntimeAdapter, type RunSandboxOptions } from './runtime-adapter.js';
import { prepareBundle, destroyBundle, type Bundle } from './bundle.js';
import { SandboxCgroup } from './cgroups.js';
import { qualificationProcesses, assertQualificationProcessesGone } from './qualification-processes.js';
import { assertCleanStartup } from './restart.js';
import { qualificationDiskMiB, qualificationInodes } from './qualification-storage.js';

/** Child is the disposable gate/agent process; the parent retains the node flock. */
export async function qualificationCrashWorker(path: string) {
  assert.equal(process.env.QUALIFICATION_ONLY, 'isolated');
  assert.equal(process.getuid?.(), 0);
  const options = JSON.parse(readFileSync(join(path, 'options.json'), 'utf8')) as RunSandboxOptions;
  process.env.EXECUTION_NODE_PORTS_ENABLED = 'true';
  const adapter = new RunscRuntimeAdapter('runsc', {
    prepare: options => {
      const bundle = prepareBundle(options);
      writeFileSync(join(path, 'bundle.json'), JSON.stringify(bundle), { mode: 0o600 });
      return bundle;
    }, destroy: destroyBundle,
  });
  await adapter.runSandbox({ ...options, onExit: () => process.exit(7) });
  writeFileSync(join(path, 'ready.json'), JSON.stringify(qualificationProcesses(options.sandboxUid)), { mode: 0o600 });
  setInterval(() => {}, 1000);
}

export async function qualifyCrashAndFailure(directory: string, release: string): Promise<void> {
  const run = (file: string, args: string[]) => execFileSync(file, args,
    { encoding: 'utf8', timeout: 5000, killSignal: 'SIGKILL', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  for (const network of ['none', 'ports'] as const) for (const failure of [false, true]) {
    assertCleanStartup();
    const uid = `qual-crash-${randomUUID()}`, path = join(directory, uid);
    mkdirSync(path, { mode: 0o700 });
    copyFileSync(join(release, 'qualification.erofs'), join(path, 'source.erofs'));
    const options: RunSandboxOptions = { network, tenantId: 'sentropic', sandboxUid: uid,
      overlayUpper: join(path, 'box/upper'), overlayWork: join(path, 'box/work'),
      quotaMiB: 704, diskQuotaMiB: qualificationDiskMiB, quotaInodes: qualificationInodes, uid: 1000, gid: 1000,
      command: ['/usr/local/bin/node', '-e', failure ? 'setTimeout(()=>process.exit(1),1500)' : 'setInterval(()=>{},1000)'],
      mounts: [{ source: join(release, 'rootfs.erofs'), target: '/bases/rootfs/release', readOnly: true },
        { source: join(path, 'source.erofs'), target: '/bases/source/qualification', readOnly: true }] };
    writeFileSync(join(path, 'options.json'), JSON.stringify(options), { mode: 0o600 });
    const child = spawn(process.execPath, ['--qualify-crash-worker', path], { stdio: 'ignore' });
    const exited = new Promise<{ code: number | null; signal: string | null }>((resolve, reject) => {
      child.once('error', reject); child.once('exit', (code, signal) => resolve({ code, signal }));
    });
    void exited.catch(() => {});
    let cleaned = false;
    try {
      const deadline = Date.now() + 8000;
      while (!existsSync(join(path, 'ready.json'))) {
        assert.ok(child.exitCode === null && Date.now() < deadline, 'crash fixture readiness failed');
        await new Promise(resolve => setTimeout(resolve, 25));
      }
      if (!failure) child.kill('SIGKILL');
      const result = await Promise.race([exited, new Promise<never>((_, reject) => {
        const timer = setTimeout(() => reject(new Error('crash worker exit deadline')), 5000); timer.unref();
      })]);
      if (failure) assert.equal(result.code, 7); else assert.equal(result.signal, 'SIGKILL');
      assert.throws(() => assertCleanStartup(), /surviving sandbox/);
    } finally {
      child.kill('SIGKILL'); await exited;
      const scope = `builder-sbx-${uid}.scope`;
      const group = run('systemctl', ['show', scope, '--property=ControlGroup', '--value']);
      if (group) assert.ok(await new SandboxCgroup().stop(scope, 'sentropic'), 'crash scope did not quiesce');
      const inventory = JSON.parse(run('runsc', ['--root=/run/execution-node/runsc', 'list', '--format=json']) || 'null') ?? [];
      if (inventory.some((box: { id: string }) => box.id === `sandbox-${uid}`)) run('runsc', ['--root=/run/execution-node/runsc', 'delete', '--force', `sandbox-${uid}`]);
      if (run('systemctl', ['list-units', '--all', '--plain', '--no-legend', scope])) run('systemctl', ['stop', scope]);
      if (existsSync(join(path, 'bundle.json'))) destroyBundle(JSON.parse(readFileSync(join(path, 'bundle.json'), 'utf8')) as Bundle);
      if (existsSync(join(path, 'ready.json'))) assertQualificationProcessesGone(JSON.parse(readFileSync(join(path, 'ready.json'), 'utf8')));
      assertCleanStartup();
      assert.ok(!readFileSync('/proc/self/mountinfo', 'utf8').split('\n').some(line => line.split(' ')[4]?.startsWith(`${path}/`)));
      cleaned = true;
      if (cleaned) rmSync(path, { recursive: true });
    }
    console.log(`PASS ${network} ${failure ? 'failure' : 'SIGKILL gate crash'} reconciled: no scope, runtime, mount, process or netns`);
  }
}
