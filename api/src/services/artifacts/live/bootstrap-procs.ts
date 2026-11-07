/**
 * Pod agent section: repository processes and the output snapshot (A-LIVE §8.3).
 * Repository code (pre-bundle, Vite, clean build) runs only in the `offline` phase after sealed
 * dependency materialization, and permanently taints the pod for dependency acquisition.
 * Under W2 static deny, `phase` records the posture and reports established outbound TCP sockets
 * (excluding the :5173 control/live listener and the loopback Vite upstream); it cannot prove
 * NetworkPolicy denial, which stays a Q1 receipt.
 */
export const PROCESS_OPS_SOURCE = String.raw`
AGENT_SECTIONS.push(function processOps(ctx) {
  const { state, at, options } = ctx;
  const OUTPUT_DIR = '/workspace/ui/dist';
  const OUTPUT_LIMITS = { files: 255, fileBytes: 16777216, totalBytes: 67108864 };
  const HOST_CONFIG = '/tmp/artifact-vite.config.mjs';
  const SHA = /^[a-f0-9]{40,64}$/;
  const controlPort = options.controlPort || 5173;
  const upstreamPort = options.upstreamPort || 5174;
  const reset = () => { state.candidate = null; }; ctx.resets.push(reset); reset();
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
  ctx.define('prebundle', [], async () => {
    await repoPhase(true);
    state.tainted = true;
    if (await ctx.runToExit(ctx.recipes.PREBUNDLE, '/workspace') !== 0) agentFail('failed', 'prebundle_failed');
    return { prebundled: true };
  });
  /** Idempotent for one session/lease: projections reuse the running Vite so HMR applies the overlay. */
  ctx.define('dev', [], async (_args, fence) => {
    const session = [fence.generation, fence.sessionId, fence.leaseEpoch].join(':');
    if (state.live && state.child && state.liveSession === session) return { revision: state.revision, routeEpoch: fence.routeEpoch };
    await repoPhase(true);
    state.tainted = true;
    let child = null;
    try { child = ctx.spawnRecipe(ctx.recipes.LIVE, '/workspace'); } catch { agentFail('failed', 'dev_unavailable'); }
    child.once('error', () => undefined);
    child.once('exit', () => { if (state.child === child) { state.child = null; state.live = false; } });
    try { await options.waitPort(upstreamPort, ctx.recipes.LIVE.timeoutMs, child); }
    catch { await ctx.terminateAll(); agentFail('failed', 'dev_unavailable'); }
    if (state.child !== child) agentFail('failed', 'dev_unavailable');
    state.live = true; state.liveSession = session;
    return { revision: state.revision, routeEpoch: fence.routeEpoch };
  });
  async function snapshotOutput() {
    await agentNoLinks(at, '/workspace', 'ui/dist/index');
    const top = await agentFs.lstat(at(OUTPUT_DIR)).catch(() => null);
    if (!top || !top.isDirectory()) agentFail('failed', 'output_missing');
    const files = []; let total = 0;
    const walk = async (rel) => {
      for (const name of await agentFs.readdir(at(OUTPUT_DIR + (rel ? '/' + rel : '')))) {
        const path = rel ? rel + '/' + name : name;
        const info = await agentFs.lstat(at(OUTPUT_DIR + '/' + path));
        if (info.isDirectory()) { await walk(path); continue; }
        if (!info.isFile() || info.nlink > 1) agentFail('failed', 'special_file');
        if (files.length >= OUTPUT_LIMITS.files || info.size > OUTPUT_LIMITS.fileBytes) agentFail('limit', 'limit_exceeded');
        const data = await agentFs.readFile(at(OUTPUT_DIR + '/' + path));
        total += data.length;
        if (data.length > OUTPUT_LIMITS.fileBytes || total > OUTPUT_LIMITS.totalBytes) agentFail('limit', 'limit_exceeded');
        files.push([path, data.length, agentSha(data)]);
      }
    };
    await walk('');
    if (files.length === 0) agentFail('failed', 'output_missing');
    files.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    return { files, total, digest: agentSha(JSON.stringify(files)) };
  }
  ctx.define('build', ['attemptId', 'headSha', 'treeSha'], async ({ attemptId, headSha, treeSha }) => {
    if (typeof attemptId !== 'string' || !AGENT_ID.test(attemptId) || !SHA.test(String(headSha)) || !SHA.test(String(treeSha))) {
      agentFail('failed', 'invalid_args');
    }
    await repoPhase(false);
    await agentFs.rm(at(OUTPUT_DIR), { recursive: true, force: true });
    state.tainted = true; state.candidate = null;
    const code = await ctx.runToExit(ctx.recipes.BUILD, '/workspace');
    if (!(await ctx.terminateAll())) agentFail('failed', 'tree_survived');
    if (code !== 0) agentFail('failed', 'build_failed');
    const snapshot = await snapshotOutput();
    state.candidate = { attemptId, ...snapshot };
    return { candidateDigest: snapshot.digest, files: snapshot.files.length, totalBytes: snapshot.total };
  });
  ctx.define('verify', ['attemptId', 'limits'], async ({ attemptId, limits }) => {
    agentRecord(limits, Object.keys(OUTPUT_LIMITS));
    if (Object.keys(OUTPUT_LIMITS).some((k) => limits[k] !== OUTPUT_LIMITS[k])) agentFail('failed', 'invalid_limits');
    if (!state.candidate || state.candidate.attemptId !== attemptId) agentFail('failed', 'no_candidate');
    if (!(await ctx.terminateAll())) agentFail('failed', 'tree_survived');
    const snapshot = await snapshotOutput();
    if (snapshot.digest !== state.candidate.digest) agentFail('failed', 'unstable_output');
    return { verified: true, candidateDigest: snapshot.digest, files: snapshot.files.length, totalBytes: snapshot.total };
  });
  ctx.define('output', ['path'], async ({ path }) => {
    const entry = state.candidate && state.candidate.files.find((file) => file[0] === path);
    if (!entry) agentFail('failed', 'invalid_path');
    const data = await agentFs.readFile(at(OUTPUT_DIR + '/' + entry[0]));
    if (agentSha(data) !== entry[2]) agentFail('failed', 'unstable_output');
    return { path: entry[0], sha256: entry[2], contentBase64: data.toString('base64') };
  });
});
`;
