/**
 * Pod agent section: W3 tree transfers. `put { transfer, target, entries }` appends contiguous base64 slices
 * to a staging area on the destination volume; the single commit op of that transfer recomputes the W3
 * `treeDigest` (sha256 of the JSON list [path, mode, size, sha256] sorted by path) and either hands the
 * complete set to the operation or discards all of it. Bounds are enforced while receiving.
 */
export const TRANSFER_SOURCE = String.raw`
AGENT_SECTIONS.push(function transferOps(ctx) {
  const { state, at } = ctx;
  const TREE = { files: 65536, fileBytes: 67108864, totalBytes: 1073741824 };
  const TARGETS = {
    workspace: { root: '/workspace', ...TREE }, install: { root: '/tmp', ...TREE }, dependencies: { root: '/dependencies', ...TREE },
    overlay: { root: '/workspace', files: 255, fileBytes: 1048576, totalBytes: 8388608 },
    'npm-cache': { root: '/tmp', ...TREE },
  };
  const MODES = [0o444, 0o555, 0o644, 0o755];
  const OPEN = 4; const PUT_ENTRIES = 256;
  state.transfers = new Map();
  for (const dir of AGENT_ROOTS) {
    ctx.resets.push([dir, () => { for (const [id, t] of state.transfers) if (t.root === dir) state.transfers.delete(id); }]);
  }
  const area = (t) => t.root + '/' + AGENT_RESERVED + '/' + t.id;
  const drop = async (t) => {
    state.transfers.delete(t.id);
    await agentFs.rm(at(area(t)), { recursive: true, force: true });
    await agentFs.rmdir(at(t.root + '/' + AGENT_RESERVED)).catch(() => undefined);
  };

  ctx.define('put', ['transfer', 'target', 'entries'], async ({ transfer, target, entries }) => {
    if (typeof transfer !== 'string' || !AGENT_ID.test(transfer) || !Object.hasOwn(TARGETS, target)
      || !Array.isArray(entries) || entries.length === 0 || entries.length > PUT_ENTRIES) agentFail('failed', 'invalid_args');
    const limits = TARGETS[target];
    let t = state.transfers.get(transfer);
    if (!t) {
      if (state.transfers.size >= OPEN) agentFail('limit', 'limit_exceeded');
      t = { id: transfer, target, root: limits.root, files: new Map(), bytes: 0, open: null, count: 0 };
      state.transfers.set(transfer, t);
      await agentFs.mkdir(at(area(t)), { recursive: true });
    }
    try {
      if (t.target !== target) agentFail('failed', 'invalid_args');
      for (const entry of entries) {
        agentRecord(entry, ['path', 'mode', 'size', 'offset', 'data']);
        const path = agentRelative(entry.path);
        if (!MODES.includes(entry.mode) || !Number.isSafeInteger(entry.size) || entry.size < 0 || !Number.isSafeInteger(entry.offset)) {
          agentFail('failed', 'invalid_args');
        }
        if (entry.size > limits.fileBytes) agentFail('limit', 'limit_exceeded');
        const data = agentBytes(entry.data, limits.fileBytes);
        let file = t.files.get(path);
        if (entry.offset === 0) {
          if (file || t.open !== null) agentFail('failed', 'duplicate_path');
          if (t.files.size >= limits.files) agentFail('limit', 'limit_exceeded');
          file = { mode: entry.mode, size: entry.size, received: 0, hash: agentHash('sha256'), sha256: null, name: String(++t.count) };
          t.files.set(path, file); t.open = path;
        } else if (!file || t.open !== path || file.received !== entry.offset) agentFail('failed', 'invalid_args');
        if (file.mode !== entry.mode || file.size !== entry.size || file.received + data.length > file.size
          || (data.length === 0 && file.size > 0)) agentFail('failed', 'invalid_args');
        if ((t.bytes += data.length) > limits.totalBytes) agentFail('limit', 'limit_exceeded');
        await agentFs.writeFile(at(area(t) + '/' + file.name), data, { flag: entry.offset === 0 ? 'wx' : 'a', mode: 0o600 });
        file.hash.update(data); file.received += data.length;
        if (file.received === file.size) { file.sha256 = file.hash.digest('hex'); file.hash = null; t.open = null; }
      }
    } catch (error) { await drop(t); throw error; }
    return {};
  });

  /** Consumes one transfer for its commit op; an unknown id is the empty tree (W3 sends no put for it). */
  ctx.commitTransfer = async (transfer, digest, target) => {
    if (typeof transfer !== 'string' || !AGENT_ID.test(transfer) || typeof digest !== 'string' || !/^[a-f0-9]{64}$/.test(digest)) {
      agentFail('failed', 'invalid_args');
    }
    const t = state.transfers.get(transfer) || { id: transfer, target, root: TARGETS[target].root, files: new Map(), open: null };
    state.transfers.delete(transfer);
    try {
      if (t.target !== target || t.open !== null) agentFail('failed', 'incomplete_transfer');
      const list = [...t.files].map(([path, f]) => [path, f.mode, f.size, f.sha256]);
      for (const [path] of list) {
        const parts = path.split('/'); parts.pop();
        while (parts.length) { if (t.files.has(parts.join('/'))) agentFail('failed', 'invalid_path'); parts.pop(); }
      }
      if (agentSha(JSON.stringify(list.sort((a, b) => (a[0] < b[0] ? -1 : 1)))) !== digest) agentFail('failed', 'digest_mismatch');
      return { files: list.map(([path, mode, size, sha256]) => ({ path, mode, size, sha256, staged: area(t) + '/' + t.files.get(path).name })),
        dispose: () => drop(t) };
    } catch (error) { await drop(t); throw error; }
  };
  /** Refuses links in parents and, unless replacing a regular file, any existing entry. */
  ctx.checkTarget = async (base, path, replace) => {
    await agentNoLinks(at, base, path);
    const info = await agentFs.lstat(at(base + '/' + path)).catch(agentMissing);
    if (info && (!replace || !info.isFile())) agentFail('failed', replace ? 'invalid_path' : 'duplicate_path');
  };
  ctx.move = async (file, base) => {
    const target = at(base + '/' + file.path);
    await agentFs.mkdir(agentPath.dirname(target), { recursive: true });
    await agentFs.chmod(at(file.staged), file.mode);
    await agentFs.rename(at(file.staged), target);
  };
  ctx.place = async (file, base) => { await ctx.checkTarget(base, file.path, false); await ctx.move(file, base); };
});
`;
