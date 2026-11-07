/**
 * Pod agent section: read-only dependency materialization (W3 `dependencies { transfer, treeDigest,
 * cacheKey, cacheTree, readOnly: true }`). It places the verified cache transfer (regular files, modes
 * 0444/0555) under /dependencies, derives npm's bin and workspace links from the staged lockfile (the
 * trusted cache carries regular files only), links each workspace node_modules to it, then freezes the tree.
 */
export const MATERIALIZE_OPS_SOURCE = String.raw`
AGENT_SECTIONS.push(function materializeOps(ctx) {
  const { state, at } = ctx;
  ctx.resets.push(['/dependencies', () => { state.sealed = false; }]);
  state.sealed = false;
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
  ctx.define('dependencies', ['transfer', 'treeDigest', 'cacheKey', 'cacheTree', 'readOnly'], async (args) => {
    if (args.readOnly !== true || typeof args.cacheKey !== 'string' || !/^[A-Za-z0-9/._:-]{1,256}$/.test(args.cacheKey)
      || !/^[a-f0-9]{64}$/.test(String(args.cacheTree))) agentFail('failed', 'invalid_args');
    const set = await ctx.commitTransfer(args.transfer, args.treeDigest, 'dependencies');
    try {
      if (state.sealed) agentFail('failed', 'dependencies_sealed');
      if (!state.staged) agentFail('failed', 'phase_refused');
      for (const file of set.files) {
        if (!file.path.split('/').includes('node_modules')) agentFail('failed', 'invalid_path');
        if (file.mode !== 0o444 && file.mode !== 0o555) agentFail('failed', 'invalid_mode');
      }
      for (const file of set.files) await ctx.place(file, '/dependencies');
    } finally { await set.dispose(); }
    const links = await linkFromLockfile();
    for (const name of await agentFs.readdir(at('/dependencies'))) {
      if ((await agentFs.lstat(at('/dependencies/' + name))).isDirectory()) await freeze('/dependencies/' + name);
    }
    state.sealed = true;
    return { treeDigest: args.treeDigest, readOnly: true, files: set.files.length, links };
  });
});
`;
