import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readTaskWitness } from '../../dist/index.js';
import { createSystemdUserAdapterInternal } from '../../dist/systemd/adapter.js';
import { computeExpectedIntervalMs, probeSystemdUserAvailability, renderSystemdUnits } from '../../dist/systemd/index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.resolve(here, '..', '..');
const nodeBin = realpathSync(process.execPath);
const ciRunner = realpathSync(path.join(here, 'ci-runner.mjs'));
const prodRunner = realpathSync(path.join(here, 'prod-runner.mjs'));
const taskOk = realpathSync(path.join(here, 'task-ok.mjs'));
const unitDir = path.join(process.env.XDG_RUNTIME_DIR, 'systemd', 'user');
mkdirSync(unitDir, { recursive: true, mode: 0o700 });

const tmpBase = path.join(pkgRoot, '..', '..', '.tmp');
mkdirSync(tmpBase, { recursive: true, mode: 0o700 });
const workDir = mkdtempSync(path.join(tmpBase, 'lsch-sdci-'));
chmodSync(workDir, 0o700);
const stateDir = path.join(workDir, 'state');
const envFilePath = path.join(workDir, 'env');
const passHost = () => {};
const adapter = createSystemdUserAdapterInternal({ stateDir, envFilePath, hostPidGuard: passHost });

const systemctl = (args) => execFileSync('systemctl', ['--user', ...args], { encoding: 'utf8' });
const makeSpec = (taskId, args, extra = {}) => ({
  v: 1, taskId, owner: 'ci', description: `CI task ${taskId}`,
  schedule: { onCalendar: 'daily', persistent: true },
  command: { bin: nodeBin, args }, timeoutMs: 30_000, killGraceMs: 2_000, ...extra,
});
const makePolicy = (runnerArgs, allowedScripts) => ({
  runner: { bin: nodeBin, args: runnerArgs },
  allowedBins: [nodeBin], allowedScripts, unitDir, stateDir, envFilePath, runtime: true,
});

