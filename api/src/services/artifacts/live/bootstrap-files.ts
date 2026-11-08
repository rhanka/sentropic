/** Pod agent section: terminate, clear, source staging, host files and the atomic draft overlay (W3 ops). */
export const FILE_OPS_SOURCE = String.raw`
AGENT_SECTIONS.push(function fileOps(ctx) {
  const { state, at } = ctx;
  ctx.resets.push(['/workspace', () => { state.staged = null; state.revision = null; }]);
  state.staged = null;
  ctx.define('terminate', [], async () => {
    if (!(await ctx.terminateAll())) agentFail('failed', 'tree_survived');
    return { treeGone: true };
  }, true);
  ctx.define('clear', ['paths'], async ({ paths }) => {
    if (!Array.isArray(paths) || paths.length === 0 || new Set(paths).size !== paths.length
      || paths.some((p) => !AGENT_ROOTS.includes(p))) agentFail('failed', 'invalid_path');
    if (!(await ctx.terminateAll())) agentFail('failed', 'tree_survived');
    for (const dir of paths) {
      for (const name of await agentFs.readdir(at(dir))) {
        await agentUnlock(at(dir + '/' + name));
        await agentFs.rm(at(dir + '/' + name), { recursive: true, force: true });
      }
    }
    ctx.reset(paths);
    return { cleared: [...paths] };
  });
  ctx.define('stage', ['transfer', 'treeDigest', 'headSha', 'treeSha'], async ({ transfer, treeDigest, headSha, treeSha }) => {
    if (!AGENT_SHA.test(String(headSha)) || !AGENT_SHA.test(String(treeSha))) agentFail('failed', 'invalid_args');
    const set = await ctx.commitTransfer(transfer, treeDigest, 'workspace');
    try {
      if (state.staged) agentFail('failed', 'already_staged');
      if (set.files.length === 0) agentFail('failed', 'invalid_args');
      for (const file of set.files) agentSourcePath(file.path);
      for (const file of set.files) await ctx.place(file, '/workspace');
    } finally { await set.dispose(); }
    state.staged = { headSha, treeSha };
    return { treeDigest };
  });
  ctx.define('hostFile', ['path', 'source'], async ({ path, source }) => {
    if (!AGENT_HOST_FILES.includes(path)) agentFail('failed', 'invalid_path');
    if (typeof source !== 'string' || Buffer.byteLength(source) > 65536) agentFail('limit', 'limit_exceeded');
    const data = Buffer.from(source, 'utf8');
    // Rewriting an identical live config would make Vite restart its server and drop HMR clients.
    const info = await agentFs.lstat(at(path)).catch(() => null);
    if (!(info && info.isFile() && (await agentFs.readFile(at(path))).equals(data))) await agentAtomicWrite(at(path), data, 0o644);
    return { sha256: agentSha(data) };
  });
  /** Every create/replace/delete of this revision is validated before the first rename, then applied. */
  ctx.define('overlay', ['transfer', 'treeDigest', 'deletes', 'revision', 'generation', 'baseHeadSha', 'treeSha'], async (args, fence) => {
    const { transfer, treeDigest, deletes, revision } = args;
    if (!(typeof revision === 'string' && AGENT_ID.test(revision)) && !Number.isSafeInteger(revision)) agentFail('failed', 'invalid_revision');
    if (args.generation !== fence.generation) agentFail('fenced', 'stale_fence');
    if (!AGENT_SHA.test(String(args.baseHeadSha)) || !AGENT_SHA.test(String(args.treeSha)) || !Array.isArray(deletes)) {
      agentFail('failed', 'invalid_args');
    }
    const set = await ctx.commitTransfer(transfer, treeDigest, 'overlay');
    try {
      if (!state.staged) agentFail('failed', 'phase_refused');
      if (set.files.length + deletes.length > 255) agentFail('limit', 'limit_exceeded');
      const seen = new Set();
      for (const path of [...set.files.map((f) => f.path), ...deletes]) {
        agentSourcePath(path);
        if (seen.has(path)) agentFail('failed', 'duplicate_path');
        seen.add(path);
        await ctx.checkTarget('/workspace', path, true);
      }
      for (const file of set.files) await ctx.move(file, '/workspace');
      for (const path of deletes) await agentFs.rm(at('/workspace/' + path), { force: true });
    } finally { await set.dispose(); }
    state.revision = revision;
    return { revision, treeDigest };
  });
});
`;
