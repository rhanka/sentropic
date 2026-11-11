/**
 * Pod bootstrap agent (W4), embedded in the `node -e` bootstrap program of every worker pod.
 * It executes the closed W3 operation set over signed frames only: repository code never selects an
 * executable, argument, environment variable or path outside the three emptyDir roots. Plain JavaScript in
 * a string, so the pod needs only Node built-ins from the approved image digest (no shell, no exec).
 * Refusal codes are the closed W3 reply set (`fenced`, `limit`, `integrity`, `failed`); `reason` is a closed token.
 */
import { DEPENDENCY_OPS_SOURCE } from './bootstrap-deps';
import { FILE_OPS_SOURCE } from './bootstrap-files';
import { FRAME_SOURCE } from './bootstrap-frame';
import { MATERIALIZE_OPS_SOURCE } from './bootstrap-materialize';
import { PROCESS_OPS_SOURCE } from './bootstrap-procs';
import { TRANSFER_SOURCE } from './bootstrap-transfer';

const CORE_SOURCE = String.raw`
import * as agentFs from 'node:fs/promises';
import { createHash as agentHash } from 'node:crypto';
import { posix as agentPath } from 'node:path';

const AGENT_ROOTS = ['/workspace', '/dependencies', '/tmp'];
const AGENT_HOST_FILES = ['/tmp/artifact-vite.config.mjs', '/tmp/host-npmrc', '/tmp/host-global-npmrc'];
const AGENT_ID = /^[A-Za-z0-9._:-]{1,128}$/;
const AGENT_SHA = /^[a-f0-9]{40,64}$/;
/** Top-level staging directory of put transfers in each root; never a valid tree path. */
const AGENT_RESERVED = '.artifact-transfer';
const AGENT_SECTIONS = [];
let agentTemp = 0;
/** Bytes of recipe output kept: the tail of stdout+stderr in arrival order, mirroring RECIPE_TAIL_BYTES on the API. */
const AGENT_TAIL_BYTES = 4096;
const agentScrub = (text) => String(text)
  .replace(/(\/\/)[^/\s@]+@/g, '$1[redacted]')
  .replace(/(_authToken|_auth)\s*=\s*[^\s]+/gi, '$1=[redacted]')
  .replace(/(Authorization\s*:\s*)[^\r\n]+/gi, '$1[redacted]')
  .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+\/=-]{8,}/gi, '$1 [redacted]')
  .replace(/\b(npm_[A-Za-z0-9]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9_-]{20,}|AKIA[0-9A-Z]{16})\b/g, '[redacted]')
  .replace(/\b([A-Za-z0-9_]*(?:token|secret|password|passwd|api[_-]?key)[A-Za-z0-9_]*)(\s*[:=]\s*)[^\s'",;]+/gi, '$1$2[redacted]');

export class AgentError extends Error {
  constructor(code, reason) { super(reason || code); this.code = code; this.reason = reason || code; }
}
const agentFail = (code, reason) => { throw new AgentError(code, reason); };
function agentRecord(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some((k) => !keys.includes(k))) {
    agentFail('failed', 'unknown_field');
  }
  return value;
}
function agentArgs(value, keys) {
  agentRecord(value, keys);
  if (keys.some((k) => !Object.hasOwn(value, k))) agentFail('failed', 'missing_field');
  return value;
}
function agentRelative(path) {
  if (typeof path !== 'string' || !path || Buffer.byteLength(path) > 1024 || path.includes('\0') || path.includes('\\')
    || path.startsWith('/') || path.split('/')[0] === AGENT_RESERVED
    || path.split('/').some((s) => s === '' || s === '.' || s === '..' || s === '.git')) {
    agentFail('failed', 'invalid_path');
  }
  return path;
}
function agentSourcePath(path) {
  if (agentRelative(path).split('/').some((s) => s === 'node_modules' || s === '.npmrc' || s.startsWith('.yarnrc'))) {
    agentFail('failed', 'invalid_path');
  }
  return path;
}
function agentBytes(value, max) {
  const data = typeof value === 'string' ? Buffer.from(value, 'base64') : null;
  if (!data || data.toString('base64') !== value) agentFail('failed', 'invalid_encoding');
  if (data.length > max) agentFail('limit', 'limit_exceeded');
  return data;
}
const agentSha = (data) => agentHash('sha256').update(data).digest('hex');
const agentMissing = (error) => { if (error && error.code === 'ENOENT') return null; throw error; };
async function agentNoLinks(at, base, path) {
  const parts = path.split('/'); parts.pop();
  let current = base;
  for (const part of parts) {
    current += '/' + part;
    const info = await agentFs.lstat(at(current)).catch(agentMissing);
    if (!info) return;
    if (!info.isDirectory()) agentFail('failed', 'invalid_path');
  }
}
async function agentAtomicWrite(target, data, mode) {
  await agentFs.mkdir(agentPath.dirname(target), { recursive: true });
  const temp = agentPath.dirname(target) + '/.artifact-' + process.pid + '-' + (++agentTemp);
  await agentFs.writeFile(temp, data, { flag: 'wx', mode });
  await agentFs.chmod(temp, mode);
  await agentFs.rename(temp, target);
}
async function agentUnlock(path) {
  const info = await agentFs.lstat(path);
  if (!info.isDirectory()) return;
  await agentFs.chmod(path, 0o755);
  for (const name of await agentFs.readdir(path)) await agentUnlock(path + '/' + name);
}

export function createAgent(options) {
  const root = options.root || '/';
  if (!options.env || !options.buildEnv || !options.installEnv) throw new AgentError('failed', 'environment_missing');
  const ctx = { options, recipes: options.recipes, env: options.env, ops: {}, resets: [], guards: [],
    at: (path) => agentPath.join(root, path),
    state: { fence: null, phase: 'stopped', live: false, child: null, revision: null, groups: new Set() },
    define(name, args, run, immediate = false) { ctx.ops[name] = { args, run, immediate }; },
    reset(roots) { for (const [dir, fn] of ctx.resets) if (roots.includes(dir)) fn(); } };
  ctx.endLive = () => {
    const was = ctx.state.live; ctx.state.live = false;
    if (was && options.liveEnded) options.liveEnded();
  };
  /** Whole tree: every recipe process group, then every other process of the pod, until none is left. */
  ctx.terminateAll = async () => {
    ctx.endLive(); ctx.state.child = null;
    for (let round = 0; round < 200; round++) {
      for (const group of ctx.state.groups) options.processes.killGroup(group);
      const pids = await options.processes.list();
      if (pids.length === 0) { ctx.state.groups.clear(); return true; }
      for (const pid of pids) options.processes.kill(pid);
      await new Promise((resolve) => setTimeout(resolve, options.settleMs ?? 50));
    }
    return false;
  };
  /** Frozen recipes only: own process group, no shell, the host environment built from zero. Recipe stdio is
   * piped and drained into a bounded tail (arrival order across stdout+stderr), so a verbose recipe can neither
   * block on a full pipe nor grow pod memory; the tail is scrubbed before it ever leaves the pod. */
  ctx.spawnRecipe = (recipe, cwd, env = ctx.env) => {
    const child = options.spawn(recipe.executable, [...recipe.args],
      { cwd: ctx.at(cwd), env: { ...env }, shell: false, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    if (Number.isSafeInteger(child.pid)) ctx.state.groups.add(child.pid);
    ctx.state.child = child;
    const chunks = []; let size = 0; let cut = false;
    const take = (data) => {
      const buf = Buffer.isBuffer(data) ? data : Buffer.from(String(data));
      chunks.push(buf); size += buf.length;
      while (size > AGENT_TAIL_BYTES) {
        const head = chunks[0]; const drop = size - AGENT_TAIL_BYTES;
        cut = true;
        if (drop >= head.length) { chunks.shift(); size -= head.length; }
        else { chunks[0] = head.subarray(drop); size = AGENT_TAIL_BYTES; }
      }
    };
    child.recipeTail = () => Buffer.concat(chunks);
    // A tail whose head was dropped starts mid-line: that partial line is discarded, so a secret whose label was cut
    // off can never survive the scrub.
    child.recipeCut = () => cut;
    for (const stream of [child.stdout, child.stderr]) {
      if (stream && typeof stream.on === 'function') {
        stream.on('data', take); stream.on('error', () => undefined);
      }
    }
    return child;
  };
  /** Runs a recipe to exit, returning its bounded scrubbed output tail with the exit code and signal. After the exit
   * event the tail waits for both pipes to end (bounded grace), since the last stderr chunk often names the cause.
   * A recipe cut by its own timer reports the signal TIMEOUT, so a timeout is never classified as a memory kill. */
  ctx.runToExit = (recipe, cwd, env) => new Promise((resolve) => {
    let settled = false;
    const done = (exitCode, signal, output) => { if (!settled) { settled = true; resolve({ exitCode, signal, output }); } };
    let child;
    try { child = ctx.spawnRecipe(recipe, cwd, env); } catch { done(null, null, ''); return; }
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; ctx.terminateAll(); }, recipe.timeoutMs);
    if (timer.unref) timer.unref();
    const tail = () => {
      try {
        let raw = child.recipeTail ? child.recipeTail().toString('utf8') : '';
        if (child.recipeCut && child.recipeCut()) { const nl = raw.indexOf('\n'); raw = nl >= 0 ? raw.slice(nl + 1) : ''; }
        return Buffer.from(agentScrub(raw), 'utf8').subarray(-AGENT_TAIL_BYTES).toString('base64');
      } catch { return ''; }
    };
    child.once('error', () => { clearTimeout(timer); done(null, null, tail()); });
    child.once('exit', (code, signal) => {
      clearTimeout(timer);
      if (ctx.state.child === child) ctx.state.child = null;
      const finish = () => done(Number.isSafeInteger(code) ? code : null,
        timedOut ? 'TIMEOUT' : (typeof signal === 'string' ? signal : null), tail());
      const open = [child.stdout, child.stderr].filter((s) => s && typeof s.once === 'function'
        && !s.readableEnded && !s.destroyed);
      if (open.length === 0) { finish(); return; }
      let left = open.length;
      const grace = setTimeout(finish, 1000);
      if (grace.unref) grace.unref();
      for (const stream of open) {
        let seen = false;
        const ended = () => { if (seen) return; seen = true; left -= 1; if (left === 0) { clearTimeout(grace); finish(); } };
        stream.once('end', ended); stream.once('close', ended);
      }
    });
  });
  for (const section of AGENT_SECTIONS) section(ctx);
  let queue = Promise.resolve();
  const serial = (work) => { const next = queue.then(work, work); queue = next.then(() => undefined, () => undefined); return next; };
  async function dispatch(body) {
    const entry = ctx.ops[body.op];
    if (!entry) agentFail('failed', 'unknown_operation');
    for (const guard of ctx.guards) guard(body);
    const args = agentArgs(body.args, entry.args);
    const fence = { ...body.fence };
    try { return await (entry.immediate ? entry.run(args, fence) : serial(() => entry.run(args, fence))); }
    catch (error) {
      if (error instanceof AgentError) throw error;
      throw new AgentError('failed', error && error.code === 'EEXIST' ? 'duplicate_path' : 'io_error');
    }
  }
  const receiver = frameReceiver(ctx, dispatch);
  return { receive: receiver.receive, checkLease: receiver.checkLease, isLive: () => ctx.state.live,
    terminate: () => ctx.terminateAll() };
}

`;

export const AGENT_SOURCE = CORE_SOURCE + FRAME_SOURCE + TRANSFER_SOURCE + FILE_OPS_SOURCE + DEPENDENCY_OPS_SOURCE
  + MATERIALIZE_OPS_SOURCE + PROCESS_OPS_SOURCE;
