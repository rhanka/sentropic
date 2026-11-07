/**
 * Pod agent section: read-only dependency materialization. `dependencies` writes cached regular
 * files under /dependencies, then derives npm's bin and workspace links from the staged lockfile
 * (the trusted cache carries regular files only), links each workspace node_modules to it, freezes
 * the tree and returns the same tree digest as the trusted cache receipt.
 */
export const MATERIALIZE_OPS_SOURCE = String.raw`
AGENT_SECTIONS.push(function materializeOps(ctx) {
  const { state, at } = ctx;
  const DEP = { files: 65536, bytes: 536870912 };
  const reset = () => { state.deps = new Map(); state.depBytes = 0; state.sealed = false; };
  ctx.resets.push(reset); reset();
  const exists = (path) => agentFs.lstat(at(path)).then(() => true, () => false);
  const link = async (target, path) => {
    await agentFs.mkdir(agentPath.dirname(at(path)), { recursive: true });
    await agentFs.symlink(target, at(path));
  };
  async function linkFromLockfile() {
    let lock = null;
    try { lock = JSON.parse(await agentFs.readFile(at('/workspace/package-lock.json'), 'utf8')); } catch { agentFail('failed', 'lockfile_missing'); }
    if (!lock || ![2, 3].includes(lock.lockfileVersion) || !lock.packages || typeof lock.packages !== 'object'
      || Array.isArray(lock.packages)) agentFail('failed', 'invalid_lockfile');
    const prefixes = new Set(); let links = 0;
    for (const path of Object.keys(lock.packages).sort()) {
      if (!path) continue;
      const parts = agentRelative(path).split('/');
      const first = parts.indexOf('node_modules');
      if (first < 0) continue;
      const entry = lock.packages[path];
      if (!entry || typeof entry !== 'object') agentFail('failed', 'invalid_lockfile');
      prefixes.add(parts.slice(0, first).join('/'));
      let owner = entry; let base = null;
      if (entry.link === true) {
        const resolved = agentSourcePath(entry.resolved);
        owner = lock.packages[resolved];
        if (!owner || typeof owner !== 'object') agentFail('failed', 'invalid_lockfile');
        base = '/workspace/' + resolved;
        await link(base, '/dependencies/' + path); links++;
      }
      if (owner.bin === undefined) continue;
      if (!owner.bin || typeof owner.bin !== 'object' || Array.isArray(owner.bin)) agentFail('failed', 'invalid_lockfile');
      const binDir = '/dependencies/' + parts.slice(0, parts.lastIndexOf('node_modules') + 1).join('/') + '/.bin';
      for (const name of Object.keys(owner.bin).sort()) {
        if (!/^[A-Za-z0-9._@+-]+$/.test(name) || name === '.' || name === '..') agentFail('failed', 'invalid_lockfile');
        const rel = agentRelative(agentPath.normalize(String(owner.bin[name])));
        if (await exists(binDir + '/' + name)) continue;
        await link(base ? base + '/' + rel : agentPath.relative(binDir, '/dependencies/' + path + '/' + rel), binDir + '/' + name);
        links++;
      }
    }
    for (const prefix of [...prefixes].sort()) {
      const nested = (prefix ? prefix + '/' : '') + 'node_modules';
      if (!(await exists('/dependencies/' + nested))) continue;
      await agentNoLinks(at, '/workspace', nested);
      await link('/dependencies/' + nested, '/workspace/' + nested); links++;
    }
    return links;
  }
  async function freeze(dir) {
    for (const name of await agentFs.readdir(at(dir))) {
      if ((await agentFs.lstat(at(dir + '/' + name))).isDirectory()) await freeze(dir + '/' + name);
    }
    await agentFs.chmod(at(dir), 0o555);
  }
  ctx.define('dependencies', ['files', 'seal'], async ({ files, seal }) => {
    if (state.sealed) agentFail('failed', 'dependencies_sealed');
    if (!Array.isArray(files) || typeof seal !== 'boolean') agentFail('failed', 'invalid_args');
    const batch = new Map(); let bytes = state.depBytes;
    for (const file of files) {
      agentRecord(file, ['path', 'type', 'mode', 'bytes']);
      const path = agentRelative(file.path);
      if (!path.split('/').includes('node_modules')) agentFail('failed', 'invalid_path');
      if (file.type !== 'file') agentFail('failed', 'invalid_args');
      if (file.mode !== 292 && file.mode !== 365) agentFail('failed', 'invalid_mode');
      if (state.deps.has(path) || batch.has(path)) agentFail('failed', 'duplicate_path');
      const data = agentBytes(file.bytes, AGENT_LIMITS.fileBytes);
      bytes += data.length;
      if (bytes > DEP.bytes || state.deps.size + batch.size >= DEP.files) agentFail('limit', 'limit_exceeded');
      batch.set(path, { mode: file.mode, data });
    }
    for (const [path, file] of batch) {
      const target = at('/dependencies/' + path);
      await agentFs.mkdir(agentPath.dirname(target), { recursive: true });
      await agentFs.writeFile(target, file.data, { flag: 'wx', mode: file.mode });
      await agentFs.chmod(target, file.mode);
      state.deps.set(path, [file.mode, agentSha(file.data)]);
    }
    state.depBytes = bytes;
    if (!seal) return { files: state.deps.size };
    const links = await linkFromLockfile();
    for (const name of await agentFs.readdir(at('/dependencies'))) {
      if ((await agentFs.lstat(at('/dependencies/' + name))).isDirectory()) await freeze('/dependencies/' + name);
    }
    state.sealed = true;
    return { treeSha256: agentDigest(state.deps), readOnly: true, files: state.deps.size, links };
  });
});
`;