try {
  // 1. Availability & calendar interval derivation
  const avail = await probeSystemdUserAvailability();
  assert.equal(avail.available, true);
  assert.equal(await computeExpectedIntervalMs('*-*-* 03:00:00'), 86_400_000);
  assert.equal(await computeExpectedIntervalMs('*-*-* 00/6:00:00'), 21_600_000);

  // 2. systemd-analyze verify --user on % + space + $$ + ${X} golden unit (m-25)
  const trickyDir = path.join(workDir, '100% dir');
  mkdirSync(trickyDir, { mode: 0o700 });
  const trickyScript = path.join(trickyDir, 'run$$${X}.mjs');
  writeFileSync(trickyScript, 'console.log(1);\n', { mode: 0o600 });
  const golden = renderSystemdUnits({
    v: 1, enabled: true, installedAt: '2026-11-26T00:00:00.000Z', enabledAt: '2026-11-26T00:00:00.000Z',
    stateDir: path.join(trickyDir, 'state%dir'), envFilePath: path.join(trickyDir, 'env%file'), expectedIntervalMs: 86_400_000,
    spec: makeSpec('ci-verify', [trickyScript]), runner: { bin: nodeBin, args: [trickyScript] },
  });
  const verifyService = path.join(unitDir, 'sentropic-task-ci-verify.service');
  const verifyTimer = path.join(unitDir, 'sentropic-task-ci-verify.timer');
  writeFileSync(verifyService, golden.service, { mode: 0o600 });
  writeFileSync(verifyTimer, golden.timer, { mode: 0o600 });
  execFileSync('systemd-analyze', ['verify', '--user', verifyService, verifyTimer], { encoding: 'utf8' });
  rmSync(verifyService);
  rmSync(verifyTimer);

  // 3. Full lifecycle + UnsetEnvironment=NODE_OPTIONS + RestrictAddressFamilies=AF_UNIX
  writeFileSync(envFilePath, 'NODE_OPTIONS=--require=/nonexistent-loader.cjs\n', { mode: 0o600 });
  await adapter.enable(makeSpec('ci-life', [taskOk, 'tcp-probe']), makePolicy([ciRunner, taskOk], [ciRunner, taskOk]));
  systemctl(['start', '--', 'sentropic-task-ci-life.service']);
  const wLife = readTaskWitness(stateDir, 'ci-life');
  assert.equal(wLife?.outcome, 'succeeded');
  assert.equal(wLife?.trigger, 'manual');
  await adapter.enable(makeSpec('ci-life', [taskOk, 'ok'], { schedule: { onCalendar: '*-*-* 04:00:00', persistent: true } }), makePolicy([ciRunner, taskOk], [ciRunner, taskOk]));
  assert.equal((await adapter.status('ci-life')).systemd.timerActive, 'active');
  systemctl(['start', '--', 'sentropic-task-ci-life.service']);
  const lifeLog = readFileSync(path.join(stateDir, 'tasks', 'ci-life', 'runs.log'), 'utf8');
  assert.match(lifeLog, /tcp-blocked:/);
  assert.match(lifeLog, /NODE_OPTIONS=unset/);
  await adapter.disable('ci-life', { unitDir, stateDir, runtime: true });
  await adapter.uninstall('ci-life', { unitDir, stateDir, runtime: true, purgeState: true });
  assert.equal(existsSync(path.join(stateDir, 'tasks', 'ci-life')), false);

  // 3b. Real systemd-analyze + injected systemctl enable failure rollback (m-29)
  const { defaultExecFile } = await import('../../dist/systemd/systemctl.js');
  const rbAdapter = createSystemdUserAdapterInternal({
    stateDir, envFilePath, hostPidGuard: passHost,
    execFile: async (f, a, o) => {
      if (f === 'systemctl' && a[1] === 'enable') throw Object.assign(new Error('fail'), { stderr: 'injected enable failure' });
      return defaultExecFile(f, a, o);
    },
  });
  await assert.rejects(rbAdapter.enable(makeSpec('ci-rb', [taskOk, 'ok']), makePolicy([ciRunner, taskOk], [ciRunner, taskOk])), { code: 'SYSTEMCTL_FAILED', rolledBack: true });
  assert.equal(existsSync(path.join(unitDir, 'sentropic-task-ci-rb.service')), false);

  // 4. SuccessExitStatus=130 143 on SIGTERM stop
  await adapter.enable(makeSpec('ci-stop', [taskOk, 'hang']), makePolicy([ciRunner, taskOk], [ciRunner, taskOk]));
  systemctl(['start', '--no-block', '--', 'sentropic-task-ci-stop.service']);
  await new Promise((r) => setTimeout(r, 400));
  systemctl(['stop', '--', 'sentropic-task-ci-stop.service']);
  const stopSt = await adapter.status('ci-stop', { stateDir });
  assert.equal(stopSt.witness?.outcome, 'interrupted');
  assert.equal(stopSt.systemd.serviceActive, 'inactive');
  assert.equal(stopSt.systemd.serviceResult, 'success');
  await adapter.uninstall('ci-stop', { unitDir, stateDir, runtime: true, purgeState: true });

  // 5. ExecMainStatus=203 and both ExecMainStatus=77 branches (m-28(a))
  const fakeBin = path.join(workDir, 'missing-bin');
  writeFileSync(fakeBin, Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0x00]), { mode: 0o700 });
  await adapter.enable(makeSpec('ci-203', [taskOk, 'ok']), { runner: { bin: fakeBin, args: [] }, allowedBins: [nodeBin, fakeBin], allowedScripts: [taskOk], unitDir, stateDir, envFilePath, runtime: true });
  rmSync(fakeBin);
  try { systemctl(['start', '--', 'sentropic-task-ci-203.service']); } catch { /* expected 203 */ }
  assert.match((await adapter.status('ci-203', { stateDir })).systemd.execDiagnostic ?? '', /203\/EXEC/);
  await adapter.uninstall('ci-203', { unitDir, stateDir, runtime: true, purgeState: true });

  const otherScript = path.join(workDir, 'other.mjs');
  writeFileSync(otherScript, 'process.exit(0);\n', { mode: 0o600 });
  await adapter.enable(makeSpec('ci-77a', [taskOk, 'ok']), makePolicy([ciRunner, otherScript], [ciRunner, taskOk, otherScript]));
  try { systemctl(['start', '--', 'sentropic-task-ci-77a.service']); } catch { /* expected 77 */ }
  assert.match((await adapter.status('ci-77a', { stateDir })).systemd.execDiagnostic ?? '', /command refused by the allow-list/);
  await adapter.uninstall('ci-77a', { unitDir, stateDir, runtime: true, purgeState: true });

  await adapter.enable(makeSpec('ci-77b', [taskOk, 'ok']), makePolicy([prodRunner, taskOk], [prodRunner, taskOk]));
  try { systemctl(['start', '--', 'sentropic-task-ci-77b.service']); } catch { /* expected 77 */ }
  assert.match((await adapter.status('ci-77b', { stateDir })).systemd.execDiagnostic ?? '', /refused before the lock/);
  await adapter.uninstall('ci-77b', { unitDir, stateDir, runtime: true, purgeState: true });

  console.log('PASS systemd-ci-suite');
} finally {
  rmSync(workDir, { recursive: true, force: true });
}
