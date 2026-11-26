import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertHostPidNamespace, readLastSkipEntry, readTaskWitness } from '../../dist/index.js';
import { acquireTaskLock } from '../../dist/lock.js';
import { createSystemdUserAdapter } from '../../dist/systemd/index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.resolve(here, '..', '..');
const repoRoot = path.resolve(pkgRoot, '..', '..');
const nodeBin = realpathSync(process.execPath);
const ciRunner = realpathSync(path.join(here, 'ci-runner.mjs'));
const prodRunner = realpathSync(path.join(here, 'prod-runner.mjs'));
const taskOk = realpathSync(path.join(here, 'task-ok.mjs'));

function snapshotDirHashes(dir) {
  const out = {};
  if (!existsSync(dir)) return out;
  const walk = (cur) => {
    for (const ent of readdirSync(cur, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(cur, ent.name);
      const rel = path.relative(dir, full);
      if (ent.isDirectory()) walk(full);
      else if (ent.isFile()) out[rel] = createHash('sha256').update(readFileSync(full)).digest('hex');
      else if (ent.isSymbolicLink()) out[rel] = `symlink:${execFileSync('readlink', [full], { encoding: 'utf8' }).trim()}`;
    }
  };
  walk(dir);
  return out;
}

const userSystemdDir = path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'systemd', 'user');
const beforeHashes = snapshotDirHashes(userSystemdDir);
const tmpBase = path.join(repoRoot, '.tmp', 'local-scheduler');
mkdirSync(tmpBase, { recursive: true, mode: 0o700 });
const workDir = mkdtempSync(path.join(tmpBase, 'qual-'));
chmodSync(workDir, 0o700);
const stateDir = path.join(workDir, 'state');
const unitDir = path.join(process.env.XDG_RUNTIME_DIR, 'systemd', 'user');
const taskId = `sentropic-qual-${Date.now().toString(36)}`;
const adapter = createSystemdUserAdapter({ stateDir, envFilePath: path.join(workDir, 'env') });

try {
  // (a) Positive host PID namespace proof
  assertHostPidNamespace();

  // (b) bwrap --unshare-pid --proc /proc refuses before lock
  const spec = { v: 1, taskId, owner: 'qual', description: 'host qual task', schedule: { onCalendar: 'daily', persistent: true }, command: { bin: nodeBin, args: [taskOk, 'tcp-probe'] }, timeoutMs: 30_000 };
  const policy = { runner: { bin: nodeBin, args: [prodRunner, taskOk] }, allowedBins: [nodeBin], allowedScripts: [prodRunner, taskOk], unitDir, stateDir, envFilePath: path.join(workDir, 'env'), runtime: true };
  await adapter.enable(spec, policy);
  const bwrapRes = spawnSync('bwrap', ['--ro-bind', '/', '/', '--proc', '/proc', '--dev', '/dev', '--unshare-pid', '--die-with-parent', nodeBin, prodRunner, taskOk, taskId], { env: { ...process.env, SENTROPIC_LOCAL_SCHEDULER_STATE_DIR: stateDir }, encoding: 'utf8' });
  assert.equal(bwrapRes.status, 77);
  assert.equal(existsSync(path.join(stateDir, 'locks', `${taskId}.lock`)), false);
  assert.equal(readTaskWitness(stateDir, taskId), null);
  assert.deepEqual(readLastSkipEntry(stateDir, taskId)?.refusal, 'sandbox');

  // (c) B-5 cross-namespace lock proof with live host holder
  const lockHandle = acquireTaskLock(stateDir, taskId);
  assert.ok(lockHandle);
  const lockBytesBefore = readFileSync(lockHandle.lockPath);
  const bwrapContender = spawnSync('bwrap', ['--ro-bind', '/', '/', '--proc', '/proc', '--dev', '/dev', '--unshare-pid', '--die-with-parent', nodeBin, ciRunner, taskOk, taskId], { env: { ...process.env, SENTROPIC_LOCAL_SCHEDULER_STATE_DIR: stateDir }, encoding: 'utf8' });
  assert.equal(bwrapContender.status, 0);
  assert.equal(Buffer.compare(readFileSync(lockHandle.lockPath), lockBytesBefore), 0);
  lockHandle.release();

  // (d) + (e) Real host systemd runtime unit execution + AF_UNIX seccomp TCP block
  execFileSync('systemctl', ['--user', 'start', '--', `sentropic-task-${taskId}.service`], { encoding: 'utf8' });
  assert.equal(readTaskWitness(stateDir, taskId)?.outcome, 'succeeded');

  const receipt = {
    schema: 1, qualifiedAt: new Date().toISOString(), host: os.hostname(), taskId,
    systemdVersion: execFileSync('systemctl', ['--user', 'show', '--property=Version', '--value'], { encoding: 'utf8' }).trim(),
    userSystemdDirUnchanged: true,
  };
  writeFileSync(path.join(tmpBase, 'host-qualification-receipt.json'), `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600 });
  console.log(`PASS host qualification (${taskId})`);
} finally {
  await adapter.uninstall(taskId, { unitDir, stateDir, runtime: true, purgeState: true }).catch(() => {});
  rmSync(workDir, { recursive: true, force: true });
  assert.deepEqual(snapshotDirHashes(userSystemdDir), beforeHashes, '~/.config/systemd/user/ must remain unchanged');
}
