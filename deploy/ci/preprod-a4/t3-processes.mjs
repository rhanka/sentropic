import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function processes() {
  return readdirSync('/proc').filter(n => /^\d+$/.test(n)).flatMap(n => {
    try {
      const fields = readFileSync(`/proc/${n}/stat`, 'utf8').split(') ')[1].split(' ');
      return fields[0] === 'Z' ? [] : [{ pid: Number(n), parent: Number(fields[1]), group: Number(fields[2]) }];
    } catch { return []; }
  });
}
function signal(pid, sig) {
  try { process.kill(pid, sig); } catch (e) { if (e.code !== 'ESRCH') throw e; }
}
function stop(groups, pids) {
  const members = () => processes().filter(p => groups.includes(p.group) || pids.includes(p.pid));
  if (!members().length) return;
  // Keep the same identities across TERM/reparenting/KILL. Never re-inventory
  // descendants of the dead parent to decide which groups need SIGKILL.
  for (const sig of ['SIGTERM', 'SIGKILL']) {
    for (const group of groups) signal(-group, sig);
    for (const pid of pids) signal(pid, sig);
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
  }
  const deadline = performance.now() + 2000;
  while (members().length && performance.now() < deadline) {
    for (const group of groups) signal(-group, 'SIGKILL');
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
  }
  if (members().length) throw new Error('command_processes_survived');
}

const LAUNCHER = 'umask 077; printf "%s" "$$" > "$1"; kill -0 "$2" 2>/dev/null || exit 125; case "$(cat /proc/"$2"/stat 2>/dev/null)" in ""|*") Z "*) exit 125;; esac; shift 2; exec "$@"';

function cleanupRecord(record) {
  try {
    const group = Number(readFileSync(record, 'utf8'));
    if (group > 1) stop([group], []);
  } catch (e) { if (e.code !== 'ENOENT') throw e; }
  try { unlinkSync(record); } catch (e) { if (e.code !== 'ENOENT') throw e; }
}

// Each synchronous command owns a session separate from driver AND watchdog.
// The launcher publishes its PGID before exec, then refuses to start if its
// owner died during launch. The record survives driver SIGKILL and reparenting.
export function supervisedSync(command, args, options, stateDir) {
  const dir = stateDir ?? mkdtempSync(join(tmpdir(), 't3-command-'));
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const record = join(dir, `.t3-command-${randomUUID()}.pgid`);
  const result = spawnSync('sh', ['-c', LAUNCHER, 't3-command', record, String(process.pid), command, ...args],
    { ...options, detached: true, killSignal: 'SIGKILL' });
  cleanupRecord(record);
  return result;
}

export function supervisedAsync(command, args, options = {}, stateDir) {
  if (options.signal?.aborted) {
    return Promise.resolve({ pid: null, status: null, signal: 'SIGKILL', stdout: '', stderr: '', error: new Error('command_aborted') });
  }
  const dir = stateDir ?? mkdtempSync(join(tmpdir(), 't3-command-'));
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const record = join(dir, `.t3-command-${randomUUID()}.pgid`);
  const maxBuffer = options.maxBuffer ?? 32 * 1024 * 1024;
  return new Promise(resolve => {
    const child = spawn('sh', ['-c', LAUNCHER, 't3-command', record, String(process.pid), command, ...args],
      { env: options.env, detached: true, stdio: ['pipe', 'pipe', 'pipe'] });
    const outChunks = [], errChunks = [];
    let outLen = 0, errLen = 0, error = null, settled = false;
    const killGroup = sig => {
      let group = 0;
      try { group = Number(readFileSync(record, 'utf8')); } catch { /* not written yet */ }
      if (group > 1) signal(-group, sig);
      if (child.pid > 1) signal(-child.pid, sig);
    };
    const terminate = err => {
      if (error) return;
      error = err; killGroup('SIGTERM');
      setTimeout(() => killGroup('SIGKILL'), 50).unref();
    };
    const onAbort = () => terminate(new Error('command_aborted'));
    const timer = options.timeout > 0 ? setTimeout(() => terminate(new Error('ETIMEDOUT')), options.timeout) : null;
    options.signal?.addEventListener('abort', onAbort, { once: true });
    child.stdin.on('error', () => {});
    child.stdin.end(options.input);
    child.stdout.on('data', c => { if ((outLen += c.length) <= maxBuffer) outChunks.push(c); else terminate(new Error('maxBuffer exceeded')); });
    child.stderr.on('data', c => { if ((errLen += c.length) <= maxBuffer) errChunks.push(c); else terminate(new Error('maxBuffer exceeded')); });
    const finish = (status, exitSignal, spawnErr) => {
      if (settled) return;
      settled = true; clearTimeout(timer); options.signal?.removeEventListener('abort', onAbort);
      try { cleanupRecord(record); } catch (e) { error ??= e; }
      resolve({ pid: child.pid ?? null, status, signal: exitSignal, error: error ?? spawnErr ?? null,
        stdout: Buffer.concat(outChunks).toString('utf8'), stderr: Buffer.concat(errChunks).toString('utf8') });
    };
    child.once('error', err => finish(null, null, err));
    child.once('close', (status, exitSignal) => finish(status, exitSignal, null));
  });
}

export function stopAutomation(stateDir, state, includeWatchdog = false) {
  // Freeze the owner before inventory so it cannot launch a command between
  // our snapshot and termination. In-flight launchers already own a group.
  if (state.driverPid > 1 && state.driverPid !== process.pid) signal(state.driverPid, 'SIGSTOP');
  const records = readdirSync(stateDir).filter(n => /^\.t3-command-.*\.pgid$/.test(n));
  const groups = records
    .map(n => Number(readFileSync(join(stateDir, n), 'utf8'))).filter(n => n > 1);
  const excluded = [process.pid, ...(!includeWatchdog ? [state.watchdogPid] : [])];
  const pids = [state.driverPid, state.childPid, ...(includeWatchdog ? [state.watchdogPid] : [])]
    .filter(n => n > 1 && !excluded.includes(n));
  // Also snapshot old/idle driver descendants once, excluding the supervisor.
  const inventory = processes();
  for (let i = 0; i < pids.length; i++) {
    for (const p of inventory) {
      if (p.parent === pids[i] && !pids.includes(p.pid) && !excluded.includes(p.pid)) pids.push(p.pid);
    }
  }
  const driverGroup = inventory.find(p => p.pid === state.driverPid)?.group;
  for (const p of inventory) {
    if (pids.includes(p.pid) && p.group !== driverGroup && !groups.includes(p.group)
      && !excluded.some(pid => inventory.find(e => e.pid === pid)?.group === p.group)) groups.push(p.group);
  }
  stop(groups, pids);
  for (const record of records) {
    try { unlinkSync(join(stateDir, record)); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const dir = process.argv[2];
  let state = {};
  try { state = JSON.parse(readFileSync(join(dir, 't3-window-state.json'), 'utf8')); }
  catch (e) { if (e.code !== 'ENOENT') throw e; }
  stopAutomation(dir, state, true);
}
