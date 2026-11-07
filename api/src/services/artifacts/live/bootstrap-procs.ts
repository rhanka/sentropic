/**
 * Pod agent section: repository processes and snapshots (A-LIVE §8.3, W3 ops `phase`, `dev`, `build`, `snapshot`).
 * Repository code (pre-bundle, Vite, clean build) runs only in the `offline` phase after sealed dependency
 * materialization, from frozen recipes chosen by name. `dev` first runs the host pre-bundle driver to
 * completion, so its output stays in this pod's /tmp/vite-cache. Under W2 static deny, `phase` records the
 * posture and reports established outbound TCP sockets (excluding the :5173 listener and the loopback Vite
 * upstream); it cannot prove NetworkPolicy denial, which stays a Q1 receipt.
 * `snapshot` pages regular files as contiguous base64 slices: `output` (ui/dist, 255 files / 16 MiB / 64 MiB,
 * links refused) and `dependencies` (the /tmp/install node_modules files, links skipped).
 */
export const PROCESS_OPS_SOURCE = String.raw`
AGENT_SECTIONS.push(function processOps(ctx) {
  const { state, at, options } = ctx;
  const OUTPUT_DIR = '/workspace/ui/dist';
  const ROOTS = {
    output: { dir: OUTPUT_DIR, files: 255, fileBytes: 16777216, totalBytes: 67108864, links: 'refuse', deps: false },
    dependencies: { dir: '/tmp/install', files: 65536, fileBytes: 16777216, totalBytes: 536870912, links: 'skip', deps: true },
  };
  const CHUNK = 786432; const PAGE_ENTRIES = 4096;
  const HOST_CONFIG = '/tmp/artifact-vite.config.mjs'; const PREBUNDLE_SCRIPT = '/tmp/artifact-vite-prebundle.mjs';
  const controlPort = options.controlPort || 5173;
  const upstreamPort = options.upstreamPort || 5174;
  state.snapshots = {}; state.prebundled = false;
  ctx.resets.push(['/workspace', () => { state.snapshots.output = null; }],
    ['/tmp', () => { state.snapshots.dependencies = null; state.prebundled = false; }]);
  const repoPhase = async (needsConfig) => {
    if (state.phase !== 'offline' || !state.sealed) agentFail('failed', 'phase_refused');
    if (needsConfig && !(await agentFs.lstat(at(HOST_CONFIG)).then((info) => info.isFile(), () => false))) {
      agentFail('failed', 'host_config_missing');
    }
    if (!(await ctx.terminateAll())) agentFail('failed', 'tree_survived');
  };
  async function established() {
    const lines = await options.sockets();
    if (!Array.isArray(lines)) agentFail('failed', 'netstat_unavailable');
    const port = (address) => parseInt(String(address).split(':').pop(), 16);
    let count = 0;
    for (const line of lines) {
      const cols = String(line).trim().split(/\s+/);
      if (cols.length < 4 || cols[3] !== '01') continue;
      const local = port(cols[1]); const remote = port(cols[2]);
      if (local !== controlPort && local !== upstreamPort && remote !== upstreamPort) count++;
    }
    return count;
  }
  ctx.define('phase', ['phase'], async ({ phase }) => {
    if (phase !== 'offline' && phase !== 'stopped') agentFail('failed', 'invalid_phase');
    state.phase = phase;
    return { phase, egress: 'static-deny', established: await established() };
  });
  /** Idempotent for one session/lease: projections reuse the running Vite so HMR applies the overlay. */
  ctx.define('dev', ['recipe'], async ({ recipe }, fence) => {
    if (recipe !== 'live') agentFail('failed', 'invalid_recipe');
    const session = [fence.generation, fence.sessionId, fence.leaseEpoch].join(':');
    if (state.live && state.child && state.liveSession === session) return { revision: state.revision, routeEpoch: fence.routeEpoch };
    await repoPhase(true);
    if (!state.prebundled) {
      await agentAtomicWrite(at(PREBUNDLE_SCRIPT), Buffer.from(ctx.recipes.prebundleScript, 'utf8'), 0o444);
      if (await ctx.runToExit(ctx.recipes.prebundle, '/workspace') !== 0) agentFail('failed', 'prebundle_failed');
      if (!(await ctx.terminateAll())) agentFail('failed', 'tree_survived');
      state.prebundled = true;
    }
    let child = null;
    try { child = ctx.spawnRecipe(ctx.recipes.live, '/workspace'); } catch { agentFail('failed', 'dev_unavailable'); }
    child.once('error', () => undefined);
    child.once('exit', () => { if (state.child === child) { state.child = null; ctx.endLive(); } });
    try { await options.waitPort(upstreamPort, ctx.recipes.live.timeoutMs, child); }
    catch { await ctx.terminateAll(); agentFail('failed', 'dev_unavailable'); }
    if (state.child !== child) agentFail('failed', 'dev_unavailable');
    state.live = true; state.liveSession = session;
    return { revision: state.revision, routeEpoch: fence.routeEpoch };
  });
  ctx.define('build', ['recipe', 'attemptId', 'headSha', 'treeSha'], async ({ recipe, attemptId, headSha, treeSha }) => {
    if (recipe !== 'build' || typeof attemptId !== 'string' || !AGENT_ID.test(attemptId) || !AGENT_SHA.test(String(headSha))
      || !AGENT_SHA.test(String(treeSha))) agentFail('failed', 'invalid_args');
    await repoPhase(false);
    await agentNoLinks(at, '/workspace', 'ui/dist/index');
    await agentFs.rm(at(OUTPUT_DIR), { recursive: true, force: true });
    state.snapshots.output = null;
    const exitCode = await ctx.runToExit(ctx.recipes.build, '/workspace');
    if (!(await ctx.terminateAll())) agentFail('failed', 'tree_survived');
    return { exitCode };
  });
  async function listing(spec) {
    const files = []; let total = 0;
    const walk = async (rel) => {
      for (const name of (await agentFs.readdir(at(spec.dir + (rel ? '/' + rel : '')))).sort()) {
        const path = rel ? rel + '/' + name : name;
        const info = await agentFs.lstat(at(spec.dir + '/' + path));
        if (info.isSymbolicLink() && spec.links === 'skip') continue;
        if (info.isDirectory()) { await walk(path); continue; }
        if (!info.isFile() || (!spec.deps && info.nlink > 1)) agentFail('failed', 'special_file');
        if (spec.deps && !path.split('/').includes('node_modules')) continue;
        total += info.size;
        if (files.length >= spec.files || info.size > spec.fileBytes || total > spec.totalBytes) agentFail('limit', 'limit_exceeded');
        files.push({ path, size: info.size, mode: info.mode & 0o111 ? 0o755 : 0o644 });
      }
    };
    const top = await agentFs.lstat(at(spec.dir)).catch(agentMissing);
    if (!top || !top.isDirectory()) agentFail('failed', 'output_missing');
    await walk('');
    if (!spec.deps && !files.some((f) => f.path === 'index.html')) agentFail('failed', 'output_missing');
    const slices = [];
    files.forEach((f, index) => { let offset = 0; do { slices.push([index, offset]); offset += CHUNK; } while (offset < f.size); });
    return { files, slices };
  }
  async function readSlice(path, size, offset, length) {
    const handle = await agentFs.open(at(path), 'r');
    try {
      if ((await handle.stat()).size !== size) agentFail('failed', 'unstable_tree');
      const data = Buffer.alloc(length); let read = 0;
      while (read < length) {
        const { bytesRead } = await handle.read(data, read, length - read, offset + read);
        if (bytesRead === 0) agentFail('failed', 'unstable_tree');
        read += bytesRead;
      }
      return data;
    } finally { await handle.close(); }
  }
  ctx.define('snapshot', ['root', 'cursor'], async ({ root, cursor }) => {
    if (!Object.hasOwn(ROOTS, root) || !Number.isSafeInteger(cursor) || cursor < 0) agentFail('failed', 'invalid_args');
    const spec = ROOTS[root];
    if (root === 'output') await agentNoLinks(at, '/workspace', 'ui/dist/index');
    if (cursor === 0) state.snapshots[root] = await listing(spec);
    const snap = state.snapshots[root];
    if (!snap || (cursor >= snap.slices.length && !(cursor === 0 && snap.slices.length === 0))) agentFail('failed', 'invalid_args');
    const entries = []; let bytes = 0; let index = cursor;
    for (; index < snap.slices.length && entries.length < PAGE_ENTRIES; index++) {
      const [fileIndex, offset] = snap.slices[index]; const f = snap.files[fileIndex];
      const length = Math.min(CHUNK, f.size - offset);
      if (entries.length > 0 && bytes + length > CHUNK) break;
      const data = await readSlice(spec.dir + '/' + f.path, f.size, offset, length);
      bytes += length;
      entries.push({ path: f.path, type: 'file', mode: f.mode, size: f.size, offset, data: data.toString('base64') });
    }
    return { entries, next: index < snap.slices.length ? index : null };
  });
});
`;
