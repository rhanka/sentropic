/**
 * Pod bootstrap agent (W4), embedded in the `node -e` bootstrap program of every worker pod.
 * It executes a closed set of supervisor operations: repository code never selects an executable,
 * argument, environment variable or path outside the three emptyDir roots. Plain JavaScript in a
 * string, so the pod needs only Node built-ins from the approved image digest (no shell, no exec).
 * Error codes are the closed W3 reply set: `fenced`, `limit`, `failed`; `reason` is a closed token.
 */
import { DEPENDENCY_OPS_SOURCE } from './bootstrap-deps';
import { FILE_OPS_SOURCE } from './bootstrap-files';
import { MATERIALIZE_OPS_SOURCE } from './bootstrap-materialize';
import { PROCESS_OPS_SOURCE } from './bootstrap-procs';

const CORE_SOURCE = String.raw`
import * as agentFs from 'node:fs/promises';
import { createHash as agentHash } from 'node:crypto';
import { posix as agentPath } from 'node:path';

const AGENT_ROOTS = ['/workspace', '/dependencies', '/tmp'];
const AGENT_HOST_FILES = ['/tmp/artifact-vite.config.mjs', '/tmp/host-npmrc', '/tmp/host-global-npmrc'];
const AGENT_LIMITS = { fileBytes: 16777216, stageFiles: 20000, stageBytes: 268435456, overlayPaths: 255,
  overlayBytes: 8388608, hostFileBytes: 65536 };
const AGENT_ID = /^[A-Za-z0-9._:-]{1,128}$/;
const AGENT_SECTIONS = [];
let agentTemp = 0;

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
function agentRelative(path) {
  if (typeof path !== 'string' || !path || Buffer.byteLength(path) > 1024 || path.includes('\0') || path.includes('\\')
    || path.startsWith('/') || path.split('/').some((s) => s === '' || s === '.' || s === '..' || s === '.git')) {
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
/** Same manifest digest as the trusted dependency cache: sorted [path, mode, sha256] entries. */
const agentDigest = (entries) => agentSha(JSON.stringify([...entries].map(([p, [m, h]]) => [p, m, h])
  .sort((a, b) => String(a[0]).localeCompare(String(b[0])))));
async function agentNoLinks(at, base, path) {
  const parts = path.split('/'); parts.pop();
  let current = base;
  for (const part of parts) {
    current += '/' + part;
    const info = await agentFs.lstat(at(current)).catch((error) => { if (error.code === 'ENOENT') return null; throw error; });
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
function agentFence(state, fence) {
  agentRecord(fence, ['generation', 'sessionId', 'leaseEpoch', 'routeEpoch']);
  const order = [fence.generation, fence.leaseEpoch, fence.routeEpoch];
  if (!order.every((n) => Number.isSafeInteger(n) && n >= 0) || typeof fence.sessionId !== 'string' || !AGENT_ID.test(fence.sessionId)) {
    agentFail('fenced', 'invalid_fence');
  }
  if (state.fence) {
    const seen = [state.fence.generation, state.fence.leaseEpoch, state.fence.routeEpoch];
    let cmp = 0;
    for (let i = 0; i < 3 && cmp === 0; i++) cmp = Math.sign(order[i] - seen[i]);
    if (cmp < 0 || (cmp === 0 && fence.sessionId !== state.fence.sessionId)) agentFail('fenced', 'stale_fence');
  }
  state.fence = { ...fence };
}

export function createAgent(options) {
  const root = options.root || '/';
  const ctx = { options, recipes: options.recipes, env: options.env, ops: {}, resets: [],
    at: (path) => agentPath.join(root, path),
    state: { fence: null, phase: 'stopped', tainted: false, live: false, child: null, revision: null },
    define(name, args, run, immediate = false) { ctx.ops[name] = { args, run, immediate }; } };
  ctx.terminateAll = async () => {
    ctx.state.live = false; ctx.state.child = null;
    for (let round = 0; round < 200; round++) {
      const pids = await options.processes.list();
      if (pids.length === 0) return true;
      for (const pid of pids) options.processes.kill(pid);
      await new Promise((resolve) => setTimeout(resolve, options.settleMs ?? 50));
    }
    return false;
  };
  /** Frozen recipes only: own process group, no shell, explicit environment, no inherited stdio. */
  ctx.spawnRecipe = (recipe, cwd) => {
    const child = options.spawn(recipe.executable, [...recipe.args],
      { cwd: ctx.at(cwd), env: { ...ctx.env }, shell: false, detached: true, stdio: 'ignore' });
    ctx.state.child = child;
    return child;
  };
  ctx.runToExit = (recipe, cwd) => new Promise((resolve) => {
    let child;
    try { child = ctx.spawnRecipe(recipe, cwd); } catch { resolve(-1); return; }
    const timer = setTimeout(() => { ctx.terminateAll(); }, recipe.timeoutMs);
    if (timer.unref) timer.unref();
    child.once('error', () => { clearTimeout(timer); resolve(-1); });
    child.once('exit', (code) => {
      clearTimeout(timer);
      if (ctx.state.child === child) ctx.state.child = null;
      resolve(code === 0 ? 0 : -1);
    });
  });
  for (const section of AGENT_SECTIONS) section(ctx);
  let queue = Promise.resolve();
  const serial = (work) => { const next = queue.then(work, work); queue = next.then(() => undefined, () => undefined); return next; };
  return {
    isLive: () => ctx.state.live,
    async handle(request) {
      agentRecord(request, ['id', 'seq', 'fence', 'op', 'args']);
      if (typeof request.op !== 'string' || !Object.hasOwn(ctx.ops, request.op)) agentFail('failed', 'unknown_operation');
      const entry = ctx.ops[request.op];
      const args = agentRecord(request.args, entry.args);
      agentFence(ctx.state, request.fence);
      const fence = { ...request.fence };
      try { return await (entry.immediate ? entry.run(args, fence) : serial(() => entry.run(args, fence))); }
      catch (error) {
        if (error instanceof AgentError) throw error;
        throw new AgentError('failed', error && error.code === 'EEXIST' ? 'duplicate_path' : 'io_error');
      }
    },
  };
}

`;

export const AGENT_SOURCE = CORE_SOURCE + FILE_OPS_SOURCE + DEPENDENCY_OPS_SOURCE + MATERIALIZE_OPS_SOURCE
  + PROCESS_OPS_SOURCE;
