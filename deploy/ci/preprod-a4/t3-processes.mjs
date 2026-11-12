import { spawnSync } from 'node:child_process';
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

// Each synchronous command owns a session separate from driver AND watchdog.
// The launcher publishes its PGID before exec, then refuses to start if its
// owner died during launch. The record survives driver SIGKILL and reparenting.
export function supervisedSync(command, args, options, stateDir) {
  const dir = stateDir ?? mkdtempSync(join(tmpdir(), 't3-command-'));
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const record = join(dir, `.t3-command-${randomUUID()}.pgid`);
  const result = spawnSync('sh', ['-c',
    'umask 077; printf "%s" "$$" > "$1"; kill -0 "$2" 2>/dev/null || exit 125; shift 2; exec "$@"',
    't3-command', record, String(process.pid), command, ...args],
  { ...options, detached: true, killSignal: 'SIGKILL' });
  try {
    const group = Number(readFileSync(record, 'utf8'));
    if (group > 1) stop([group], []);
  } catch (e) { if (e.code !== 'ENOENT') throw e; }
  try { unlinkSync(record); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  return result;
}

export function stopAutomation(stateDir, state, includeWatchdog = false) {
  const groups = readdirSync(stateDir).filter(n => /^\.t3-command-.*\.pgid$/.test(n))
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
  stop(groups, pids);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const dir = process.argv[2];
  let state = {};
  try { state = JSON.parse(readFileSync(join(dir, 't3-window-state.json'), 'utf8')); }
  catch (e) { if (e.code !== 'ENOENT') throw e; }
  stopAutomation(dir, state, true);
}
