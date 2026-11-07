/** Pod agent section: source staging, host files, admitted overlays, clear and terminate. */
export const FILE_OPS_SOURCE = String.raw`
AGENT_SECTIONS.push(function fileOps(ctx) {
  const { state, at } = ctx;
  ctx.resets.push(() => { state.staged = new Map(); state.stagedBytes = 0; state.revision = null; });
  ctx.resets[0]();
  ctx.define('terminate', [], async () => {
    if (!(await ctx.terminateAll())) agentFail('failed', 'tree_survived');
    return { treeGone: true };
  }, true);
  ctx.define('clear', ['paths'], async ({ paths }) => {
    if (!Array.isArray(paths) || paths.length !== AGENT_ROOTS.length || AGENT_ROOTS.some((r) => !paths.includes(r))) {
      agentFail('failed', 'invalid_path');
    }
    if (!(await ctx.terminateAll())) agentFail('failed', 'tree_survived');
    for (const dir of AGENT_ROOTS) {
      for (const name of await agentFs.readdir(at(dir))) {
        await agentUnlock(at(dir + '/' + name));
        await agentFs.rm(at(dir + '/' + name), { recursive: true, force: true });
      }
    }
    for (const reset of ctx.resets) reset();
    return {};
  });
  ctx.define('stage', ['files'], async ({ files }) => {
    if (!Array.isArray(files) || files.length === 0) agentFail('failed', 'invalid_args');
    const batch = new Map(); let bytes = state.stagedBytes;
    for (const file of files) {
      agentRecord(file, ['path', 'mode', 'contentBase64']);
      const path = agentSourcePath(file.path);
      if (file.mode !== 0o644 && file.mode !== 0o755) agentFail('failed', 'invalid_mode');
      if (state.staged.has(path) || batch.has(path)) agentFail('failed', 'duplicate_path');
      const data = agentBytes(file.contentBase64, AGENT_LIMITS.fileBytes);
      bytes += data.length;
      if (bytes > AGENT_LIMITS.stageBytes || state.staged.size + batch.size >= AGENT_LIMITS.stageFiles) agentFail('limit', 'limit_exceeded');
      batch.set(path, { mode: file.mode, data });
    }
    for (const [path, file] of batch) {
      await agentNoLinks(at, '/workspace', path);
      const target = at('/workspace/' + path);
      await agentFs.mkdir(agentPath.dirname(target), { recursive: true });
      await agentFs.writeFile(target, file.data, { flag: 'wx', mode: file.mode });
      await agentFs.chmod(target, file.mode);
      state.staged.set(path, [file.mode, agentSha(file.data)]);
    }
    state.stagedBytes = bytes;
    return { files: state.staged.size, stagedDigest: agentDigest(state.staged) };
  });
  ctx.define('hostFile', ['path', 'source'], async ({ path, source }) => {
    if (!AGENT_HOST_FILES.includes(path)) agentFail('failed', 'invalid_path');
    if (typeof source !== 'string' || Buffer.byteLength(source) > AGENT_LIMITS.hostFileBytes) agentFail('limit', 'limit_exceeded');
    await agentAtomicWrite(at(path), Buffer.from(source, 'utf8'), 0o644);
    return {};
  });
  /** Applies admitted text: the supervisor sends the writes/deletes that make the tree equal base + overlay. */
  ctx.define('overlay', ['revision', 'files', 'deletes'], async ({ revision, files, deletes }) => {
    if (!(typeof revision === 'string' && AGENT_ID.test(revision)) && !Number.isSafeInteger(revision)) agentFail('failed', 'invalid_revision');
    if (!Array.isArray(files) || !Array.isArray(deletes) || files.length + deletes.length > AGENT_LIMITS.overlayPaths) agentFail('limit', 'limit_exceeded');
    const seen = new Set(); const writes = []; let bytes = 0;
    const claim = (path) => { agentSourcePath(path); if (seen.has(path)) agentFail('failed', 'duplicate_path'); seen.add(path); };
    for (const file of files) {
      agentRecord(file, ['path', 'contentBase64']); claim(file.path);
      const data = agentBytes(file.contentBase64, AGENT_LIMITS.overlayBytes);
      if ((bytes += data.length) > AGENT_LIMITS.overlayBytes) agentFail('limit', 'limit_exceeded');
      writes.push([file.path, data]);
    }
    for (const path of deletes) claim(path);
    for (const path of seen) {
      await agentNoLinks(at, '/workspace', path);
      const info = await agentFs.lstat(at('/workspace/' + path)).catch((error) => { if (error.code === 'ENOENT') return null; throw error; });
      if (info && !info.isFile()) agentFail('failed', 'invalid_path');
    }
    for (const [path, data] of writes) {
      const target = at('/workspace/' + path);
      const info = await agentFs.lstat(target).catch(() => null);
      await agentAtomicWrite(target, data, info ? info.mode & 0o777 : 0o644);
    }
    for (const path of deletes) await agentFs.rm(at('/workspace/' + path), { force: true });
    state.revision = revision;
    return { revision };
  });
});
`;
