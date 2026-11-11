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
    // Sealed-unit archive relay (§7.1.2): the one tar.zst arrives as a single-file transfer staged under the
    // reserved area of /tmp (never in the tree proper); extractArchive below commits and extracts it.
    archive: { root: '/tmp', ...TREE },
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
  /** Bounded sealed-unit extraction (§7.2.3): commits the one-file archive transfer, decompresses its zstd
   * frame and extracts ustar records under root (workspace or dependencies) with the same refusals as the
   * API reader — regular files only (no links, devices, absolute/dotdot/.git paths), 0444/0555 modes, running
   * counters, 20:1 decompression ratio bound, streaming (one file plus the window in memory). The tree digest
   * over extracted [path, mode, sha256] rows must equal tree, or the extraction refuses. */
  ctx.define('extractArchive', ['transfer', 'treeDigest', 'tree', 'root'], async ({ transfer, treeDigest, tree, root }) => {
    agentArgs({ transfer, treeDigest, tree, root }, ['transfer', 'treeDigest', 'tree', 'root']);
    const base = root === 'workspace' ? '/workspace' : root === 'dependencies' ? '/dependencies' : null;
    if (base === null || typeof tree !== 'string' || !AGENT_SHA.test(tree)) agentFail('failed', 'invalid_args');
    const set = await ctx.commitTransfer(transfer, treeDigest, 'archive');
    try {
      if (set.files.length !== 1) agentFail('failed', 'invalid_archive');
      const staged = set.files[0];
      const { createZstdDecompress } = await import('node:zlib');
      const handle = await agentFs.open(at(staged.staged), 'r');
      try {
        const { size } = await handle.stat();
        if (!Number.isSafeInteger(size) || size < 0 || size > TREE.totalBytes) agentFail('limit', 'limit_exceeded');
        const zstd = createZstdDecompress();
        const feed = (async () => {
          let position = 0;
          while (position < size) {
            const chunk = Buffer.alloc(Math.min(1048576, size - position));
            const { bytesRead } = await handle.read(chunk, 0, chunk.length, position);
            if (bytesRead === 0) agentFail('failed', 'unstable_tree');
            position += bytesRead;
            if (!zstd.write(chunk.subarray(0, bytesRead))) {
              await new Promise((resolve) => zstd.once('drain', resolve));
            }
          }
          zstd.end();
        })();
        feed.catch(() => undefined);
        const iterator = zstd[Symbol.asyncIterator]();
        let queue = Buffer.alloc(0);
        const next = async () => {
          try { const step = await iterator.next(); return step.done ? null : step.value; }
          catch { agentFail('failed', 'invalid_archive'); }
        };
        const take = async (length) => {
          while (queue.length < length) {
            const piece = await next();
            if (piece === null) agentFail('failed', 'invalid_archive');
            queue = Buffer.concat([queue, piece]);
          }
          const out = queue.subarray(0, length); queue = queue.subarray(length);
          return out;
        };
        const text = (bytes, from, to) => bytes.subarray(from, to).toString('utf8').replace(/\0.*$/, '');
        const rows = []; let total = 0; let count = 0;
        for (;;) {
          const header = await take(512);
          if (header.every((byte) => byte === 0)) {
            const second = await take(512);
            if (!second.every((byte) => byte === 0) || queue.length !== 0) agentFail('failed', 'invalid_archive');
            break;
          }
          if (header.subarray(257, 263).toString('utf8') !== 'ustar\0') agentFail('failed', 'invalid_archive');
          const type = String.fromCharCode(header[156]);
          if (type !== '0' && type !== '\0') agentFail('failed', 'invalid_archive');
          const name = text(header, 0, 100); const prefix = text(header, 345, 500);
          const path = prefix ? prefix + '/' + name : name;
          const mode = parseInt(text(header, 100, 108).trim() || '0', 8);
          const fileSize = parseInt(text(header, 124, 136).trim() || '0', 8);
          agentRelative(path);
          if (base === '/dependencies' && !path.split('/').includes('node_modules')) agentFail('failed', 'invalid_path');
          if (mode !== 0o444 && mode !== 0o555) agentFail('failed', 'invalid_mode');
          if (!Number.isSafeInteger(fileSize) || fileSize < 0) agentFail('failed', 'invalid_archive');
          let checksum = 0;
          for (let i = 0; i < 512; i++) checksum += i >= 148 && i < 156 ? 0x20 : header[i];
          if (checksum !== parseInt(text(header, 148, 156).trim() || '0', 8)) agentFail('failed', 'invalid_archive');
          if (fileSize > TREE.fileBytes || ++count > TREE.files) agentFail('limit', 'limit_exceeded');
          const hash = agentHash('sha256'); let read = 0;
          const target = at(base + '/' + path);
          await agentFs.mkdir(agentPath.dirname(target), { recursive: true });
          const out = await agentFs.open(target, 'wx', mode);
          try {
            while (read < fileSize) {
              const piece = await take(Math.min(fileSize - read, 1048576));
              hash.update(piece); read += piece.length;
              await out.write(piece);
            }
          } finally { await out.close(); }
          await agentFs.chmod(target, mode);
          const padding = (512 - (fileSize % 512)) % 512;
          if (padding) await take(padding);
          total += fileSize;
          if (total > TREE.totalBytes || total > size * 20) agentFail('limit', 'limit_exceeded');
          rows.push([path, mode === 0o555 ? 365 : 292, hash.digest('hex')]);
        }
        await feed;
        rows.sort((a, b) => (a[0] < b[0] ? -1 : 1));
        if (agentSha(JSON.stringify(rows)) !== tree) agentFail('failed', 'digest_mismatch');
        return { files: rows.length, bytes: total };
      } finally { await handle.close(); }
    } finally { await set.dispose(); }
  });
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
