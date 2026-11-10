/**
 * Pod agent section: W2 offline clean install (W3 `install { recipe, runId, source, cache, tarballs, workspaces }`).
 * - `source` is the staged source tree, placed in a fresh /tmp/install (no node_modules, .npmrc or .yarnrc).
 * - `cache` carries the trusted-cache tarballs; each is re-verified against its SRI and stored at npm's
 *   content-addressed path in /tmp/npm-cache. A lockfile entry without a staged literal integrity refuses
 *   with `integrity` before npm runs, so the install never depends on a fetch. In workspace-scoped mode the
 *   pod recomputes the expected root-lockfile subset from the staged lockfile plus `workspaces` (same rule as
 *   the API: selected and linked workspaces, no root dependencies) and refuses `integrity_missing` when any
 *   expected tarball is not staged — never an opaque npm failure, never a sealed partial tree.
 * - Then the frozen `npm ci --offline --ignore-scripts` (plus one `--workspace=<dir>` per selection, sorted)
 *   runs in /tmp/install with the host environment.
 * The supervisor exports the result with `snapshot { root: 'dependencies' }` (bootstrap-procs.ts).
 */
export const DEPENDENCY_OPS_SOURCE = String.raw`
AGENT_SECTIONS.push(function dependencyOps(ctx) {
  const { state, at } = ctx;
  const INSTALL_DIR = '/tmp/install';
  const CONTENT = '/tmp/npm-cache/_cacache/content-v2/';
  const SRI = /^(sha256|sha384|sha512)-([A-Za-z0-9+/]+={0,2})$/;
  ctx.resets.push(['/tmp', () => { state.installed = false; }]);
  state.installed = false;
  async function fileDigest(algo, path) {
    const hash = agentHash(algo);
    const handle = await agentFs.open(path, 'r');
    try { for await (const chunk of handle.createReadStream({ autoClose: false })) hash.update(chunk); }
    finally { await handle.close(); }
    return hash.digest();
  }
  async function stageTarballs(cache, tarballs) {
    const set = await ctx.commitTransfer(cache.transfer, cache.treeDigest, 'npm-cache');
    const staged = new Set();
    try {
      const byPath = new Map(set.files.map((f) => [f.path, f]));
      if (!Array.isArray(tarballs) || tarballs.length !== byPath.size) agentFail('integrity', 'integrity_missing');
      for (const tarball of tarballs) {
        agentRecord(tarball, ['path', 'integrity']);
        const file = byPath.get(tarball.path); byPath.delete(tarball.path);
        const match = SRI.exec(typeof tarball.integrity === 'string' ? tarball.integrity : '');
        if (!file || !match) agentFail('integrity', 'integrity_missing');
        const expected = Buffer.from(match[2], 'base64');
        if (!(await fileDigest(match[1], at(file.staged))).equals(expected)) agentFail('integrity', 'integrity_mismatch');
        staged.add(tarball.integrity);
        const hex = expected.toString('hex');
        const target = at(CONTENT + match[1] + '/' + hex.slice(0, 2) + '/' + hex.slice(2, 4) + '/' + hex.slice(4));
        if (await agentFs.lstat(target).catch(agentMissing)) continue;
        await agentFs.mkdir(agentPath.dirname(target), { recursive: true });
        await agentFs.chmod(at(file.staged), 0o444);
        await agentFs.rename(at(file.staged), target);
      }
    } finally { await set.dispose(); }
    return staged;
  }
  function validWorkspace(name) {
    if (typeof name !== 'string' || !name || name.length > 256 || name.includes('\\') || name.includes('\0')
      || name.startsWith('/') || name.endsWith('/')) return false;
    return name.split('/').every((s) => s !== '' && s !== '.' && s !== '..' && /^[A-Za-z0-9._@+-]+$/.test(s));
  }
  function recordOf(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? value : null;
  }
  function depsOf(entry, sections) {
    const out = [];
    for (const section of sections) {
      const group = recordOf(entry[section]);
      if (group) for (const name of Object.keys(group)) out.push(name);
    }
    return out;
  }
  function resolveLocked(packages, fromDir, name) {
    let dir = fromDir;
    for (;;) {
      const candidate = dir ? dir + '/node_modules/' + name : 'node_modules/' + name;
      if (Object.hasOwn(packages, candidate)) return candidate;
      if (!dir) return null;
      dir = dir.includes('/') ? dir.slice(0, dir.lastIndexOf('/')) : '';
    }
  }
  function subsetKeep(packages, selection) {
    const SECTIONS = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'];
    const REMOTE = ['dependencies', 'optionalDependencies', 'peerDependencies'];
    const keep = new Set(); const visited = new Set(selection); const queue = [...selection];
    const expanded = new Set(); const stack = [];
    const pushRemote = (found) => { if (!keep.has(found)) { keep.add(found); if (!expanded.has(found)) { expanded.add(found); stack.push(found); } } };
    const follow = (dep, base) => {
      const found = resolveLocked(packages, base, dep);
      if (!found) return;
      const target = recordOf(packages[found]);
      if (!target) return;
      if (target.link === true) {
        const resolved = typeof target.resolved === 'string' ? target.resolved : '';
        if (resolved && Object.hasOwn(packages, resolved) && !visited.has(resolved)) { visited.add(resolved); queue.push(resolved); }
        return;
      }
      pushRemote(found);
    };
    while (queue.length) {
      const dir = queue.shift();
      const entry = recordOf(packages[dir]);
      if (!entry) continue;
      for (const dep of depsOf(entry, SECTIONS)) follow(dep, dir);
      while (stack.length) {
        const remotePath = stack.pop();
        const remoteEntry = recordOf(packages[remotePath]);
        if (!remoteEntry) continue;
        for (const dep of depsOf(remoteEntry, REMOTE)) follow(dep, remotePath);
      }
    }
    while (stack.length) {
      const remotePath = stack.pop();
      const remoteEntry = recordOf(packages[remotePath]);
      if (!remoteEntry) continue;
      for (const dep of depsOf(remoteEntry, REMOTE)) follow(dep, remotePath);
    }
    return keep;
  }
  async function requireCovered(staged, workspaces) {
    let lock = null;
    try { lock = JSON.parse(await agentFs.readFile(at(INSTALL_DIR + '/package-lock.json'), 'utf8')); } catch { agentFail('failed', 'lockfile_missing'); }
    if (!lock || !lock.packages || typeof lock.packages !== 'object' || Array.isArray(lock.packages)) agentFail('failed', 'invalid_lockfile');
    if (workspaces.length > 0) {
      const packages = lock.packages;
      for (const name of workspaces) if (!Object.hasOwn(packages, name)) agentFail('failed', 'unknown_workspace');
      const keep = subsetKeep(packages, workspaces);
      const locked = new Set();
      for (const entry of Object.values(packages)) {
        if (!entry || typeof entry !== 'object' || entry.link === true || typeof entry.resolved !== 'string'
          || !/^https?:\/\//.test(entry.resolved) || typeof entry.integrity !== 'string') continue;
        locked.add(entry.integrity);
      }
      const expected = new Set();
      for (const path of keep) {
        const entry = recordOf(packages[path]);
        if (!entry || entry.link === true || typeof entry.resolved !== 'string' || !/^https?:\/\//.test(entry.resolved)
          || typeof entry.integrity !== 'string') agentFail('integrity', 'integrity_missing');
        expected.add(entry.integrity);
      }
      for (const integrity of staged) if (!locked.has(integrity)) agentFail('integrity', 'integrity_missing');
      for (const integrity of expected) if (!staged.has(integrity)) agentFail('integrity', 'integrity_missing');
      return;
    }
    for (const [path, entry] of Object.entries(lock.packages)) {
      if (!path || !entry || typeof entry !== 'object' || entry.link === true || typeof entry.resolved !== 'string'
        || !/^https?:\/\//.test(entry.resolved)) continue;
      if (typeof entry.integrity !== 'string' || !staged.has(entry.integrity)) agentFail('integrity', 'integrity_missing');
    }
  }
  ctx.define('install', ['recipe', 'runId', 'source', 'cache', 'tarballs', 'workspaces'], async ({ recipe, runId, source, cache, tarballs, workspaces }) => {
    if (recipe !== 'install' || typeof runId !== 'string' || !AGENT_ID.test(runId)) agentFail('failed', 'invalid_args');
    if (!Array.isArray(workspaces) || workspaces.length > 16 || !workspaces.every(validWorkspace)) agentFail('failed', 'invalid_args');
    agentArgs(source, ['transfer', 'treeDigest']); agentArgs(cache, ['transfer', 'treeDigest']);
    if (state.installed) agentFail('failed', 'already_installed');
    if (!(await ctx.terminateAll())) agentFail('failed', 'tree_survived');
    if (await agentFs.lstat(at(INSTALL_DIR)).catch(agentMissing)) agentFail('failed', 'duplicate_path');
    state.installed = true;
    const set = await ctx.commitTransfer(source.transfer, source.treeDigest, 'install');
    try {
      const paths = set.files.map((f) => agentSourcePath(f.path));
      if (!paths.includes('package.json') || !paths.includes('package-lock.json')) agentFail('failed', 'lockfile_missing');
      for (const file of set.files) await ctx.place(file, INSTALL_DIR);
    } finally { await set.dispose(); }
    await requireCovered(await stageTarballs(cache, tarballs), workspaces);
    const scoped = workspaces.length === 0 ? ctx.recipes.install
      : { ...ctx.recipes.install, args: [...ctx.recipes.install.args, ...[...workspaces].sort().map((w) => '--workspace=' + w)] };
    const result = await ctx.runToExit(scoped, INSTALL_DIR, ctx.options.installEnv);
    return { exitCode: result.exitCode, signal: result.signal, output: result.output };
  });
});
`;
